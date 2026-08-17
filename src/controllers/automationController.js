import { Automation } from '../models/Automation.js';
import { logActivity } from '../middleware/activityLogger.js';

export async function listAutomations(req, res) {
  const { ownerId, page = 1, pageSize = 50 } = req.query;
  const filter = {};

  if (req.user) {
    filter.ownerId = req.user._id;
  } else if (ownerId) {
    filter.ownerId = ownerId;
  }

  const skip = (Number(page) - 1) * Number(pageSize);
  const [automations, total] = await Promise.all([
    Automation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(pageSize)),
    Automation.countDocuments(filter),
  ]);

  res.json({ automations: automations.map((a) => a.toSafeJSON()), total, page: Number(page), pageSize: Number(pageSize) });
}

export async function createAutomation(req, res) {
  const { name, rule, deviceId } = req.body;
  if (!name || !rule) return res.status(400).json({ error: 'name and rule are required' });

  const automation = await Automation.create({
    name: name.trim(),
    rule: rule.trim(),
    deviceId: deviceId || '',
    // A User's own automations are owned by them; an admin creating one on
    // a User's behalf can pass ownerId explicitly.
    ownerId: req.user ? req.user._id : (req.body.ownerId || null),
  });

  await logActivity(req, { action: 'Created automation', target: automation.name, targetType: 'automation', category: 'sensor', severity: 'info' });
  res.status(201).json({ automation: automation.toSafeJSON() });
}

export async function toggleAutomation(req, res) {
  const automation = await Automation.findById(req.params.id);
  if (!automation) return res.status(404).json({ error: 'Automation not found' });

  automation.on = !automation.on;
  await automation.save();

  await logActivity(req, {
    action: automation.on ? 'Enabled automation' : 'Disabled automation',
    target: automation.name, targetType: 'automation', category: 'sensor', severity: 'info',
  });
  res.json({ automation: automation.toSafeJSON() });
}

export async function removeAutomation(req, res) {
  const automation = await Automation.findById(req.params.id);
  if (!automation) return res.status(404).json({ error: 'Automation not found' });

  await automation.deleteOne();
  await logActivity(req, { action: 'Removed automation', target: automation.name, targetType: 'automation', category: 'sensor', severity: 'info' });
  res.json({ ok: true });
}
