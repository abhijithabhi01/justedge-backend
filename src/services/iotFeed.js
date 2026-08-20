/**
 * iotFeed.js — reads live sensor data from DynamoDB (IoT team's tables).
 * Supports multiple boards/tables so the live UI can show every sensor at once.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  }),
  { unmarshallOptions: { wrapNumbers: false } }
);

const DEFAULT_TABLE = process.env.DYNAMODB_TABLE_NAME || 'SensorData';

/**
 * Known boards → DynamoDB table mapping.
 * Susima_IoT1 uses the default SensorData table; the other boards each have
 * their own table (names taken from the AWS console).
 */
export const BOARDS = [
  { deviceId: 'Susima_IoT1', table: DEFAULT_TABLE,    label: 'Susima IoT 1' },
  { deviceId: 'DynamoDB_2',  table: 'DynamoDB_2',     label: 'DynamoDB 2' },
  { deviceId: 'DynamoDB_3',  table: 'DynamoDB_3',     label: 'DynamoDB 3' },
  { deviceId: 'DynamoDB_4',  table: 'DynamoDB_4',     label: 'DynamoDB 4' },
];

/**
 * Latest reading for a single device from a specific table.
 * Tries Query on deviceId first; falls back to a limited Scan if the table
 * has a different key schema (common for single-device tables).
 */
export async function getLatestReading(deviceId, tableName = DEFAULT_TABLE) {
  try {
    const res = await client.send(new QueryCommand({
      TableName:                 tableName,
      KeyConditionExpression:    'deviceId = :did',
      ExpressionAttributeValues: { ':did': deviceId },
      ScanIndexForward:          false,   // newest first
      Limit:                     1,
    }));
    if (res.Items?.[0]) return res.Items[0];
  } catch (err) {
    // Table may not have deviceId as PK — fall through to Scan
    if (err.name !== 'ValidationException' && err.name !== 'ResourceNotFoundException') {
      console.warn(`[iotFeed] Query failed for ${deviceId}@${tableName}:`, err.message);
    }
  }

  // Fallback: scan the table and pick the item with the newest timestamp
  try {
    const res = await client.send(new ScanCommand({
      TableName: tableName,
      Limit:     25,
    }));
    const items = res.Items || [];
    if (!items.length) return null;
    items.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    return items[0];
  } catch (err) {
    console.error(`[iotFeed] Scan failed for ${tableName}:`, err.message);
    return null;
  }
}

/**
 * Latest N readings for a single device (for sparkline / history).
 */
export async function getRecentReadings(deviceId, limit = 20, tableName = DEFAULT_TABLE) {
  try {
    const res = await client.send(new QueryCommand({
      TableName:                 tableName,
      KeyConditionExpression:    'deviceId = :did',
      ExpressionAttributeValues: { ':did': deviceId },
      ScanIndexForward:          false,
      Limit:                     limit,
    }));
    if (res.Items?.length) return res.Items;
  } catch (_) { /* fall through */ }

  try {
    const res = await client.send(new ScanCommand({
      TableName: tableName,
      Limit:     Math.min(limit * 2, 50),
    }));
    const items = (res.Items || []).sort(
      (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
    );
    return items.slice(0, limit);
  } catch (err) {
    console.error(`[iotFeed] getRecentReadings failed:`, err.message);
    return [];
  }
}

/**
 * Latest reading for every known board (parallel).
 * Returns an array of normalised objects (or null entries when a board has no data).
 */
export async function getAllBoardReadings() {
  const results = await Promise.all(
    BOARDS.map(async (board) => {
      const item = await getLatestReading(board.deviceId, board.table);
      const normalised = normalise(item);
      if (normalised) {
        normalised.label = board.label;
        normalised.table = board.table;
      }
      return {
        deviceId: board.deviceId,
        label:    board.label,
        table:    board.table,
        reading:  normalised,
      };
    })
  );
  return results;
}

/**
 * Latest reading across ALL devices in the default table (legacy helper).
 */
export async function getAllLatestReadings(limit = 50) {
  const res = await client.send(new ScanCommand({
    TableName: DEFAULT_TABLE,
    Limit:     limit,
  }));
  return res.Items ?? [];
}

/**
 * Normalise a raw DynamoDB item into a clean shape for the API response.
 * Handles the case where temperature lands in extras.
 */
export function normalise(item) {
  if (!item) return null;
  const temp = item.temperature ?? item.extras?.temperature ?? null;
  return {
    deviceId:    item.deviceId || null,
    temperature: temp !== null ? Number(temp) : null,
    timestamp:   item.timestamp ? Number(item.timestamp) : null,
    recordedAt:  item.timestamp
      ? new Date(Number(item.timestamp) * 1000).toISOString()
      : null,
  };
}
