/**
 * simulate-fleet-boards.js
 *
 * ONE process → DynamoDB GPS_Device_Data for all demo boards:
 *
 *  GPS (moving):
 *    ONENESS1222  — Nagercoil → Madurai → Chennai (and back)
 *    KALLADA6444  — Chennai → Hyderabad (and back)
 *    SURYA8001    — Chennai → Bengaluru (and back)
 *    ONENESS9845  — Kochi → Bengaluru (and back)
 *
 *  Temperature (fixed sites):
 *    TEMP_BOARD_01  Bengaluru Warehouse A
 *    TEMP_BOARD_02  Chennai Cold Store
 *    TEMP_BOARD_03  Hosur Plant Floor
 *
 * Usage:
 *   node scripts/simulate-fleet-boards.js
 *   node scripts/simulate-fleet-boards.js --interval 3000
 *   node scripts/simulate-fleet-boards.js --once
 *   node scripts/simulate-fleet-boards.js --gps-only
 *   node scripts/simulate-fleet-boards.js --temp-only
 *
 * Then JustEdge → Add sensor → pick deviceName from Live AWS device list.
 */

import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const GPS_ONLY = args.includes('--gps-only');
const TEMP_ONLY = args.includes('--temp-only');
const intervalFlag = args.indexOf('--interval');

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

const KEY = deviceKeyName();
const STEPS_PER_LEG = 8;

/* ── Route waypoints ─────────────────────────────────────────────── */

