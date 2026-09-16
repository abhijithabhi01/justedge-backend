/**
 * In-process fleet simulator — starts with the API server.
 * Writes GPS + temperature telemetry to DynamoDB (GPS_Device_Data).
 *
 * Boards:
 *   ONENESS1222  Nagercoil → Madurai → Chennai (round trip)
 *   KALLADA6444  Chennai → Hyderabad (round trip)
 *   SURYA8001    Chennai → Bengaluru (round trip)
 *   ONENESS9845  Kochi → Bengaluru (round trip)
 *   TEMP_BOARD_01 / 02 / 03  fixed-site temperature
 *
 * Env:
 *   FLEET_SIMULATOR_ENABLED=false  → skip
 *   FLEET_SIMULATOR_INTERVAL_MS    → default 3000
 *   Requires AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
 *   DYNAMODB_TABLE_NAME (default GPS_Device_Data)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const STEPS_PER_LEG = 8;

const NAGERCOIL_MADURAI_CHENNAI = [
  { name: 'Nagercoil', lat: 8.1833, lng: 77.4119 },
  { name: 'Tirunelveli', lat: 8.7139, lng: 77.7567 },
  { name: 'Kovilpatti', lat: 9.1717, lng: 77.869 },
  { name: 'Virudhunagar', lat: 9.568, lng: 77.9624 },
  { name: 'Madurai', lat: 9.9252, lng: 78.1198 },
  { name: 'Dindigul', lat: 10.362, lng: 77.98 },
  { name: 'Karur', lat: 10.9601, lng: 78.0766 },
  { name: 'Salem', lat: 11.6643, lng: 78.146 },
  { name: 'Viluppuram', lat: 11.9401, lng: 79.4861 },
  { name: 'Chengalpattu', lat: 12.6819, lng: 79.9888 },
  { name: 'Tambaram', lat: 12.9249, lng: 80.1 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
];

const CHENNAI_HYDERABAD = [
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Nellore', lat: 14.4426, lng: 79.9865 },
  { name: 'Ongole', lat: 15.5057, lng: 80.0499 },
  { name: 'Vijayawada', lat: 16.5062, lng: 80.648 },
  { name: 'Guntur', lat: 16.3067, lng: 80.4365 },
  { name: 'Suryapet', lat: 17.1405, lng: 79.6208 },
  { name: 'Nalgonda', lat: 17.0575, lng: 79.267 },
  { name: 'Hyderabad', lat: 17.385, lng: 78.4867 },
];

const CHENNAI_BANGALORE = [
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Tambaram', lat: 12.9249, lng: 80.1 },
  { name: 'Chengalpattu', lat: 12.6819, lng: 79.9888 },
  { name: 'Kanchipuram', lat: 12.8342, lng: 79.7036 },
  { name: 'Vellore', lat: 12.9165, lng: 79.1325 },
  { name: 'Ambur', lat: 12.79, lng: 78.716 },
  { name: 'Krishnagiri', lat: 12.5186, lng: 78.2137 },
  { name: 'Hosur', lat: 12.7409, lng: 77.8253 },
  { name: 'Electronic City', lat: 12.845, lng: 77.66 },
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
];

const KOCHI_BANGALORE = [
  { name: 'Kochi', lat: 9.9312, lng: 76.2673 },
  { name: 'Thrissur', lat: 10.5276, lng: 76.2144 },
  { name: 'Palakkad', lat: 10.7867, lng: 76.6548 },
  { name: 'Coimbatore', lat: 11.0168, lng: 76.9558 },
  { name: 'Erode', lat: 11.341, lng: 77.717 },
  { name: 'Salem', lat: 11.6643, lng: 78.146 },
  { name: 'Dharmapuri', lat: 12.1357, lng: 78.158 },
  { name: 'Krishnagiri', lat: 12.5186, lng: 78.2137 },
  { name: 'Hosur', lat: 12.7409, lng: 77.8253 },
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
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
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

function makeGpsBoard(id, label, routeLabel, waypoints) {
  return {
    id,
    label,
    routeLabel,
    path: buildRoundTrip(waypoints),
    index: 0,
  };
}

const GPS_BOARDS = [
  makeGpsBoard('ONENESS1222', 'Oneness 1222', 'Nagercoil→Madurai→Chennai', NAGERCOIL_MADURAI_CHENNAI),
  makeGpsBoard('KALLADA6444', 'Kallada 6444', 'Chennai→Hyderabad', CHENNAI_HYDERABAD),
  makeGpsBoard('SURYA8001', 'Surya 8001', 'Chennai↔Bengaluru', CHENNAI_BANGALORE),
  makeGpsBoard('ONENESS9845', 'Oneness 9845', 'Kochi↔Bengaluru', KOCHI_BANGALORE),
];

const TEMP_BOARDS = [
  { id: 'TEMP_BOARD_01', site: 'Ballari Warehouse A', lat: 15.1394, lng: 76.9214, baseTemp: 24.5 },
  { id: 'TEMP_BOARD_02', site: 'Chennai Cold Store', lat: 13.0827, lng: 80.2707, baseTemp: 6.0 },
  { id: 'TEMP_BOARD_03', site: 'Hosur Plant Floor', lat: 12.7409, lng: 77.8253, baseTemp: 28.0 },
];

let timer = null;
let client = null;
let KEY = 'deviceName';
let TABLE = 'GPS_Device_Data';

function driftTemp(base) {
  const wave = Math.sin(Date.now() / 45000) * 1.8;
  const noise = (Math.random() - 0.5) * 0.6;
  return Math.round((base + wave + noise) * 10) / 10;
}

function getClient() {
  if (client) return client;
  client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'ap-southeast-2',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    }),
    { unmarshallOptions: { wrapNumbers: false } }
  );
  return client;
}

async function putItem(item) {
  await getClient().send(new PutCommand({ TableName: TABLE, Item: item }));
}

async function tickGps(board) {
  const p = board.path[board.index % board.path.length];
  const jitterLat = (Math.random() - 0.5) * 0.001;
  const jitterLng = (Math.random() - 0.5) * 0.001;
  const lat = Number((p.lat + jitterLat).toFixed(6));
  const lng = Number((p.lng + jitterLng).toFixed(6));
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
}

async function tickAll() {
  for (const g of GPS_BOARDS) {
    try {
      await tickGps(g);
    } catch (err) {
      console.error(`[fleet-sim] gps ${g.id}:`, err.message);
    }
  }
  for (const t of TEMP_BOARDS) {
    try {
      await tickTemp(t);
    } catch (err) {
      console.error(`[fleet-sim] temp ${t.id}:`, err.message);
    }
  }
}

/**
 * Start background fleet writers. Safe to call once after server listen.
 */
