import { Alert } from '../models/Alert.js';
import { logActivity } from '../middleware/activityLogger.js';

function assertAlertAccess(req, alert) {
  if (req.admin) return true;
  if (req.user && String(alert.ownerId) === String(req.user._id)) return true;
  return false;
}

export async function listAlerts(req, res) {
  const { resolved, ownerId, page = 1, pageSize = 50 } = req.query;
  const filter = {};
  if (resolved !== undefined) filter.resolved = resolved === 'true';

  if (req.user) {
    // Users only ever see alerts on sensors owned by them, regardless of
    // any ownerId query param passed in.
    filter.ownerId = req.user._id;
  } else if (ownerId) {
    filter.ownerId = ownerId;
  }

  const skip = (Number(page) - 1) * Number(pageSize);
  const [alerts, total] = await Promise.all([
    Alert.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(pageSize)),
    Alert.countDocuments(filter),
  ]);

  res.json({ alerts: alerts.map((a) => a.toSafeJSON()), total, page: Number(page), pageSize: Number(pageSize) });
}

export async function resolveAlert(req, res) {
  const alert = await Alert.findById(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  if (!assertAlertAccess(req, alert)) return res.status(403).json({ error: 'Forbidden' });

  alert.resolved = true;
  await alert.save();

  await logActivity(req, { action: 'Resolved alert', target: alert.title, targetType: 'alert', category: 'sensor', severity: 'info' });
  res.json({ alert: alert.toSafeJSON() });
}

export async function snoozeAlert(req, res) {
  const alert = await Alert.findById(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  if (!assertAlertAccess(req, alert)) return res.status(403).json({ error: 'Forbidden' });

  const { until } = req.body;
  alert.snoozedUntil = until ? new Date(until) : null;
  await alert.save();

  await logActivity(req, { action: 'Snoozed alert', target: alert.title, targetType: 'alert', category: 'sensor', severity: 'info' });
  res.json({ alert: alert.toSafeJSON() });
}

export async function dismissAlert(req, res) {
  const alert = await Alert.findById(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  if (!assertAlertAccess(req, alert)) return res.status(403).json({ error: 'Forbidden' });

  await alert.deleteOne();
  await logActivity(req, { action: 'Dismissed alert', target: alert.title, targetType: 'alert', category: 'sensor', severity: 'info' });
  res.json({ ok: true });
}
