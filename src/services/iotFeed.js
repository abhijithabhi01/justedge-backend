/**
 * iotFeed.js — reads live sensor data from DynamoDB (IoT team's table).
 * All boards share the same table (SensorData); they are distinguished by deviceId.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

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

export const BOARDS = [
  { deviceId: 'Susima_IoT1', label: 'Susima IoT 1' },
  { deviceId: 'DynamoDB_2',  label: 'DynamoDB 2' },
  { deviceId: 'DynamoDB_3',  label: 'DynamoDB 3' },
  { deviceId: 'DynamoDB_4',  label: 'DynamoDB 4' },
  { deviceId: 'ESP32_001',   label: 'GPS Board ESP32_001' },
];

export async function discoverBoards() {
  const ids = new Set();
  let ExclusiveStartKey;

  try {
    do {
      const res = await client.send(new ScanCommand({
        TableName:            TABLE,
        ProjectionExpression: 'deviceId',
        ExclusiveStartKey,
      }));
      for (const item of res.Items ?? []) {
        if (item.deviceId) ids.add(item.deviceId);
      }
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  } catch (err) {
    console.error('[iotFeed] discoverBoards error:', err.message);
    return BOARDS;
  }

  const knownLabels = new Map(BOARDS.map((b) => [b.deviceId, b.label]));
  return [...ids].sort().map((deviceId) => ({
    deviceId,
    label: knownLabels.get(deviceId) || deviceId,
  }));
}

export function toEpochMs(ts) {
  if (ts == null || ts === '') return null;
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

async function queryRecentItems(deviceId, limit = 40) {
  const res = await client.send(new QueryCommand({
    TableName:                 TABLE,
    KeyConditionExpression:    'deviceId = :did',
    ExpressionAttributeValues: { ':did': deviceId },
    ScanIndexForward:          false,
    Limit:                     limit,
  }));
  return res.Items ?? [];
}

function isTelemetry(item) {
  return (item.type || 'telemetry') === 'telemetry';
}

function isConnection(item) {
  return item.type === 'connection';
}

/**
 * Latest telemetry for a device.
 * GPS on telemetry wins; otherwise merge app-written type:"location".
 */
export async function getLatestReading(deviceId) {
  try {
    const items = await queryRecentItems(deviceId, 40);
    const telemetry = items.filter(isTelemetry);
    const locations = items.filter((i) => (i.type || '') === 'location');
    locations.sort((a, b) => (toEpochMs(b.timestamp) || 0) - (toEpochMs(a.timestamp) || 0));
    const installLoc = locations[0] || null;

    if (!telemetry.length) {
      return installLoc || items[0] || null;
    }
    telemetry.sort((a, b) => (toEpochMs(b.timestamp) || 0) - (toEpochMs(a.timestamp) || 0));
    const tel = { ...telemetry[0] };

    const hasGps =
      (tel.latitude != null || tel.lat != null) &&
      (tel.longitude != null || tel.lng != null || tel.lon != null);
    if (!hasGps && installLoc) {
      tel.latitude = installLoc.latitude ?? installLoc.lat ?? null;
      tel.longitude = installLoc.longitude ?? installLoc.lng ?? installLoc.lon ?? null;
      tel.site = installLoc.site || tel.site || '';
      tel._locationSource = 'install';
    } else if (hasGps) {
      tel._locationSource = 'gps';
    }
    return tel;
  } catch (err) {
    console.error(`[iotFeed] getLatestReading(${deviceId}) error:`, err.message);
    return null;
  }
}

/**
 * Fixed install location for non-GPS boards (temp sensors).
 * GPS telemetry lat/lng still takes priority when present.
 */
export async function putDeviceLocation(deviceId, { lat, lng, site } = {}) {
  if (!deviceId) return false;
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  try {
    await client.send(new PutCommand({
      TableName: TABLE,
      Item: {
        deviceId: String(deviceId),
        timestamp: nowSec,
        type: 'location',
        status: 'ONLINE',
        latitude,
        longitude,
        site: site ? String(site).slice(0, 300) : '',
        source: 'justedge-app',
        lastSeen: nowSec,
      },
    }));
    return true;
  } catch (err) {
    console.error('[iotFeed] putDeviceLocation error:', err.message);
    return false;
  }
}

export async function getLatestConnectionStatus(deviceId) {
  try {
    const items = await queryRecentItems(deviceId, 40);
    const connections = items.filter(isConnection);
    if (!connections.length) return null;
    connections.sort((a, b) => (toEpochMs(b.timestamp) || 0) - (toEpochMs(a.timestamp) || 0));
    const latest = connections[0];
    const status = latest.status ? String(latest.status).toLowerCase() : null;
    return {
      status: status === 'online' || status === 'offline' ? status : null,
      recordedAtMs: toEpochMs(latest.timestamp),
    };
  } catch (err) {
    console.error(`[iotFeed] getLatestConnectionStatus(${deviceId}) error:`, err.message);
    return null;
  }
}

const OFFLINE_AFTER_MS = Number(process.env.AWS_OFFLINE_AFTER_MS) || 10 * 1000;

export function resolveDeviceStatus({ connection, telemetryItem, now = Date.now() }) {
  const telMs = telemetryItem ? toEpochMs(telemetryItem.timestamp) : null;
  const connMs = connection?.recordedAtMs ?? null;
  const newestMs = Math.max(telMs || 0, connMs || 0) || null;

  if (connection?.status) {
    if (!telMs || !connMs || connMs >= telMs - 1000) {
      if (newestMs && now - newestMs > OFFLINE_AFTER_MS) return 'offline';
      return connection.status;
    }
  }

  const telStatus = telemetryItem?.status
    ? String(telemetryItem.status).toLowerCase()
    : null;

  if (newestMs && now - newestMs > OFFLINE_AFTER_MS) {
    return 'offline';
  }

  if (telStatus === 'online' || telStatus === 'offline') return telStatus;
  if (connection?.status) return connection.status;
  return 'unknown';
}

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

export async function getAllLatestReadings(limit = 50) {
  const res = await client.send(new ScanCommand({
    TableName: TABLE,
    Limit:     limit,
  }));
  return res.Items ?? [];
}

export function normalise(item) {
  if (!item) return null;
  const temp = item.temperature ?? item.extras?.temperature ?? null;
  const ms = toEpochMs(item.timestamp);
  const lat = item.latitude ?? item.lat ?? item.extras?.latitude ?? null;
  const lng = item.longitude ?? item.lng ?? item.lon ?? item.extras?.longitude ?? null;
  return {
    deviceId:    item.deviceId || item.device_id || null,
    temperature: temp !== null ? Number(temp) : null,
    latitude:    lat != null && Number.isFinite(Number(lat)) ? Number(lat) : null,
    longitude:   lng != null && Number.isFinite(Number(lng)) ? Number(lng) : null,
    site:        item.site || '',
    locationSource: item._locationSource || (item.type === 'location' ? 'install' : null),
    timestamp:   item.timestamp != null ? Number(item.timestamp) : null,
    recordedAt:  ms ? new Date(ms).toISOString() : null,
    status: item.status ? String(item.status).toLowerCase() : 'unknown',
    type:   item.type || 'telemetry',
    fw:     item.fw ?? null,
    seq:    item.seq ?? null,
  };
}