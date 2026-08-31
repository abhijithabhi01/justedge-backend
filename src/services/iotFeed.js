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
 * Fallback labels only — used to prettify a deviceId if `discoverBoards()`
 * finds it live in the table. Not the source of truth for which boards
 * exist; that's always the table itself (see discoverBoards below), so a
 * new physical board shows up for admins the moment it starts writing to
 * DynamoDB, with no code change here.
 */
export const BOARDS = [
  { deviceId: 'Susima_IoT1', label: 'Susima IoT 1' },
  { deviceId: 'DynamoDB_2',  label: 'DynamoDB 2' },
  { deviceId: 'DynamoDB_3',  label: 'DynamoDB 3' },
  { deviceId: 'DynamoDB_4',  label: 'DynamoDB 4' },
  { deviceId: 'ESP32_001',   label: 'GPS Board ESP32_001' },
];

/**
 * Discover every distinct deviceId currently reporting into the table, by
 * scanning it (paginating past the 1 MB-per-page limit) and deduping. Fine
 * at this table's scale (tens to low thousands of rows); if the table
 * grows large, this should move to a small side table of known deviceIds
 * maintained by the ingest pipeline instead of a full scan.
 */
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
    // Fall back to the known-labels list rather than leaving admins with
    // nothing to pick from if the scan itself fails (e.g. permissions).
    return BOARDS;
  }

  const knownLabels = new Map(BOARDS.map((b) => [b.deviceId, b.label]));
  return [...ids].sort().map((deviceId) => ({
    deviceId,
    label: knownLabels.get(deviceId) || deviceId,
  }));
}

/**
 * DynamoDB rows mix timestamp units:
 * - telemetry: usually unix *seconds*
 * - connection: often Date.now() *milliseconds*
 * Values > 1e12 are treated as ms; otherwise as seconds.
 */
export function toEpochMs(ts) {
  if (ts == null || ts === '') return null;
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

/**
 * Query a page of recent items for one device (mixed telemetry + connection).
 */
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
 * Latest telemetry row for a single device (for temperature / sensors).
 *
 * The table mixes `type: "telemetry"` and `type: "connection"`. Connection
 * timestamps are often in ms while telemetry is in seconds, so a raw
 * "newest first" pick is unreliable — we score by real wall-clock time.
 */
export async function getLatestReading(deviceId) {
  try {
    const items = await queryRecentItems(deviceId, 40);
    const telemetry = items.filter(isTelemetry);
    if (!telemetry.length) {
      return items[0] ?? null;
    }
    telemetry.sort((a, b) => (toEpochMs(b.timestamp) || 0) - (toEpochMs(a.timestamp) || 0));
    return telemetry[0];
  } catch (err) {
    console.error(`[iotFeed] getLatestReading(${deviceId}) error:`, err.message);
    return null;
  }
}

/**
 * Latest connection status for a device (ONLINE / OFFLINE events).
 * Returns { status, recordedAtMs } or null if no connection rows found.
 */
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

/**
 * How long after the last telemetry (or connection) we still treat a board
 * as online when connection events are missing. Override with
 * AWS_OFFLINE_AFTER_MS in .env (default 5 minutes).
 */
const OFFLINE_AFTER_MS = Number(process.env.AWS_OFFLINE_AFTER_MS) || 10 * 1000;

/**
 * Resolve display status for a device:
 * 1. Prefer latest connection event (ONLINE/OFFLINE).
 * 2. Else use status on the latest telemetry row if present.
 * 3. If the newest signal is older than OFFLINE_AFTER_MS → offline.
 * 4. Otherwise unknown.
 */
export function resolveDeviceStatus({ connection, telemetryItem, now = Date.now() }) {
  const telMs = telemetryItem ? toEpochMs(telemetryItem.timestamp) : null;
  const connMs = connection?.recordedAtMs ?? null;
  const newestMs = Math.max(telMs || 0, connMs || 0) || null;

  // Prefer connection event when it is at least as recent as telemetry
  // (or when there is no telemetry status).
  if (connection?.status) {
    if (!telMs || !connMs || connMs >= telMs - 1000) {
      // Still mark offline if everything is stale
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
 * Handles temperature in extras and mixed second/millisecond timestamps.
 */
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
    timestamp:   item.timestamp != null ? Number(item.timestamp) : null,
    recordedAt:  ms ? new Date(ms).toISOString() : null,
    status: item.status ? String(item.status).toLowerCase() : 'unknown',
    type:   item.type || 'telemetry',
    fw:     item.fw ?? null,
    seq:    item.seq ?? null,
  };
}