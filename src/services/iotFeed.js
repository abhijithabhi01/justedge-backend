/**
 * iotFeed.js — reads live sensor data from DynamoDB (IoT team's table).
 * Used by the /api/iot/* routes to serve real readings to the dashboard.
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
 * Latest reading for a single device.
 * Returns null if no data found.
 */
export async function getLatestReading(deviceId) {
  const res = await client.send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'deviceId = :did',
    ExpressionAttributeValues: { ':did': deviceId },
    ScanIndexForward:          false,   // newest first
    Limit:                     1,
  }));
  return res.Items?.[0] ?? null;
}

/**
 * Latest N readings for a single device (for sparkline / history).
 */
export async function getRecentReadings(deviceId, limit = 20) {
  const res = await client.send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'deviceId = :did',
    ExpressionAttributeValues: { ':did': deviceId },
    ScanIndexForward:          false,
    Limit:                     limit,
  }));
  return res.Items ?? [];
}

/**
 * Latest reading across ALL devices (one scan, returns last `limit` items).
 * Only use for small tables / dev — on large tables prefer per-device queries.
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
 * Handles the `test_001` bug where temperature lands in extras.
 */
export function normalise(item) {
  if (!item) return null;
  const temp = item.temperature ?? item.extras?.temperature ?? null;
  return {
    deviceId:    item.deviceId,
    temperature: temp !== null ? Number(temp) : null,
    timestamp:   item.timestamp ? Number(item.timestamp) : null,
    recordedAt:  item.timestamp
      ? new Date(Number(item.timestamp) * 1000).toISOString()
      : null,
  };
}