import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  }),
  { unmarshallOptions: { wrapNumbers: false } }
);

const TABLE = process.env.DYNAMODB_TABLE_NAME || 'SensorData';

/** Partition-key attribute name on the Dynamo table */
function deviceKeyName() {
  if (process.env.DYNAMODB_DEVICE_KEY) {
    return process.env.DYNAMODB_DEVICE_KEY.trim();
  }
  // New GPS table uses deviceName; legacy uses deviceId
  if (/gps/i.test(TABLE) || TABLE === 'GPS_Device_Data') return 'deviceName';
  return 'deviceId';
}

export const BOARDS = [
  { deviceId: 'Susima_IoT1', label: 'Susima IoT 1' },
  { deviceId: 'DynamoDB_2', label: 'DynamoDB 2' },
  { deviceId: 'DynamoDB_3', label: 'DynamoDB 3' },
  { deviceId: 'DynamoDB_4', label: 'DynamoDB 4' },
  { deviceId: 'ESP32_001', label: 'GPS Board ESP32_001' },
  { deviceId: 'ABHIJITH', label: 'ABHIJITH GPS' },
];

/**
 * List distinct device ids present in the table (for Add sensor → Live AWS device).
 */
export async function discoverBoards() {
  const ids = new Set();
  const keyName = deviceKeyName();
  let ExclusiveStartKey;

  try {
    do {
      const res = await client.send(
        new ScanCommand({
          TableName: TABLE,
          // Project both common key names so mixed tables still work
          ProjectionExpression: 'deviceId, deviceName',
          ExclusiveStartKey,
        })
      );
      for (const item of res.Items ?? []) {
        const id = item[keyName] || item.deviceId || item.deviceName;
        if (id) ids.add(String(id));
      }
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  } catch (err) {
    console.error('[iotFeed] discoverBoards error:', err.message);
    return BOARDS;
  }

  if (!ids.size) return BOARDS;

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

/**
 * Pull lat/lng out of common shapes:
 *  - top-level latitude/longitude / lat/lng
 *  - locations: [{ lat, lng }] or Dynamo map/list forms
 */
export function extractCoords(item) {
  if (!item || typeof item !== 'object') {
    return { lat: null, lng: null };
  }

  let lat = item.latitude ?? item.lat ?? item.extras?.latitude ?? null;
  let lng =
    item.longitude ?? item.lng ?? item.lon ?? item.extras?.longitude ?? null;

  if (lat == null || lng == null) {
    const locs = item.locations ?? item.location;
    const first = Array.isArray(locs) ? locs[0] : locs;
    if (first && typeof first === 'object') {
      // Document-client unmarshalled: { lat, lng } or { latitude, longitude }
      lat = lat ?? first.latitude ?? first.lat ?? first.M?.lat?.N ?? first.M?.latitude?.N ?? null;
      lng =
        lng ??
        first.longitude ??
        first.lng ??
        first.lon ??
        first.M?.lng?.N ??
        first.M?.longitude?.N ??
        null;
      // Nested L list of N numbers [lat, lng]
      if ((lat == null || lng == null) && Array.isArray(first.L) && first.L.length >= 2) {
        lat = lat ?? first.L[0]?.N ?? first.L[0];
        lng = lng ?? first.L[1]?.N ?? first.L[1];
      }
    }
  }

  const latN = lat != null && Number.isFinite(Number(lat)) ? Number(lat) : null;
  const lngN = lng != null && Number.isFinite(Number(lng)) ? Number(lng) : null;
  return { lat: latN, lng: lngN };
}

async function queryRecentItems(deviceId, limit = 40) {
  const keyName = deviceKeyName();
  try {
    const res = await client.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: `${keyName} = :did`,
        ExpressionAttributeValues: { ':did': deviceId },
        ScanIndexForward: false,
        Limit: limit,
      })
    );
    return res.Items ?? [];
  } catch (err) {
    // Fallback: try the other key name once
    const alt = keyName === 'deviceId' ? 'deviceName' : 'deviceId';
    if (alt === keyName) throw err;
    try {
      const res = await client.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: `${alt} = :did`,
          ExpressionAttributeValues: { ':did': deviceId },
          ScanIndexForward: false,
          Limit: limit,
        })
      );
      return res.Items ?? [];
    } catch (err2) {
      console.error(`[iotFeed] queryRecentItems(${deviceId}) error:`, err2.message);
      return [];
    }
  }
}

function isTelemetry(item) {
  // GPS_Device_Data rows often have no `type` — treat rows with temperature/locations as telemetry
  if (item.type) return item.type === 'telemetry';
  return (
    item.temperature != null ||
    item.locations != null ||
    item.latitude != null ||
    item.lat != null
  );
}

function isConnection(item) {
  return item.type === 'connection';
}

/**
 * Latest telemetry for a device.
 */
