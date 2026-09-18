/**
 * Automation engine — evaluates enabled rules against live device readings
 * and creates Alert documents when conditions match.
 *
 * Supported rule shapes (structured fields preferred; free-text also parsed):
 *   metric: battery | temperature | temp | humidity | offline
 *   operator: < | <= | > | >= | == | offline
 *   threshold: number
 *
 * Free-text examples:
 *   "IF battery < 20% THEN notify me"
 *   "IF temperature > 30 THEN alert"
 *   "IF offline THEN notify"
 *
 * Env:
 *   AUTOMATION_ENGINE_ENABLED=false  → skip
 *   AUTOMATION_ENGINE_INTERVAL_MS    → default 20000
 */

import mongoose from 'mongoose';
import { Automation } from '../models/Automation.js';
import { Alert } from '../models/Alert.js';
import { Device } from '../models/Device.js';
import { UserAccount } from '../models/UserAccount.js';
import { simulateReading } from './sensorFeed.js';
import { sendMail } from './emailService.js';

let timer = null;

const METRIC_ALIASES = {
  battery: 'battery',
  batt: 'battery',
  battery_pct: 'battery',
  temperature: 'temperature',
  temp: 'temperature',
  temp_c: 'temperature',
  humidity: 'humidity',
  humidity_pct: 'humidity',
  offline: 'offline',
  status: 'offline',
  journey_started: 'journey_started',
  journey_start: 'journey_started',
  started: 'journey_started',
  journey_arrived: 'journey_arrived',
  arrived: 'journey_arrived',
  destination: 'journey_arrived',
  journey_returned: 'journey_returned',
  returned: 'journey_returned',
};

/** Edge-detect journey phases so we only alert once per event */
const journeyPrev = new Map(); // `${autoId}:${deviceId}` -> last phase

function parseFreeTextRule(ruleText) {
  const text = String(ruleText || '');
  // offline
  if (/\boffline\b/i.test(text) && !/[<>]=?/.test(text)) {
    return { metric: 'offline', operator: 'offline', threshold: null };
  }
  // IF battery < 20
  const m = text.match(
    /\b(battery|batt|temperature|temp|humidity)\b[^\d<>]*([<>]=?|==|=)\s*(-?\d+(?:\.\d+)?)/i
  );
  if (!m) return null;
  const metric = METRIC_ALIASES[m[1].toLowerCase()] || m[1].toLowerCase();
  let operator = m[2];
  if (operator === '=') operator = '==';
  const threshold = Number(m[3]);
  return { metric, operator, threshold };
}

function resolveCondition(auto) {
  if (auto.metric && auto.operator) {
    return {
      metric: METRIC_ALIASES[String(auto.metric).toLowerCase()] || auto.metric,
      operator: auto.operator,
      threshold: auto.threshold != null ? Number(auto.threshold) : null,
    };
  }
  return parseFreeTextRule(auto.rule);
}

function resolveJourneyPhase(reading) {
  if (!reading) return '';
  if (reading.journeyPhase) return String(reading.journeyPhase);
  const leg = String(reading.leg || reading.site || '').toLowerCase();
  const dir = String(reading.direction || '').toLowerCase();
  const origin = String(reading.origin || '').toLowerCase();
  const dest = String(reading.destination || '').toLowerCase();
  if (dir === 'outbound' && origin && leg === origin) return 'started';
  if (dir === 'outbound' && dest && leg === dest) return 'arrived';
  if (dir === 'return' && origin && leg === origin) return 'returned';
  if (dir === 'return') return 'returning';
  if (dir === 'outbound') return 'en_route';
  return '';
}

