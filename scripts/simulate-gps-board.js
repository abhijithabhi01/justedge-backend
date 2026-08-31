/**
 * simulate-gps-board.js
 *
 * Acts as a GPS board (ESP32-style) writing live location into DynamoDB
 * while travelling Mysuru → Krishnarajapuram (Bengaluru) along NH 275.
 *
 * Payload shape:
 *   {
 *     "device_id": "ESP32_001",
 *     "latitude": 12.9716,
 *     "longitude": 77.5946,
 *     "timestamp": 1756270000
 *   }
 *
 * Usage:
 *   node scripts/simulate-gps-board.js
 *   node scripts/simulate-gps-board.js --once
 *   node scripts/simulate-gps-board.js --device ESP32_GPS_01
 *   node scripts/simulate-gps-board.js --interval 3000
 *
 * Env:
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *   DYNAMODB_TABLE_NAME   (default: SensorData)
 *   GPS_DEVICE_ID         (default: ESP32_001)
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
  'ESP32_001';

const INTERVAL_MS = Number(
  (intervalFlag >= 0 && args[intervalFlag + 1]) ||
    process.env.GPS_INTERVAL_MS ||
    5000
);

const TABLE = process.env.DYNAMODB_TABLE_NAME || 'SensorData';
const REGION = process.env.AWS_REGION || 'ap-southeast-2';

/**
 * Mysuru → Krishnarajapuram via NH 275 corridor
 * (same highway as Google Maps “via NH 275”, ~166 km)
 */
const ROUTE = [
  { name: 'Mysuru city', lat: 12.2958, lng: 76.6394 },
  { name: 'Mysuru outer / Bannur Rd approach', lat: 12.3300, lng: 76.6800 },
  { name: 'Srirangapatna', lat: 12.4230, lng: 76.7030 },
  { name: 'Mandya', lat: 12.5220, lng: 76.8970 },
  { name: 'Maddur', lat: 12.5850, lng: 77.0450 },
  { name: 'Channapatna', lat: 12.6520, lng: 77.2070 },
  { name: 'Ramanagara', lat: 12.7200, lng: 77.2800 },
  { name: 'Bidadi', lat: 12.7960, lng: 77.3860 },
  { name: 'Kengeri / Mysore Road', lat: 12.9070, lng: 77.4820 },
  { name: 'Nice Road / south Bengaluru', lat: 12.9170, lng: 77.5600 },
  { name: 'Silk Board approach', lat: 12.9170, lng: 77.6230 },
  { name: 'Outer Ring / KR Puram approach', lat: 12.9950, lng: 77.6700 },
  { name: 'Krishnarajapuram, Bengaluru', lat: 13.0169, lng: 77.6954 },
];

/** denser points so the marker moves smoothly along the highway */
const STEPS_PER_LEG = 12;

function buildPath() {
  const points = [];
  for (let i = 0; i < ROUTE.length - 1; i++) {
    const a = ROUTE[i];
    const b = ROUTE[i + 1];
    for (let s = 0; s < STEPS_PER_LEG; s++) {
      const t = s / STEPS_PER_LEG;
      // small jitter so it feels like real GPS, still stays near the highway
      const jitterLat = (Math.random() - 0.5) * 0.0012;
      const jitterLng = (Math.random() - 0.5) * 0.0012;
      points.push({
        lat: a.lat + (b.lat - a.lat) * t + jitterLat,
        lng: a.lng + (b.lng - a.lng) * t + jitterLng,
        leg: a.name,
      });
    }
  }
  const end = ROUTE[ROUTE.length - 1];
  points.push({ lat: end.lat, lng: end.lng, leg: end.name });
  return points;
}

const PATH = buildPath();

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

async function putReading({ latitude, longitude, leg, index, total }) {
  const timestamp = Math.floor(Date.now() / 1000);

  const item = {
    // Required GPS schema
    device_id: DEVICE_ID,
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    timestamp,

    // Compatibility with existing SensorData / JustEdge
    deviceId: DEVICE_ID,
    type: 'telemetry',
    status: 'ONLINE',
    leg: leg || null,
    route: 'Mysuru→KR Puram (NH275)',
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
  console.log(' GPS board simulator');
  console.log(` device_id : ${DEVICE_ID}`);
  console.log(` table     : ${TABLE}`);
  console.log(` region    : ${REGION}`);
  console.log(` route     : Mysuru → Krishnarajapuram via NH275 (${PATH.length} points)`);
  console.log(` interval  : ${INTERVAL_MS} ms`);
  console.log(` mode      : ${ONCE ? 'single point' : 'full trip loop'}`);
  console.log('─────────────────────────────────────────────');

  let i = 0;

  while (true) {
    const p = PATH[i % PATH.length];
    try {
      const item = await putReading({
        latitude: p.lat,
        longitude: p.lng,
        leg: p.leg,
        index: i % PATH.length,
        total: PATH.length,
      });
      console.log(
        `[${new Date().toLocaleTimeString()}] #${item.seq}/${PATH.length}  ` +
          `${item.latitude}, ${item.longitude}  (${p.leg})`
      );
    } catch (err) {
      console.error('Put failed:', err.message);
    }

    if (ONCE) break;

    i += 1;
    if (i % PATH.length === 0) {
      console.log('… arrived Krishnarajapuram — restarting trip from Mysuru in 15s');
      await sleep(15000);
    } else {
      await sleep(INTERVAL_MS);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
