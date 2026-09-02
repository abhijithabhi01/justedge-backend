/**
 * In-process demo GPS + temperature writers → MongoDB `demodata` only.
 * Started automatically with the API when DEMO_SENSORS_ENABLED is not "false".
 * Does not write to AWS / DynamoDB.
 */
import { DemoData } from '../models/DemoData.js';

const GPS_ROUTE = [
  { lat: 12.2958, lng: 76.6394 },
  { lat: 12.33, lng: 76.68 },
  { lat: 12.423, lng: 76.703 },
  { lat: 12.522, lng: 76.897 },
  { lat: 12.585, lng: 77.045 },
  { lat: 12.652, lng: 77.207 },
  { lat: 12.72, lng: 77.28 },
  { lat: 12.796, lng: 77.386 },
  { lat: 12.907, lng: 77.482 },
  { lat: 12.917, lng: 77.56 },
  { lat: 12.995, lng: 77.67 },
  { lat: 13.0169, lng: 77.6954 },
];

const STEPS = 20;

function buildPath() {
  const points = [];
  for (let i = 0; i < GPS_ROUTE.length - 1; i++) {
    const a = GPS_ROUTE[i];
    const b = GPS_ROUTE[i + 1];
    for (let s = 0; s < STEPS; s++) {
      const t = s / STEPS;
      points.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
      });
    }
  }
  points.push({ ...GPS_ROUTE[GPS_ROUTE.length - 1] });
  return points;
}

const PATH = buildPath();
let pathIndex = 0;
let timer = null;

function nextGps() {
  const p = PATH[pathIndex % PATH.length];
  pathIndex += 1;
  return {
    lat: p.lat + (Math.random() - 0.5) * 0.0015,
    lng: p.lng + (Math.random() - 0.5) * 0.0015,
  };
}

function nextTemp() {
  const base = 27.2;
  const drift = Math.sin(Date.now() / 60000) * 1.2;
  const noise = (Math.random() - 0.5) * 0.4;
  return Math.round((base + drift + noise) * 10) / 10;
}

async function tick() {
  const gps = nextGps();
  const tempGps = nextTemp();
  const tempWh = Math.round((26.5 + (Math.random() - 0.5) * 1.5) * 10) / 10;

  await DemoData.create([
    {
      kind: 'reading',
      deviceKey: 'DEMO_GPS_001',
      deviceName: 'GPS Tracker ESP32_001',
      boardType: 'GPS Tracker Board',
      lat: gps.lat,
      lng: gps.lng,
      temp: tempGps,
      humidity: Math.round(45 + Math.random() * 15),
      battery: Math.max(40, 85 - (pathIndex % 40)),
      status: 'online',
      meta: { source: 'demo-simulator', type: 'gps' },
    },
    {
      kind: 'reading',
      deviceKey: 'DEMO_TEMP_001',
      deviceName: 'Warehouse Sensor A',
      boardType: 'Temperature Board',
      lat: null,
      lng: null,
      temp: tempWh,
      humidity: Math.round(50 + Math.random() * 10),
      battery: 88 + Math.round(Math.random() * 5),
      status: 'online',
      meta: { source: 'demo-simulator', type: 'temperature' },
    },
  ]);
}

/**
 * Start background demo writers. Safe to call once after Mongo is connected.
 * Env:
 *   DEMO_SENSORS_ENABLED=false  → skip
 *   DEMO_SENSOR_INTERVAL_MS     → default 2000
 */
export function startDemoSensorSimulator() {
  const enabled = String(process.env.DEMO_SENSORS_ENABLED ?? 'true').toLowerCase();
  if (enabled === 'false' || enabled === '0' || enabled === 'off') {
    console.log('[demo-sensors] disabled (DEMO_SENSORS_ENABLED=false)');
    return;
  }

  if (timer) return;

  const intervalMs = Number(process.env.DEMO_SENSOR_INTERVAL_MS || 2000);

  const run = () => {
    tick().catch((err) =>
      console.error('[demo-sensors] tick failed:', err.message)
    );
  };

  run();
  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  console.log(
    `[demo-sensors] writing GPS + temperature to Mongo demodata every ${intervalMs}ms (no AWS)`
  );
}

export function stopDemoSensorSimulator() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}   