function readingValue(reading, metric) {
  if (!reading) return null;
  if (metric === 'battery') {
    return reading.battery != null ? Number(reading.battery) : null;
  }
  if (metric === 'offline') {
    return reading.status === 'online' ? 0 : 1;
  }
  if (metric === 'temperature') {
    const fromSensors = reading.sensors?.find(
      (s) => /temp/i.test(s.key) || /temp/i.test(s.label)
    );
    if (fromSensors) return Number(fromSensors.value);
    if (reading.temperature != null) return Number(reading.temperature);
    return null;
  }
  if (metric === 'humidity') {
    const fromSensors = reading.sensors?.find(
      (s) => /humid/i.test(s.key) || /humid/i.test(s.label)
    );
    if (fromSensors) return Number(fromSensors.value);
    if (reading.humidity != null) return Number(reading.humidity);
    return null;
  }
  if (
    metric === 'journey_started' ||
    metric === 'journey_arrived' ||
    metric === 'journey_returned'
  ) {
    const phase = resolveJourneyPhase(reading);
    if (metric === 'journey_started') return phase === 'started' ? 1 : 0;
    if (metric === 'journey_arrived') return phase === 'arrived' ? 1 : 0;
    if (metric === 'journey_returned') return phase === 'returned' ? 1 : 0;
  }
  return null;
}

function conditionMet(operator, value, threshold) {
  if (operator === 'offline' || operator === 'event') return value === 1;
  if (value == null || !Number.isFinite(value)) return false;
  if (threshold == null || !Number.isFinite(threshold)) return false;
  switch (operator) {
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    case '==':
      return value === threshold;
    default:
      return false;
  }
}

function toneFor(metric, operator, threshold, value) {
  if (metric === 'offline') return 'critical';
  if (metric === 'battery' && (operator === '<' || operator === '<=') && threshold <= 15) {
    return 'critical';
  }
  if (metric === 'battery') return 'warn';
  if (metric === 'temperature' && value != null && (value >= 35 || value <= 0)) return 'critical';
  if (metric === 'temperature') return 'warn';
  return 'info';
}

function describe(metric, operator, threshold, value, deviceName, reading) {
  if (metric === 'offline') {
    return {
      title: `${deviceName} is offline`,
      desc: `Automation detected no live report from ${deviceName}.`,
    };
  }
  if (metric === 'journey_started') {
    const origin = reading?.origin || reading?.leg || 'origin';
    const dest = reading?.destination || 'destination';
    return {
      title: `${deviceName} started journey`,
      desc: `Trip began from ${origin} toward ${dest}.`,
    };
  }
  if (metric === 'journey_arrived') {
    const dest = reading?.destination || reading?.leg || 'destination';
    return {
      title: `${deviceName} reached destination`,
      desc: `Arrived at ${dest}.`,
    };
  }
  if (metric === 'journey_returned') {
    const origin = reading?.origin || reading?.leg || 'home';
    return {
      title: `${deviceName} returned`,
      desc: `Back at ${origin} after the trip.`,
    };
  }
  const unit =
    metric === 'battery' ? '%' : metric === 'temperature' ? '°C' : metric === 'humidity' ? '%' : '';
  const label = metric.charAt(0).toUpperCase() + metric.slice(1);
  return {
    title: `${deviceName}: ${label} ${operator} ${threshold}${unit}`,
    desc: `Current ${label.toLowerCase()} is ${value}${unit} (rule: ${operator} ${threshold}${unit}).`,
  };
}

async function recentDuplicate(ownerId, deviceId, title) {
  const since = new Date(Date.now() - 30 * 60 * 1000); // 30 min window
  const filter = {
    title,
    resolved: false,
    createdAt: { $gte: since },
  };
  if (ownerId) filter.ownerId = ownerId;
  if (deviceId) filter.deviceId = String(deviceId);
  return Alert.findOne(filter).lean();
}

async function notifyOwner(ownerId, alert) {
  if (!ownerId) return;
  try {
    const user = await UserAccount.findById(ownerId).select('email name').lean();
    if (!user?.email) return;
    await sendMail({
      to: user.email,
      subject: `[JustEdge] ${alert.title}`,
      text: `${alert.title}\n\n${alert.desc}\n\nOpen the app to resolve or snooze this alert.`,
      html: `<p><strong>${alert.title}</strong></p><p>${alert.desc}</p><p>Open JustEdge to resolve or snooze this alert.</p>`,
    });
  } catch (err) {
    console.error('[automation-engine] notify failed:', err.message);
  }
}

