import { BillingPlan } from '../models/BillingPlan.js';
import { Device } from '../models/Device.js';
import { UserAccount } from '../models/UserAccount.js';
import { logActivity } from '../middleware/activityLogger.js';

export async function listPlans(req, res) {
  const plans = await BillingPlan.find().sort({ name: 1 });
  res.json({ plans: plans.map((p) => p.toSafeJSON()) });
}

export async function createPlan(req, res) {
  const { id, name, desc, price } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name are required' });

  const existing = await BillingPlan.findOne({ id });
  if (existing) return res.status(409).json({ error: `Plan id already exists: ${id}` });

  const plan = await BillingPlan.create({ id, name, desc: desc || '', price: price || '' });
  await logActivity(req, { action: 'Added billing plan', target: plan.name, targetType: 'other', category: 'admin', severity: 'info' });
  res.status(201).json({ plan: plan.toSafeJSON() });
}

export async function updatePlan(req, res) {
  const plan = await BillingPlan.findOne({ id: req.params.id });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const { name, desc, price } = req.body;
  if (name !== undefined) plan.name = name;
  if (desc !== undefined) plan.desc = desc;
  if (price !== undefined) plan.price = price;

  await plan.save();
  await logActivity(req, { action: 'Updated billing plan', target: plan.name, targetType: 'other', category: 'admin', severity: 'info' });
  res.json({ plan: plan.toSafeJSON() });
}

// Subscriptions are folded onto the Device record (subscriptionPlan +
// subscriptionExpiry, see models/Device.js) rather than a separate
// collection — a device only ever has one active subscription at a time,
// so there's no independent lifecycle to justify a second table.
export async function listSubscriptions(req, res) {
  const { status, page = 1, pageSize = 50 } = req.query;
  const filter = {};
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 86400000);

  if (status === 'active') filter.subscriptionExpiry = { $gt: soon };
  else if (status === 'expiring') filter.subscriptionExpiry = { $gte: now, $lte: soon };
  else if (status === 'expired') filter.subscriptionExpiry = { $lt: now };

  if (req.admin?.role !== 'Superadmin') {
    const users = await UserAccount.find({ createdBy: req.admin._id }).select('_id');
    filter.assignedUserId = { $in: users.map((user) => user._id) };
  }

  const skip = (Number(page) - 1) * Number(pageSize);
  const [devices, total] = await Promise.all([
    Device.find(filter).sort({ subscriptionExpiry: 1 }).skip(skip).limit(Number(pageSize)),
    Device.countDocuments(filter),
  ]);

  res.json({
    subscriptions: devices.map((d) => ({
      deviceId: d._id, deviceName: d.name, plan: d.subscriptionPlan, expiry: d.subscriptionExpiry,
    })),
    total, page: Number(page), pageSize: Number(pageSize),
  });
}

export async function updateSubscription(req, res) {
  const device = await Device.findById(req.params.deviceId);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const { plan, expiry } = req.body;
  if (plan !== undefined) device.subscriptionPlan = plan;
  if (expiry !== undefined) device.subscriptionExpiry = expiry ? new Date(expiry) : null;

  await device.save();
  await logActivity(req, { action: 'Updated device subscription', target: device.name, targetType: 'sensor', category: 'sensor', severity: 'info' });
  res.json({ device: device.toSafeJSON() });
}
