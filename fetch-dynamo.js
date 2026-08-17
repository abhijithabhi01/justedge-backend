import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION          || 'ap-southeast-2';
const TABLE  = process.env.DYNAMODB_TABLE_NAME || 'SensorData';
const KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const SECRET = process.env.AWS_SECRET_ACCESS_KEY;

if (!KEY_ID || !SECRET) {
  console.error('[dynamo] Missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY in .env');
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION, credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET } }),
  { unmarshallOptions: { wrapNumbers: false } }
);

async function fetchByDevice(deviceId, limit = 1) {
  const res = await client.send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'deviceId = :did',
    ExpressionAttributeValues: { ':did': deviceId },
    ScanIndexForward:          false,
    Limit:                     limit,
  }));
  return res.Items ?? [];
}

async function fetchAll(limit = 10) {
  const res = await client.send(new ScanCommand({ TableName: TABLE, Limit: limit }));
  return res.Items ?? [];
}

function display(items) {
  if (!items.length) { console.log('  (no data)'); return; }
  items.forEach(item => {
    const temp = item.temperature ?? item.extras?.temperature ?? '—';
    const ts   = item.timestamp
      ? new Date(Number(item.timestamp) * 1000).toLocaleTimeString('en-IN')
      : 'N/A';
    console.log(`  deviceId: ${item.deviceId}  |  temp: ${temp}°C  |  recorded: ${ts}`);
  });
}

const POLL_MS = 5000;
const [,, deviceArg] = process.argv;

console.log(`Hearth Live Monitor — polling every ${POLL_MS / 1000}s (Ctrl+C to stop)\n`);

async function poll() {
  try {
    const items = deviceArg
      ? await fetchByDevice(deviceArg, 1)
      : await fetchAll(10);

    console.log(`[${new Date().toLocaleTimeString('en-IN')}]`);
    display(items);
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      console.error(`[dynamo] Table "${TABLE}" not found`);
    } else {
      console.error('[dynamo] Error:', err.message);
    }
  }
}

poll();
setInterval(poll, POLL_MS);

export { fetchByDevice, fetchAll };