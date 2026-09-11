/**
 * In-process demo GPS + temperature writers → MongoDB `demodata` only.
 * GPS follows Kochi ↔ Bengaluru and back.
 * Started automatically with the API when DEMO_SENSORS_ENABLED is not "false".
 * Does not write to AWS / DynamoDB.
 */
import mongoose from 'mongoose';
import { DemoData } from '../models/DemoData.js';
import { nextGpsPoint } from './gpsRoute.js';

let timer = null;

function nextTemp() {
  const base = 27.2;
  const drift = Math.sin(Date.now() / 60000) * 1.2;
  const noise = (Math.random() - 0.5) * 0.4;
  return Math.round((base + drift + noise) * 10) / 10;
}

async function tick() {
  const gps = nextGpsPoint({ jitter: true });
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
      battery: Math.max(40, 85 - (gps.index % 40)),
      status: 'online',
      meta: {
        source: 'demo-simulator',
        type: 'gps',
        leg: gps.leg,
        direction: gps.direction,
        route: 'Kochi↔Bengaluru',
      },
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
    if (mongoose.connection.readyState !== 1) return;
    tick().catch((err) =>
      console.error('[demo-sensors] tick failed:', err.message)
    );
  };

  run();
  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  console.log(
    `[demo-sensors] Kochi↔Bengaluru GPS + temperature → demodata every ${intervalMs}ms`
  );
}

export function stopDemoSensorSimulator() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
