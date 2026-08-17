// Live sensor data source. Right now this simulates readings in-process so
// the frontend/dashboards can be built against a stable shape before AWS is
// wired up. Swap point: when IoT/sensor data actually lives in AWS, replace
// the body of simulateReading() with AWS SDK calls (IoT Core / Timestream /
// whatever the ingest pipeline lands on) and keep the same return shape —
// nothing in controllers/routes needs to change.
//
// Toggle with SENSOR_DATA_SOURCE=aws once that's ready; today anything but
// 'aws' falls back to the simulator.
//
// Registered boards now live in Mongo (models/Device.js) instead of the old
// hardcoded FLEET array — deviceController.js queries Device and passes a
// lightweight { id, name, type } object in here per device. `type` is the
// device's boardId; profileFor() maps it to a simulation profile, falling
// back to a generic one for board types that don't have a dedicated profile
// (e.g. new types added via the board catalog).
const SOURCE = process.env.SENSOR_DATA_SOURCE || 'mock';

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
    sensors: profile.sensors.map((sensor) => ({
      key: sensor.key,
      label: sensor.label,
      unit: sensor.unit,
      value: Math.round(s.values[sensor.key] * 100) / 100,
    })),
    source: SOURCE === 'aws' ? 'aws' : 'simulated',
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

// deviceLite: { id, name, type, typeLabel? } — id must be a stable string
// (a registered Device's Mongo _id.toString()).
export function simulateReading(deviceLite) {
  if (SOURCE === 'aws') {
    // TODO: replace with an AWS SDK call (IoT Core / Timestream) returning
    // the same shape as formatReading() above. Keep routing it through
    // getCachedReading() so the cache above still applies to real calls.
    throw Object.assign(new Error('AWS sensor source not wired up yet'), { status: 501 });
  }
  return getCachedReading(deviceLite);
}

// Called when a device is deleted so the simulator doesn't keep state /
// cache entries around for a board that no longer exists.
export function forgetDevice(id) {
  state.delete(id);
  readingCache.delete(id);
}