/** Nagercoil → Madurai → Chennai (NH 44 / coastal + inland) */
const NAGERCOIL_MADURAI_CHENNAI = [
  { name: 'Nagercoil', lat: 8.1833, lng: 77.4119 },
  { name: 'Kanyakumari approach', lat: 8.25, lng: 77.45 },
  { name: 'Tirunelveli', lat: 8.7139, lng: 77.7567 },
  { name: 'Kovilpatti', lat: 9.1717, lng: 77.869 },
  { name: 'Sattur', lat: 9.355, lng: 77.92 },
  { name: 'Virudhunagar', lat: 9.568, lng: 77.9624 },
  { name: 'Madurai', lat: 9.9252, lng: 78.1198 },
  { name: 'Dindigul', lat: 10.362, lng: 77.98 },
  { name: 'Karur', lat: 10.9601, lng: 78.0766 },
  { name: 'Namakkal', lat: 11.219, lng: 78.167 },
  { name: 'Salem', lat: 11.6643, lng: 78.146 },
  { name: 'Attur', lat: 11.594, lng: 78.598 },
  { name: 'Viluppuram', lat: 11.9401, lng: 79.4861 },
  { name: 'Tindivanam', lat: 12.234, lng: 79.65 },
  { name: 'Chengalpattu', lat: 12.6819, lng: 79.9888 },
  { name: 'Tambaram', lat: 12.9249, lng: 80.1 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
];

/** Chennai → Hyderabad (NH 16 / NH 65 corridor) */
const CHENNAI_HYDERABAD = [
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Red Hills', lat: 13.2, lng: 80.15 },
  { name: 'Kavali approach', lat: 14.0, lng: 80.0 },
  { name: 'Nellore', lat: 14.4426, lng: 79.9865 },
  { name: 'Gudur', lat: 14.146, lng: 79.85 },
  { name: 'Ongole', lat: 15.5057, lng: 80.0499 },
  { name: 'Chirala', lat: 15.8246, lng: 80.3521 },
  { name: 'Vijayawada', lat: 16.5062, lng: 80.648 },
  { name: 'Guntur', lat: 16.3067, lng: 80.4365 },
  { name: 'Suryapet', lat: 17.1405, lng: 79.6208 },
  { name: 'Nalgonda', lat: 17.0575, lng: 79.267 },
  { name: 'Ibrahimpatnam', lat: 17.2, lng: 78.65 },
  { name: 'LB Nagar', lat: 17.35, lng: 78.55 },
  { name: 'Hyderabad', lat: 17.385, lng: 78.4867 },
];

/** Chennai → Bengaluru */
const CHENNAI_BANGALORE = [
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Guindy', lat: 13.0067, lng: 80.2206 },
  { name: 'Tambaram', lat: 12.9249, lng: 80.1 },
  { name: 'Chengalpattu', lat: 12.6819, lng: 79.9888 },
  { name: 'Kanchipuram', lat: 12.8342, lng: 79.7036 },
  { name: 'Walajapet', lat: 12.925, lng: 79.366 },
  { name: 'Vellore', lat: 12.9165, lng: 79.1325 },
  { name: 'Gudiyatham', lat: 12.944, lng: 78.873 },
  { name: 'Ambur', lat: 12.79, lng: 78.716 },
  { name: 'Vaniyambadi', lat: 12.682, lng: 78.62 },
  { name: 'Tirupattur', lat: 12.495, lng: 78.567 },
  { name: 'Krishnagiri', lat: 12.5186, lng: 78.2137 },
  { name: 'Hosur', lat: 12.7409, lng: 77.8253 },
  { name: 'Electronic City', lat: 12.845, lng: 77.66 },
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
];

/** Kochi → Bengaluru */
const KOCHI_BANGALORE = [
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

function interpolate(route, direction) {
  const points = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    for (let s = 0; s < STEPS_PER_LEG; s++) {
      const t = s / STEPS_PER_LEG;
      points.push({
        lat: a.lat + (b.lat - a.lat) * t + (Math.random() - 0.5) * 0.001,
        lng: a.lng + (b.lng - a.lng) * t + (Math.random() - 0.5) * 0.001,
        leg: a.name,
        direction,
      });
    }
  }
  const end = route[route.length - 1];
  points.push({ lat: end.lat, lng: end.lng, leg: end.name, direction });
  return points;
}

function buildRoundTrip(waypoints) {
  return [
    ...interpolate(waypoints, 'outbound'),
    ...interpolate([...waypoints].reverse(), 'return'),
  ];
}

/* ── Board definitions ───────────────────────────────────────────── */

const GPS_BOARDS = [
  {
    id: 'ONENESS1222',
    label: 'Oneness 1222',
    routeLabel: 'Nagercoil→Madurai→Chennai',
    path: buildRoundTrip(NAGERCOIL_MADURAI_CHENNAI),
    index: 0,
  },
  {
    id: 'KALLADA6444',
    label: 'Kallada 6444',
    routeLabel: 'Chennai→Hyderabad',
    path: buildRoundTrip(CHENNAI_HYDERABAD),
    index: 0,
  },
  {
    id: 'SURYA8001',
    label: 'Surya 8001',
    routeLabel: 'Chennai↔Bengaluru',
    path: buildRoundTrip(CHENNAI_BANGALORE),
    index: 0,
  },
  {
    id: 'ONENESS9845',
    label: 'Oneness 9845',
    routeLabel: 'Kochi↔Bengaluru',
    path: buildRoundTrip(KOCHI_BANGALORE),
    index: 0,
  },
];

const TEMP_BOARDS = [
  {
    id: 'TEMP_BOARD_01',
    site: 'Bengaluru Warehouse A',
    lat: 12.9716,
    lng: 77.5946,
    baseTemp: 24.5,
  },
  {
    id: 'TEMP_BOARD_02',
    site: 'Chennai Cold Store',
    lat: 13.0827,
    lng: 80.2707,
    baseTemp: 6.0,
  },
  {
    id: 'TEMP_BOARD_03',
    site: 'Hosur Plant Floor',
    lat: 12.7409,
    lng: 77.8253,
    baseTemp: 28.0,
  },
];

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function driftTemp(base) {
  const wave = Math.sin(Date.now() / 45000) * 1.8;
  const noise = (Math.random() - 0.5) * 0.6;
  return Math.round((base + wave + noise) * 10) / 10;
}

async function putItem(item) {
  await client.send(new PutCommand({ TableName: TABLE, Item: item }));
}

async function tickGps(board) {
  const p = board.path[board.index % board.path.length];
  const lat = Number(p.lat.toFixed(6));
  const lng = Number(p.lng.toFixed(6));
  const progress = (board.index % board.path.length) / board.path.length;
  const battery = Math.max(35, Math.round(92 - progress * 25));
  const ts = String(Date.now());

  await putItem({
    [KEY]: board.id,
    deviceName: board.id,
    deviceId: board.id,
    timestamp: ts,
    temperature: driftTemp(28),
    battery,
    locations: [{ lat, lng, site: p.leg || '' }],
    latitude: lat,
    longitude: lng,
    site: p.leg || '',
    status: 'ONLINE',
    type: 'telemetry',
    source: 'justedge-fleet-simulator',
    route: board.routeLabel,
    direction: p.direction,
    leg: p.leg,
    seq: (board.index % board.path.length) + 1,
    total_points: board.path.length,
  });

  board.index += 1;
  return {
    kind: 'gps',
    id: board.id,
    lat,
    lng,
    leg: p.leg,
    direction: p.direction,
    battery,
  };
}

async function tickTemp(board) {
  const ts = String(Date.now());
  const temperature = driftTemp(board.baseTemp);
  const humidity = Math.round(45 + Math.random() * 25);
  const battery = Math.max(50, 90 - Math.floor(Math.random() * 8));

  await putItem({
    [KEY]: board.id,
    deviceName: board.id,
    deviceId: board.id,
    timestamp: ts,
    temperature,
    humidity,
    battery,
    locations: [{ lat: board.lat, lng: board.lng, site: board.site }],
    latitude: board.lat,
    longitude: board.lng,
    site: board.site,
    status: 'ONLINE',
    type: 'telemetry',
    source: 'justedge-fleet-simulator',
    boardKind: 'temperature',
  });

  return {
    kind: 'temp',
    id: board.id,
    temperature,
    humidity,
    battery,
    site: board.site,
  };
}

async function main() {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Missing AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in env.');
    process.exit(1);
  }

  const runGps = !TEMP_ONLY;
  const runTemp = !GPS_ONLY;

  console.log('─────────────────────────────────────────────────────');
  console.log(' JustEdge fleet simulator → DynamoDB');
  console.log(` table    : ${TABLE}`);
  console.log(` region   : ${REGION}`);
  console.log(` interval : ${INTERVAL_MS} ms`);
  if (runGps) {
    console.log(' GPS boards:');
    for (const g of GPS_BOARDS) {
      console.log(
        `   • ${g.id.padEnd(14)} ${g.label.padEnd(16)} ${g.routeLabel} (${g.path.length} pts)`
      );
    }
  }
  if (runTemp) {
    console.log(' Temperature boards:');
    for (const t of TEMP_BOARDS) {
      console.log(`   • ${t.id.padEnd(14)} ${t.site} · base ${t.baseTemp}°C`);
    }
  }
  console.log('─────────────────────────────────────────────────────');
  console.log('After a few ticks, refresh JustEdge → Add sensor → Live AWS device:');
  if (runGps) {
    console.log('  ONENESS1222  KALLADA6444  SURYA8001  ONENESS9845');
  }
  if (runTemp) {
    console.log('  TEMP_BOARD_01  TEMP_BOARD_02  TEMP_BOARD_03');
  }
  console.log('─────────────────────────────────────────────────────');

  let tick = 0;
  while (true) {
    tick += 1;
    const results = [];

    if (runGps) {
      for (const g of GPS_BOARDS) {
        try {
          results.push(await tickGps(g));
        } catch (err) {
          console.error(`[gps ${g.id}]`, err.message);
        }
      }
    }

    if (runTemp) {
      for (const t of TEMP_BOARDS) {
        try {
          results.push(await tickTemp(t));
        } catch (err) {
          console.error(`[temp ${t.id}]`, err.message);
        }
      }
    }

    const line = results
      .map((r) =>
        r.kind === 'gps'
          ? `${r.id}@${r.leg}`
          : `${r.id}=${r.temperature}°C`
      )
      .join(' | ');

    console.log(`[${new Date().toLocaleTimeString()}] #${tick}  ${line}`);

    if (ONCE) break;
    await sleep(INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});