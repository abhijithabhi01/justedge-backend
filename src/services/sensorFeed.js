import {
  getLatestReading,
  getLatestConnectionStatus,
  resolveDeviceStatus,
  normalise,
  extractCoords,
} from './iotFeed.js';
import { gpsPointForDevice, advanceGlobalIndex } from './gpsRoute.js';

const SOURCE = process.env.SENSOR_DATA_SOURCE || 'mock';

/** Board ids / names that should move on the Kochi↔Bengaluru demo path */
function isGpsBoard(device) {
  const id = String(device?.type || device?.boardId || '').toLowerCase();
  const name = String(device?.name || device?.typeLabel || '').toLowerCase();
  return (
    id.includes('gps') ||
    name.includes('gps') ||
    id === 'gps-board'
  );
}

// One profile per board type — this is the thing that varies across "many
// different embedded boards": each type defines its own 6 sensor channels,
// realistic ranges, and drift rate. Add a new board type by adding a profile
// (or accept the generic fallback below).
const DEVICE_PROFILES = {
  'smart-meter-3phase': {
    label: 'Qubino Smart Meter 3-Phase',
    relayCount: 4,
    sensors: [
      { key: 'current_a', label: 'Current', unit: 'A', min: 18, max: 34, drift: 0.6 },
      { key: 'voltage_v', label: 'Voltage', unit: 'V', min: 220, max: 240, drift: 0.4 },
      { key: 'power_kw', label: 'Power', unit: 'kW', min: 15, max: 30, drift: 0.8 },
      { key: 'energy_kwh', label: 'Energy (cumulative)', unit: 'kWh', min: 23000, max: 26000, drift: 2.5, cumulative: true },
      { key: 'frequency_hz', label: 'Frequency', unit: 'Hz', min: 49.8, max: 50.2, drift: 0.02 },
      { key: 'power_factor', label: 'Power Factor', unit: '', min: 0.85, max: 0.99, drift: 0.01 },
    ],
  },
  'sensor-board-generic': {
    label: 'Generic Sensor Board',
    relayCount: 4,
    sensors: [
      { key: 'temp_c', label: 'Temperature', unit: '°C', min: 18, max: 32, drift: 0.3 },
      { key: 'humidity_pct', label: 'Humidity', unit: '%', min: 30, max: 70, drift: 1.2 },
      { key: 'pressure_hpa', label: 'Pressure', unit: 'hPa', min: 990, max: 1025, drift: 0.5 },
      { key: 'light_lux', label: 'Light', unit: 'lux', min: 0, max: 800, drift: 15 },
      { key: 'co2_ppm', label: 'CO2', unit: 'ppm', min: 400, max: 1200, drift: 10 },
      { key: 'vibration_g', label: 'Vibration', unit: 'g', min: 0, max: 2, drift: 0.05 },
    ],
  },
  'gps-board': {
    label: 'GPS Tracker Board',
    relayCount: 0,
    sensors: [
      { key: 'temp_c', label: 'Temperature', unit: '°C', min: 22, max: 28, drift: 0.2 },
    ],
  },
};

const DEFAULT_PROFILE_KEY = 'sensor-board-generic';

// Board types registered via the catalog without a dedicated simulation
// profile still produce readings — they fall back to the generic
// temp/humidity/etc. profile above.
export function profileFor(boardId) {
  return DEVICE_PROFILES[boardId] || DEVICE_PROFILES[DEFAULT_PROFILE_KEY];
}

export function knownBoardTypes() {
  return Object.keys(DEVICE_PROFILES);
}

const state = new Map(); // deviceId -> { values: {key: number}, relays: bool[], battery, lastPing, online }

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function initDevice(device, profile) {
  const values = {};
  for (const s of profile.sensors) {
    values[s.key] = s.cumulative ? s.min : s.min + Math.random() * (s.max - s.min);
  }
  state.set(device.id, {
    values,
    relays: Array.from({ length: profile.relayCount }, () => Math.random() > 0.3),
    battery: 60 + Math.random() * 40,
    online: true,
    lastPing: new Date(),
  });
}