export async function getLatestReading(deviceId) {
  try {
    const items = await queryRecentItems(deviceId, 40);
    if (!items.length) return null;

    const telemetry = items.filter(isTelemetry);
    const locations = items.filter((i) => (i.type || '') === 'location');
    locations.sort((a, b) => (toEpochMs(b.timestamp) || 0) - (toEpochMs(a.timestamp) || 0));
    const installLoc = locations[0] || null;

    if (!telemetry.length) {
      return installLoc || items[0] || null;
    }
    telemetry.sort((a, b) => (toEpochMs(b.timestamp) || 0) - (toEpochMs(a.timestamp) || 0));
    const tel = { ...telemetry[0] };

    const coords = extractCoords(tel);
    if (coords.lat == null || coords.lng == null) {
      if (installLoc) {
        const ic = extractCoords(installLoc);
        tel.latitude = ic.lat;
        tel.longitude = ic.lng;
        tel.site = installLoc.site || tel.site || '';
        tel._locationSource = 'install';
      }
    } else {
      tel.latitude = coords.lat;
      tel.longitude = coords.lng;
      tel._locationSource = 'gps';
    }
    // Ensure device id is always present for normalise()
    tel.deviceId = tel.deviceId || tel.deviceName || deviceId;
    tel.deviceName = tel.deviceName || tel.deviceId || deviceId;
    return tel;
  } catch (err) {
    console.error(`[iotFeed] getLatestReading(${deviceId}) error:`, err.message);
    return null;
  }
}

export async function putDeviceLocation(deviceId, { lat, lng, site } = {}) {
  if (!deviceId) return false;
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  const keyName = deviceKeyName();
  try {
    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          [keyName]: String(deviceId),
          timestamp: String(nowSec),
          type: 'location',
          status: 'ONLINE',
          latitude,
          longitude,
          locations: [{ lat: latitude, lng: longitude }],
          site: site ? String(site).slice(0, 300) : '',
          source: 'justedge-app',
          lastSeen: nowSec,
        },
      })
    );
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
    if (!connections.length) {
      // No explicit connection rows — infer from latest telemetry freshness
      const tel = items.find(isTelemetry);
      if (!tel) return null;
      return {
        status: null,
        recordedAtMs: toEpochMs(tel.timestamp),
      };
    }
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
  // GPS_Device_Data often has no status — recent telemetry ⇒ online
  if (telMs && now - telMs <= OFFLINE_AFTER_MS) return 'online';
  if (telMs) return 'offline';
  return 'unknown';
}

export async function getRecentReadings(deviceId, limit = 20) {
  return queryRecentItems(deviceId, limit);
}

export async function getAllBoardReadings() {
  const boards = await discoverBoards();
  const results = await Promise.all(
    boards.map(async (board) => {
      const item = await getLatestReading(board.deviceId);
      const normalised = normalise(item);
      if (normalised) {
        normalised.label = board.label;
      }
      return {
        deviceId: board.deviceId,
        label: board.label,
        reading: normalised,
      };
    })
  );
  return results;
}

export async function getAllLatestReadings(limit = 50) {
  const res = await client.send(
    new ScanCommand({
      TableName: TABLE,
      Limit: limit,
    })
  );
  return res.Items ?? [];
}

export function normalise(item) {
  if (!item) return null;
  const temp = item.temperature ?? item.extras?.temperature ?? null;
  const ms = toEpochMs(item.timestamp);
  const { lat, lng } = extractCoords(item);
  const deviceId = item.deviceId || item.deviceName || item.device_id || null;

  // Pass through extra numeric attributes so the UI can show more channels later
  const extras = {};
  for (const [k, v] of Object.entries(item)) {
    if (
      ['deviceId', 'deviceName', 'timestamp', 'type', 'status', 'locations', 'location', 'latitude', 'longitude', 'lat', 'lng', 'lon', 'temperature', 'extras', 'site', 'source', 'lastSeen', 'fw', 'seq'].includes(
        k
      )
    ) {
      continue;
    }
    if (v != null && (typeof v === 'number' || (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))))) {
      extras[k] = Number(v);
    } else if (v != null && typeof v !== 'object') {
      extras[k] = v;
    }
  }

  return {
    deviceId,
    temperature: temp !== null && temp !== undefined ? Number(temp) : null,
    latitude: lat,
    longitude: lng,
    site: item.site || '',
    locationSource: item._locationSource || (item.type === 'location' ? 'install' : null),
    timestamp: item.timestamp != null ? Number(item.timestamp) : null,
    recordedAt: ms ? new Date(ms).toISOString() : null,
    status: item.status ? String(item.status).toLowerCase() : 'unknown',
    type: item.type || 'telemetry',
    fw: item.fw ?? null,
    seq: item.seq ?? null,
    extras,
  };
}