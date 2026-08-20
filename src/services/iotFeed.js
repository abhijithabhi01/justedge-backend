/**
 * iotFeed.js — reads live sensor data from DynamoDB (IoT team's table).
 * All boards share the same table (SensorData); they are distinguished by deviceId.
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

const TABLE = process.env.DYNAMODB_TABLE_NAME || 'SensorData';

/**
 * Known boards — all live in the same SensorData table, keyed by deviceId.
 * deviceId values match what the IoT devices write into DynamoDB.
 */
export const BOARDS = [
  { deviceId: 'Susima_IoT1', label: 'Susima IoT 1' },
  { deviceId: 'DynamoDB_2',  label: 'DynamoDB 2' },
  { deviceId: 'DynamoDB_3',  label: 'DynamoDB 3' },
  { deviceId: 'DynamoDB_4',  label: 'DynamoDB 4' },
];

/**
 * Latest reading for a single device (Query on deviceId, newest first).
 */
export async function getLatestReading(deviceId) {
  try {
    const res = await client.send(new QueryCommand({
      TableName:                 TABLE,
      KeyConditionExpression:    'deviceId = :did',
      ExpressionAttributeValues: { ':did': deviceId },
      ScanIndexForward:          false,   // newest first
      Limit:                     1,
    }));
    return res.Items?.[0] ?? null;
  } catch (err) {
    console.error(`[iotFeed] getLatestReading(${deviceId}) error:`, err.message);
    return null;
  }
}

/**
 * Latest N readings for a single device (for history / sparkline).
 */
export async function getRecentReadings(deviceId, limit = 20) {
  try {
    const res = await client.send(new QueryCommand({
      TableName:                 TABLE,
      KeyConditionExpression:    'deviceId = :did',
      ExpressionAttributeValues: { ':did': deviceId },
      ScanIndexForward:          false,
      Limit:                     limit,
    }));
    return res.Items ?? [];
  } catch (err) {
    console.error(`[iotFeed] getRecentReadings(${deviceId}) error:`, err.message);
    return [];
  }
}

/**
 * Latest reading for every known board (parallel queries against the same table).
 */
export async function getAllBoardReadings() {
  const results = await Promise.all(
    BOARDS.map(async (board) => {
      const item = await getLatestReading(board.deviceId);
      const normalised = normalise(item);
      if (normalised) {
        normalised.label = board.label;
      }
      return {
        deviceId: board.deviceId,
        label:    board.label,
        reading:  normalised,
      };
    })
  );
  return results;
}

/**
 * Latest reading across ALL devices (one scan — legacy helper).
 * Prefer per-device queries on large tables.
 */
export async function getAllLatestReadings(limit = 50) {
  const res = await client.send(new ScanCommand({
    TableName: TABLE,
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