async function devicesForAutomation(auto) {
  const id = String(auto.deviceId || '').trim();
  if (id) {
    if (mongoose.Types.ObjectId.isValid(id)) {
      const d = await Device.findById(id).catch(() => null);
      if (d) return [d];
    }
    const byAlt = await Device.find({
      $or: [{ awsDeviceId: id }, { name: id }, { imei: id }],
    }).limit(5);
    if (byAlt.length) return byAlt;
  }
  // Fallback: all sensors assigned to the automation owner
  if (auto.ownerId) {
    return Device.find({ assignedUserId: auto.ownerId }).limit(50);
  }
  // Admin rules with no device and no owner: all devices created by that admin if stored
  return [];
}

function toLite(device) {
  return {
    id: device._id.toString(),
    name: device.name,
    type: device.boardId,
    awsDeviceId: device.awsDeviceId,
  };
}

async function evaluateOne(auto) {
  const condition = resolveCondition(auto);
  if (!condition) return 0;

  const devices = await devicesForAutomation(auto);
  if (!devices.length) return 0;

  let fired = 0;

  for (const device of devices) {
    let reading;
    try {
      reading = await simulateReading(toLite(device));
    } catch (err) {
      console.error(`[automation-engine] reading ${device.name}:`, err.message);
      continue;
    }

    // Attach journey metadata from AWS/raw item if present on reading
    const value = readingValue(reading, condition.metric);

    // Journey metrics: only fire on rising edge (enter phase)
    const isJourney = String(condition.metric || '').startsWith('journey_');
    if (isJourney) {
      const phase = resolveJourneyPhase(reading);
      const stateKey = `${auto._id}:${device._id}`;
      const prev = journeyPrev.get(stateKey);
      journeyPrev.set(stateKey, phase);
      const targetPhase =
        condition.metric === 'journey_started'
          ? 'started'
          : condition.metric === 'journey_arrived'
            ? 'arrived'
            : condition.metric === 'journey_returned'
              ? 'returned'
              : '';
      if (phase !== targetPhase || prev === targetPhase) continue;
    } else if (!conditionMet(condition.operator, value, condition.threshold)) {
      continue;
    }

    const { title, desc } = describe(
      condition.metric,
      condition.operator,
      condition.threshold,
      value,
      device.name,
      reading
    );

    const dup = await recentDuplicate(auto.ownerId, device._id.toString(), title);
    if (dup) continue;

    const tone = toneFor(condition.metric, condition.operator, condition.threshold, value);
    const icon =
      condition.metric === 'battery'
        ? 'i-battery'
        : condition.metric === 'offline'
          ? 'i-wifi'
          : condition.metric?.startsWith('journey_')
            ? 'i-activity'
            : 'i-zap';
    const alert = await Alert.create({
      ownerId: auto.ownerId || null,
      deviceId: device._id.toString(),
      icon,
      tone: isJourney ? 'info' : tone,
      title,
      desc,
      resolved: false,
    });

    fired += 1;
    await notifyOwner(auto.ownerId, alert);
  }

  if (fired > 0) {
    auto.runs = (auto.runs || 0) + fired;
    auto.lastRun = new Date();
    await auto.save();
  }

  return fired;
}

async function tick() {
  if (mongoose.connection.readyState !== 1) return;

  const autos = await Automation.find({ on: true }).limit(200);
  let total = 0;
  for (const auto of autos) {
    try {
      total += await evaluateOne(auto);
    } catch (err) {
      console.error(`[automation-engine] "${auto.name}":`, err.message);
    }
  }
  if (total > 0) {
    console.log(`[automation-engine] created ${total} alert(s)`);
  }
}

export function startAutomationEngine() {
  const enabled = String(process.env.AUTOMATION_ENGINE_ENABLED ?? 'true').toLowerCase();
  if (enabled === 'false' || enabled === '0' || enabled === 'off') {
    console.log('[automation-engine] disabled (AUTOMATION_ENGINE_ENABLED=false)');
    return;
  }
  if (timer) return;

  const intervalMs = Number(process.env.AUTOMATION_ENGINE_INTERVAL_MS || 20000);
  const run = () => {
    tick().catch((err) => console.error('[automation-engine] tick failed:', err.message));
  };
  // slight delay so fleet sim / DB settle
  setTimeout(run, 5000);
  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  console.log(`[automation-engine] evaluating rules every ${intervalMs}ms`);
}

export function stopAutomationEngine() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
