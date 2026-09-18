import { Automation } from '../models/Automation.js';
import { Device } from '../models/Device.js';
import { logActivity } from '../middleware/activityLogger.js';

function buildRuleText({ metric, operator, threshold, rule }) {
  if (metric === 'offline' || operator === 'offline') {
    return 'IF device offline THEN notify me';
  }
  if (metric === 'journey_started') return 'IF journey started (left origin) THEN alert';
  if (metric === 'journey_arrived') return 'IF reached destination THEN alert';
  if (metric === 'journey_returned') return 'IF returned to origin THEN alert';
  if (metric && operator && threshold != null && threshold !== '') {
    const unit =
      metric === 'battery' || metric === 'humidity' ? '%' : metric === 'temperature' ? '°C' : '';
    return `IF ${metric} ${operator} ${threshold}${unit} THEN notify me`;
  }
  if (rule && String(rule).trim()) return String(rule).trim();
  return '';
}

async function assertDeviceAccess(req, deviceId) {
  if (!deviceId) return { error: 'Select a sensor for this automation', status: 400 };
  let device = null;
  if (deviceId.match(/^[a-f0-9]{24}$/i)) {
    device = await Device.findById(deviceId).catch(() => null);
  }
  if (!device) {
    device = await Device.findOne({
      $or: [{ awsDeviceId: deviceId }, { name: deviceId }],
    });
  }
  if (!device) return { error: 'Sensor not found', status: 404 };

  if (req.user) {
    if (String(device.assignedUserId) !== String(req.user._id)) {
      return { error: 'You can only create rules for sensors assigned to you', status: 403 };
    }
  } else if (req.admin && req.admin.role !== 'Superadmin') {
    if (device.createdBy && String(device.createdBy) !== String(req.admin._id)) {
      return { error: 'You can only create rules for sensors you manage', status: 403 };
    }
  }
  return { device };
}

export async function listAutomations(req, res) {
  const { ownerId, page = 1, pageSize = 50 } = req.query;
  const filter = {};

  if (req.user) {
    filter.ownerId = req.user._id;
  } else if (req.admin) {
    // Admin sees all automations for sensors they manage (or all if Superadmin)
    if (ownerId) filter.ownerId = ownerId;
    // no owner filter → list everything in their fleet scope later if needed
  } else if (ownerId) {
    filter.ownerId = ownerId;
  }

  const skip = (Number(page) - 1) * Number(pageSize);
  const [automations, total] = await Promise.all([
    Automation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(pageSize)),
    Automation.countDocuments(filter),
  ]);

  res.json({
    automations: automations.map((a) => a.toSafeJSON()),
    total,
    page: Number(page),
    pageSize: Number(pageSize),
  });
}

export async function createAutomation(req, res) {
  const { name, rule, deviceId, metric, operator, threshold, action, icon, ownerId } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const access = await assertDeviceAccess(req, deviceId);
  if (access.error) return res.status(access.status).json({ error: access.error });

  const ruleText = buildRuleText({ metric, operator, threshold, rule });
  if (!ruleText) {
    return res.status(400).json({
      error:
        'Provide a condition (metric, operator, threshold). Example: battery < 20',
    });
  }

  // Owner: user themselves, or assigned user of the device when admin creates
  let finalOwnerId = req.user ? req.user._id : ownerId || null;
  if (req.admin && !finalOwnerId && access.device.assignedUserId) {
    finalOwnerId = access.device.assignedUserId;
  }

  const automation = await Automation.create({
    name: String(name).trim(),
    rule: ruleText,
    deviceId: String(access.device._id),
    metric: metric || '',
    operator: operator || (metric === 'offline' ? 'offline' : ''),
    threshold:
      threshold === '' || threshold === undefined || threshold === null
        ? null
        : Number(threshold),
    action: action || 'alert',
    icon: icon || 'i-zap',
    ownerId: finalOwnerId,
    on: true,
  });

  await logActivity(req, {
    action: 'Created automation',
    target: automation.name,
    targetType: 'automation',
    category: 'sensor',
    severity: 'info',
  });
  res.status(201).json({ automation: automation.toSafeJSON() });
}

export async function updateAutomation(req, res) {
  const automation = await Automation.findById(req.params.id);
  if (!automation) return res.status(404).json({ error: 'Automation not found' });

  if (req.user && String(automation.ownerId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { name, rule, deviceId, metric, operator, threshold, action, icon, on } = req.body;

  if (deviceId !== undefined) {
    const access = await assertDeviceAccess(req, deviceId);
    if (access.error) return res.status(access.status).json({ error: access.error });
    automation.deviceId = String(access.device._id);
    if (req.admin && access.device.assignedUserId) {
      automation.ownerId = access.device.assignedUserId;
    }
  }

  if (name !== undefined && String(name).trim()) automation.name = String(name).trim();
  if (metric !== undefined) automation.metric = metric || '';
  if (operator !== undefined) automation.operator = operator || '';
  if (threshold !== undefined) {
    automation.threshold =
      threshold === '' || threshold === null ? null : Number(threshold);
  }
  if (action !== undefined) automation.action = action || 'alert';
  if (icon !== undefined) automation.icon = icon || 'i-zap';
  if (on !== undefined) automation.on = !!on;

  const ruleText = buildRuleText({
    metric: automation.metric,
    operator: automation.operator,
    threshold: automation.threshold,
    rule,
  });
  if (ruleText) automation.rule = ruleText;

  await automation.save();
  await logActivity(req, {
    action: 'Updated automation',
    target: automation.name,
    targetType: 'automation',
    category: 'sensor',
    severity: 'info',
  });
  res.json({ automation: automation.toSafeJSON() });
}

export async function toggleAutomation(req, res) {
  const automation = await Automation.findById(req.params.id);
  if (!automation) return res.status(404).json({ error: 'Automation not found' });

  if (req.user && String(automation.ownerId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  automation.on = !automation.on;
  await automation.save();

  await logActivity(req, {
    action: automation.on ? 'Enabled automation' : 'Disabled automation',
    target: automation.name,
    targetType: 'automation',
    category: 'sensor',
    severity: 'info',
  });
  res.json({ automation: automation.toSafeJSON() });
}

export async function removeAutomation(req, res) {
  const automation = await Automation.findById(req.params.id);
  if (!automation) return res.status(404).json({ error: 'Automation not found' });

  if (req.user && String(automation.ownerId) !== String(req.user._id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await automation.deleteOne();
  await logActivity(req, {
    action: 'Removed automation',
    target: automation.name,
    targetType: 'automation',
    category: 'sensor',
    severity: 'info',
  });
  res.json({ ok: true });
}