function step(device, profile) {
  const s = state.get(device.id);

  // Rare, brief offline blip so "Device Status" has something real to show.
  if (Math.random() < 0.01) s.online = !s.online;

  if (s.online) {
    for (const sensor of profile.sensors) {
      const delta = (Math.random() - 0.5) * 2 * sensor.drift;
      if (sensor.cumulative) {
        s.values[sensor.key] = s.values[sensor.key] + Math.abs(delta); // counters only go up
      } else {
        s.values[sensor.key] = clamp(s.values[sensor.key] + delta, sensor.min, sensor.max);
      }
    }
    if (Math.random() < 0.03) {
      const i = Math.floor(Math.random() * s.relays.length);
      s.relays[i] = !s.relays[i];
    }
    s.battery = clamp(s.battery - Math.random() * 0.05, 0, 100);
    s.lastPing = new Date();
  }

  return s;
}

function formatReading(device) {
  const profile = profileFor(device.type);
  if (!state.has(device.id)) initDevice(device, profile);
  const s = step(device, profile);

  const sensors = profile.sensors.map((sensor) => ({
    key: sensor.key,
    label: sensor.label,
    unit: sensor.unit,
    value: Math.round(s.values[sensor.key] * 100) / 100,
  }));

  // GPS boards move along Kochi ↔ Bengaluru (and back) so the dashboard map animates
  let latitude = null;
  let longitude = null;
  if (isGpsBoard(device)) {
    advanceGlobalIndex();
    const gps = gpsPointForDevice(device.id);
    latitude = Number(gps.lat.toFixed(6));
    longitude = Number(gps.lng.toFixed(6));
    sensors.push(
      { key: 'latitude', label: 'Latitude', unit: '°', value: latitude },
      { key: 'longitude', label: 'Longitude', unit: '°', value: longitude }
    );
    // Keep GPS trackers marked online while simulating movement
    s.online = true;
    s.lastPing = new Date();
  }

  return {
    id: device.id,
    name: device.name,
    type: device.type,
    typeLabel: device.typeLabel || profile.label,
    status: s.online ? 'online' : 'offline',
    battery: Math.round(s.battery * 10) / 10,
    lastPing: s.lastPing.toISOString(),
    serverTime: new Date().toISOString(),
    relays: s.relays.map((on, i) => ({ id: i + 1, state: on ? 'ON' : 'OFF' })),
    sensors,
    source: SOURCE === 'aws' ? 'aws' : 'simulated',
    latitude,
    longitude,
  };
}

// Multiple admins/users can have this dashboard open at once, all polling on
// their own timer. Without this, N open tabs means N upstream reads for
// the same instant in time — harmless against the in-process simulator,
// but a real cost once this calls out to AWS. A few seconds of sharing is
// invisible to a human watching a "live" readout but collapses duplicate
// requests that land in the same window down to one.
const CACHE_TTL_MS = 2000;
const readingCache = new Map(); // deviceId -> { data, expires }

function getCachedReading(device) {
  const cached = readingCache.get(device.id);
  const now = Date.now();
  if (cached && now < cached.expires) return cached.data;

  const data = formatReading(device);
  readingCache.set(device.id, { data, expires: now + CACHE_TTL_MS });
  return data;
}

// Same duplicate-request collapsing as getCachedReading above, kept as a
// separate map since AWS reads are keyed by awsDeviceId (one physical
// board can, in principle, back a Device record without a name clash with
// the simulator's id-keyed cache).
const awsReadingCache = new Map(); // awsDeviceId -> { data, expires }

