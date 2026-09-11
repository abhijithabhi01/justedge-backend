/**
 * simulate-gps-board.js
 *
 * Pushes live GPS telemetry into DynamoDB table GPS_Device_Data while the
 * board travels Kochi → Bengaluru → Kochi (NH 544 / NH 48 corridor).
 *
 * Schema matches your existing boards (e.g. CHAITHANYA):
 *   deviceName (partition key), timestamp (sort key),
 *   locations: [{ lat, lng }], temperature, battery, status, type
 *
 * Usage:
 *   node scripts/simulate-gps-board.js --device ONENESS9845
 *   node scripts/simulate-gps-board.js --device ONENESS9845 --interval 3000
 *   node scripts/simulate-gps-board.js --device ONENESS9845 --once
 *
 * Env (from .env):
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *   DYNAMODB_TABLE_NAME   (default: GPS_Device_Data)
 *   DYNAMODB_DEVICE_KEY    (default: deviceName for GPS tables)
 */

import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const deviceFlag = args.indexOf('--device');
const intervalFlag = args.indexOf('--interval');

const DEVICE_ID =
  (deviceFlag >= 0 && args[deviceFlag + 1]) ||
  process.env.GPS_DEVICE_ID ||
  'ONENESS9845';

const INTERVAL_MS = Number(
  (intervalFlag >= 0 && args[intervalFlag + 1]) ||
    process.env.GPS_INTERVAL_MS ||
    3000
);

const TABLE =
  process.env.DYNAMODB_TABLE_NAME ||
  process.env.DYNAMO_TABLE ||
  'GPS_Device_Data';

const REGION = process.env.AWS_REGION || 'ap-southeast-2';

function deviceKeyName() {
  if (process.env.DYNAMODB_DEVICE_KEY) return process.env.DYNAMODB_DEVICE_KEY.trim();
  if (/gps/i.test(TABLE) || TABLE === 'GPS_Device_Data') return 'deviceName';
  return 'deviceId';
}

/** Kochi → Bengaluru corridor */
const ROUTE_OUT = [
  { name: 'Kochi', lat: 9.9312, lng: 76.2673 },
  { name: 'Aluva', lat: 10.1004, lng: 76.357 },
  { name: 'Angamaly', lat: 10.1906, lng: 76.386 },
  { name: 'Chalakudy', lat: 10.301, lng: 76.337 },
  { name: 'Thrissur', lat: 10.5276, lng: 76.2144 },
  { name: 'Wadakkanchery', lat: 10.654, lng: 76.247 },
  { name: 'Palakkad', lat: 10.7867, lng: 76.6548 },
  { name: 'Coimbatore', lat: 11.0168, lng: 76.9558 },
  { name: 'Avinashi', lat: 11.191, lng: 77.268 },
  { name: 'Erode', lat: 11.341, lng: 77.717 },
  { name: 'Salem', lat: 11.6643, lng: 78.146 },
  { name: 'Dharmapuri', lat: 12.1357, lng: 78.158 },
  { name: 'Krishnagiri', lat: 12.5186, lng: 78.2137 },
  { name: 'Hosur', lat: 12.7409, lng: 77.8253 },
  { name: 'Electronic City', lat: 12.845, lng: 77.66 },
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
];

const STEPS_PER_LEG = 10;

function interpolate(route, direction) {
  const points = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    for (let s = 0; s < STEPS_PER_LEG; s++) {
      const t = s / STEPS_PER_LEG;
      const jitterLat = (Math.random() - 0.5) * 0.0012;
      const jitterLng = (Math.random() - 0.5) * 0.0012;
      points.push({
        lat: a.lat + (b.lat - a.lat) * t + jitterLat,
        lng: a.lng + (b.lng - a.lng) * t + jitterLng,
        leg: a.name,
        direction,
      });
    }
  }
  const end = route[route.length - 1];
  points.push({ lat: end.lat, lng: end.lng, leg: end.name, direction });
  return points;
}

function buildPath() {
  const outbound = interpolate(ROUTE_OUT, 'outbound');
  const inbound = interpolate([...ROUTE_OUT].reverse(), 'return');
  return [...outbound, ...inbound];
}

const PATH = buildPath();
const KEY = deviceKeyName();

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  }),
  { unmarshallOptions: { wrapNumbers: false } }
);

function nextTemp() {
  const base = 28;
  const drift = Math.sin(Date.now() / 60000) * 2;
  return Math.round((base + drift + (Math.random() - 0.5) * 1.5) * 10) / 10;
}

async function putReading({ latitude, longitude, leg, direction, index, total }) {
  const ts = String(Date.now());
  const lat = Number(latitude.toFixed(6));
  const lng = Number(longitude.toFixed(6));
  const battery = Math.max(35, 92 - Math.floor((index / total) * 25));

  const item = {
    [KEY]: DEVICE_ID,
    deviceName: DEVICE_ID,
    deviceId: DEVICE_ID,
    timestamp: ts,
    temperature: nextTemp(),
    battery,
    locations: [{ lat, lng, site: leg || '' }],
    latitude: lat,
    longitude: lng,
    site: leg || '',
    status: 'ONLINE',
    type: 'telemetry',
    source: 'justedge-gps-simulator',
    route: 'Kochi↔Bengaluru',
    direction: direction || null,
    leg: leg || null,
    seq: index + 1,
    total_points: total,
  };

  await client.send(
    new PutCommand({
      TableName: TABLE,
      Item: item,
    })
  );

  return item;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Missing AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in env.');
    process.exit(1);
  }

  console.log('─────────────────────────────────────────────');
  console.log(' GPS board simulator → AWS DynamoDB');
  console.log(` deviceName : ${DEVICE_ID}`);
  console.log(` table      : ${TABLE}`);
  console.log(` key        : ${KEY}`);
  console.log(` region     : ${REGION}`);
  console.log(` route      : Kochi ↔ Bengaluru (${PATH.length} points)`);
  console.log(` interval   : ${INTERVAL_MS} ms`);
  console.log(` mode       : ${ONCE ? 'single point' : 'continuous loop'}`);
  console.log('─────────────────────────────────────────────');
  console.log('After a few puts, refresh Add sensor → Live AWS device list.');
  console.log(`Select "${DEVICE_ID}" and register the board in JustEdge.`);
  console.log('─────────────────────────────────────────────');

  let i = 0;

  while (true) {
    const p = PATH[i % PATH.length];
    try {
      const item = await putReading({
        latitude: p.lat,
        longitude: p.lng,
        leg: p.leg,
        direction: p.direction,
        index: i % PATH.length,
        total: PATH.length,
      });
      console.log(
        `[${new Date().toLocaleTimeString()}] #${item.seq}/${PATH.length}  ` +
          `${item.latitude}, ${item.longitude}  (${p.leg} · ${p.direction})  batt=${item.battery}`
      );
    } catch (err) {
      console.error('Put failed:', err.message);
    }

    if (ONCE) break;

    i += 1;
    if (i % PATH.length === 0) {
      console.log('… completed Kochi↔Bengaluru loop — restarting in 10s');
      await sleep(10000);
    } else {
      await sleep(INTERVAL_MS);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});