export function startFleetSimulator() {
  const enabled = String(process.env.FLEET_SIMULATOR_ENABLED ?? 'true').toLowerCase();
  if (enabled === 'false' || enabled === '0' || enabled === 'off') {
    console.log('[fleet-sim] disabled (FLEET_SIMULATOR_ENABLED=false)');
    return;
  }

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log('[fleet-sim] skipped — missing AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY');
    return;
  }

  if (timer) return;

  TABLE =
    process.env.DYNAMODB_TABLE_NAME ||
    process.env.DYNAMO_TABLE ||
    'GPS_Device_Data';

  if (process.env.DYNAMODB_DEVICE_KEY) {
    KEY = process.env.DYNAMODB_DEVICE_KEY.trim();
  } else if (/gps/i.test(TABLE) || TABLE === 'GPS_Device_Data') {
    KEY = 'deviceName';
  } else {
    KEY = 'deviceId';
  }

  const intervalMs = Number(process.env.FLEET_SIMULATOR_INTERVAL_MS || 3000);

  const run = () => {
    tickAll().catch((err) => console.error('[fleet-sim] tick failed:', err.message));
  };

  run();
  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  console.log(
    `[fleet-sim] writing ${GPS_BOARDS.length} GPS + ${TEMP_BOARDS.length} temp boards → ${TABLE} every ${intervalMs}ms`
  );
  console.log(
    `[fleet-sim] devices: ${[...GPS_BOARDS.map((g) => g.id), ...TEMP_BOARDS.map((t) => t.id)].join(', ')}`
  );
}

export function stopFleetSimulator() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