// Build a normalised sensors array from the raw DynamoDB item.
// The current IoT boards report: temperature, humidity, pressure, battery.
// Any field missing from the item is omitted from the array (rather than
// surfaced as null) so the frontend can safely iterate what's actually there.
function awsSensorsFromItem(item) {
  if (!item) return [];

  const sensors = [];

  const temp = item.temperature ?? item.extras?.temperature ?? null;
  if (temp !== null && temp !== undefined && Number.isFinite(Number(temp))) {
    sensors.push({ key: 'temp_c', label: 'Temperature', unit: '°C', value: Number(temp) });
  }

  const hum = item.humidity ?? item.extras?.humidity ?? null;
  if (hum !== null && hum !== undefined && Number.isFinite(Number(hum))) {
    sensors.push({ key: 'humidity_pct', label: 'Humidity', unit: '%', value: Number(hum) });
  }

  const pressure = item.pressure ?? item.extras?.pressure ?? null;
  if (pressure !== null && pressure !== undefined && Number.isFinite(Number(pressure))) {
    sensors.push({ key: 'pressure_hpa', label: 'Pressure', unit: 'hPa', value: Number(pressure) });
  }

  const batt = item.battery ?? item.batteryVoltage ?? item.extras?.battery ?? null;
  if (batt !== null && batt !== undefined && Number.isFinite(Number(batt))) {
    const pct = Number(batt) > 5 ? Number(batt) : Math.round(((Number(batt) - 3.0) / (4.2 - 3.0)) * 100);
    sensors.push({ key: 'battery_pct', label: 'Battery', unit: '%', value: Math.max(0, Math.min(100, pct)) });
  }

  const coords = typeof extractCoords === 'function' ? extractCoords(item) : { lat: null, lng: null };
  if (coords.lat != null) {
    sensors.push({ key: 'latitude', label: 'Latitude', unit: '°', value: coords.lat });
  }
  if (coords.lng != null) {
    sensors.push({ key: 'longitude', label: 'Longitude', unit: '°', value: coords.lng });
  }

  // Extra numeric Dynamo attributes → extra sensor channels on the card
  const skip = new Set([
    'deviceId', 'deviceName', 'timestamp', 'type', 'status', 'locations', 'location',
    'latitude', 'longitude', 'lat', 'lng', 'lon', 'temperature', 'humidity', 'pressure',
    'battery', 'batteryVoltage', 'extras', 'site', 'source', 'lastSeen', 'fw', 'seq',
  ]);
  for (const [k, v] of Object.entries(item)) {
    if (skip.has(k) || v == null || typeof v === 'object') continue;
    if (!Number.isFinite(Number(v))) continue;
    sensors.push({
      key: k,
      label: String(k).replace(/_/g, ' '),
      unit: '',
      value: Number(v),
    });
  }

  return sensors;
}

async function getCachedAwsReading(deviceLite) {
  const key = deviceLite.awsDeviceId;
  // Caller should only invoke this when awsDeviceId is set.
  if (!key) {
    return getCachedReading(deviceLite);
  }

  const cached = awsReadingCache.get(key);
  const now = Date.now();
  if (cached && now < cached.expires) return cached.data;

  try {
    // Telemetry (temp/etc.) and connection (ONLINE/OFFLINE) are separate
    // row types in SensorData — resolve them independently so a board that
    // went offline is not stuck showing "Online" from an old telemetry row.
    const [item, connection] = await Promise.all([
      getLatestReading(key),
      getLatestConnectionStatus(key),
    ]);
    const reading = normalise(item);

    const sensors = awsSensorsFromItem(item);
    const battSensor = sensors.find((s) => s.key === 'battery_pct');
    const latSensor = sensors.find((s) => s.key === 'latitude');
    const lngSensor = sensors.find((s) => s.key === 'longitude');

    const status = resolveDeviceStatus({
      connection,
      telemetryItem: item,
    });

    const data = {
      id: deviceLite.id,
      name: deviceLite.name,
      type: deviceLite.type,
      typeLabel: deviceLite.typeLabel || 'AWS Board',
      status,
      battery: battSensor ? battSensor.value : null,
      lastPing: reading?.recordedAt || null,
      serverTime: new Date().toISOString(),
      relays: [],
      sensors,
      source: 'aws',
      latitude: latSensor ? latSensor.value : (reading?.latitude ?? null),
      longitude: lngSensor ? lngSensor.value : (reading?.longitude ?? null),
    };

    awsReadingCache.set(key, { data, expires: now + CACHE_TTL_MS });
    return data;
  } catch (err) {
    // AWS read failed for this board — fall back to simulator so one bad
    // device cannot take down the whole /devices/live fleet response.
    console.error(`[sensorFeed] AWS read failed for ${key}:`, err.message);
    return getCachedReading(deviceLite);
  }
}

// deviceLite: { id, name, type, typeLabel?, awsDeviceId? } — id must be a
// stable string (a registered Device's Mongo _id.toString()).
export async function simulateReading(deviceLite) {
  // Only hit DynamoDB when this inventory record is linked to a physical
  // board. Older/demo devices with awsDeviceId=null keep using the
  // simulator even if SENSOR_DATA_SOURCE=aws — otherwise /devices/live
  // returns 409 and the whole Sensors page fails to load.
  if (SOURCE === 'aws' && deviceLite.awsDeviceId) {
    return getCachedAwsReading(deviceLite);
  }
  return getCachedReading(deviceLite);
}

// Called when a device is deleted so the simulator doesn't keep state /
// cache entries around for a board that no longer exists.
export function forgetDevice(id) {
  state.delete(id);
  readingCache.delete(id);
}