/**
 * Shared Kochi ↔ Bengaluru demo GPS path.
 * Used by the in-process simulator, DynamoDB GPS script, and live fleet readings.
 */

/** Outbound: Kochi → Bengaluru (approx. NH 544 / NH 48 corridor) */
export const KOCHI_TO_BANGALORE = [
  { name: 'Kochi', lat: 9.9312, lng: 76.2673 },
  { name: 'Aluva', lat: 10.1004, lng: 76.357 },
  { name: 'Angamaly', lat: 10.1906, lng: 76.386 },
  { name: 'Chalakudy', lat: 10.301, lng: 76.337 },
  { name: 'Thrissur', lat: 10.5276, lng: 76.2144 },
  { name: 'Wadakkanchery', lat: 10.654, lng: 76.247 },
  { name: 'Palakkad', lat: 10.7867, lng: 76.6548 },
  { name: 'Coimbatore', lat: 11.0168, lng: 76.9558 },
  { name: 'Avinashi', lat: 11.191, lng: 77.268 },
  { name: 'Erode', lat: 11.341, lng: 77.717 },
  { name: 'Salem', lat: 11.6643, lng: 78.146 },
  { name: 'Dharmapuri', lat: 12.1357, lng: 78.158 },
  { name: 'Krishnagiri', lat: 12.5186, lng: 78.2137 },
  { name: 'Hosur', lat: 12.7409, lng: 77.8253 },
  { name: 'Electronic City', lat: 12.845, lng: 77.66 },
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
];

/**
 * Build a dense path along waypoints, then append the reverse so the
 * tracker loops Kochi → Bengaluru → Kochi forever.
 */
export function buildRoundTripPath(waypoints = KOCHI_TO_BANGALORE, stepsPerLeg = 10) {
  const forward = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    for (let s = 0; s < stepsPerLeg; s++) {
      const t = s / stepsPerLeg;
      forward.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        leg: a.name,
        direction: 'outbound',
      });
    }
  }
  const end = waypoints[waypoints.length - 1];
  forward.push({
    lat: end.lat,
    lng: end.lng,
    leg: end.name,
    direction: 'outbound',
  });

  // Reverse (skip first point of reverse = last of forward to avoid a pause)
  const reverse = [];
  for (let i = waypoints.length - 1; i > 0; i--) {
    const a = waypoints[i];
    const b = waypoints[i - 1];
    for (let s = 0; s < stepsPerLeg; s++) {
      const t = s / stepsPerLeg;
      reverse.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lng: a.lng + (b.lng - a.lng) * t,
        leg: a.name,
        direction: 'return',
      });
    }
  }
  const start = waypoints[0];
  reverse.push({
    lat: start.lat,
    lng: start.lng,
    leg: start.name,
    direction: 'return',
  });

  return [...forward, ...reverse];
}

const SHARED_PATH = buildRoundTripPath();

/** Global path index — advances on every GPS sample across all readers */
let globalIndex = 0;

/**
 * Next point on the shared Kochi↔Bengaluru loop.
 * Optional small jitter for a more realistic GPS feel.
 */
export function nextGpsPoint({ jitter = true } = {}) {
  const p = SHARED_PATH[globalIndex % SHARED_PATH.length];
  globalIndex += 1;
  const jLat = jitter ? (Math.random() - 0.5) * 0.0012 : 0;
  const jLng = jitter ? (Math.random() - 0.5) * 0.0012 : 0;
  return {
    lat: p.lat + jLat,
    lng: p.lng + jLng,
    leg: p.leg,
    direction: p.direction,
    index: (globalIndex - 1) % SHARED_PATH.length,
    total: SHARED_PATH.length,
  };
}

/**
 * Deterministic point for a given device so multiple boards can share the
 * route but sit at different offsets (staggered along the corridor).
 */
export function gpsPointForDevice(deviceId, offset = 0) {
  const base = Math.abs(hashString(String(deviceId))) % SHARED_PATH.length;
  const idx = (base + offset + globalIndex) % SHARED_PATH.length;
  const p = SHARED_PATH[idx];
  return {
    lat: p.lat + (Math.random() - 0.5) * 0.0008,
    lng: p.lng + (Math.random() - 0.5) * 0.0008,
    leg: p.leg,
    direction: p.direction,
  };
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function getPathLength() {
  return SHARED_PATH.length;
}

export function advanceGlobalIndex() {
  globalIndex += 1;
  return globalIndex;
}
