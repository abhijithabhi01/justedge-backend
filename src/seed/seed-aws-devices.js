import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const ddb = DynamoDBDocumentClient.from(client, {
  unmarshallOptions: { wrapNumbers: false },
});

const TABLE =
  process.env.DYNAMODB_TABLE_NAME ||
  process.env.DYNAMO_TABLE ||
  'GPS_Device_Data';

function deviceKeyName() {
  if (process.env.DYNAMODB_DEVICE_KEY) return process.env.DYNAMODB_DEVICE_KEY.trim();
  if (/gps/i.test(TABLE) || TABLE === 'GPS_Device_Data') return 'deviceName';
  return 'deviceId';
}

/**
 * Devices to seed. `id` is stored under the partition key (deviceName / deviceId).
 * Adjust coordinates / names to match your physical boards.
 */
const DEVICES = [
  {
    id: 'ABHIJITH',
    lat: 12.2958,
    lng: 76.6394,
    site: 'Mysore · sample',
    temperature: 28.5,
  },
  // Add more GPS_Device_Data deviceNames here as needed:
  // { id: 'WAREHOUSE_1', lat: 12.97, lng: 77.59, site: 'Bengaluru', temperature: 26.0 },
];

async function countItemsForDevice(id) {
  const keyName = deviceKeyName();
  try {
    const res = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: `${keyName} = :id`,
        ExpressionAttributeValues: { ':id': id },
        Select: 'COUNT',
        Limit: 1,
      })
    );
    return res.Count ?? 0;
  } catch (err) {
    console.warn(`[warn] query ${id}: ${err.message}`);
    return -1;
  }
}

/**
 * GPS_Device_Data uses composite key (deviceName, timestamp).
 * We always Put a new telemetry/location row with a fresh timestamp.
 */
async function putReading(device) {
  const keyName = deviceKeyName();
  const ts = String(Date.now()); // sort key — must exist on GPS_Device_Data

  const item = {
    [keyName]: device.id,
    // Also set the alternate name so readers that look for either key work
    deviceName: device.id,
    deviceId: device.id,
    timestamp: ts,
    temperature: device.temperature ?? null,
    locations: [
      {
        lat: device.lat,
        lng: device.lng,
        site: device.site || '',
      },
    ],
    latitude: device.lat,
    longitude: device.lng,
    site: device.site || '',
    status: 'ONLINE',
    type: 'telemetry',
    source: 'justedge-seed',
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: item,
    })
  );
}

async function main() {
  const keyName = deviceKeyName();
  console.log(`[seed-aws-devices] table   : ${TABLE}`);
  console.log(`[seed-aws-devices] region  : ${process.env.AWS_REGION || 'ap-southeast-2'}`);
  console.log(`[seed-aws-devices] key     : ${keyName}`);
  console.log(`[seed-aws-devices] devices : ${DEVICES.length}\n`);

  let ok = 0;
  let failed = 0;

  for (const device of DEVICES) {
    try {
      const existing = await countItemsForDevice(device.id);
      if (existing === 0) {
        console.log(`[info]  ${device.id} — no prior rows (will create first)`);
      } else if (existing > 0) {
        console.log(`[info]  ${device.id} — table already has rows (appending new reading)`);
      }

      await putReading(device);
      console.log(
        `[OK]    ${device.id} → ${device.site || '—'} (${device.lat}, ${device.lng}) temp=${device.temperature ?? '—'}`
      );
      ok++;
    } catch (err) {
      console.error(`[FAIL]  ${device.id} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\n[seed-aws-devices] done — ${ok} written, ${failed} failed.`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed-aws-devices] fatal:', err);
  process.exit(1);
});