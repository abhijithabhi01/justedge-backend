import { ActivityLog } from '../models/ActivityLog.js';

export async function listActivity(req, res) {
  const { q, category, severity, actorId, from, to, page = 1, pageSize = 50 } = req.query;

  const filter = {};
  if (category) filter.category = category;
  if (severity) filter.severity = severity;
  if (actorId) filter.actorId = actorId;
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = new Date(from);
    if (to) filter.timestamp.$lte = new Date(to);
  }
  if (q) {
    const re = new RegExp(q, 'i');
    filter.$or = [{ actorName: re }, { action: re }, { target: re }];
  }

  const skip = (Number(page) - 1) * Number(pageSize);
  const [logs, total] = await Promise.all([
    ActivityLog.find(filter).sort({ timestamp: -1 }).skip(skip).limit(Number(pageSize)),
    ActivityLog.countDocuments(filter),
  ]);

  res.json({ logs, total, page: Number(page), pageSize: Number(pageSize) });
}

export async function activitySummary(req, res) {
  const since24h = new Date(Date.now() - 86400000);
  const [total, last24h, critical, distinctActors] = await Promise.all([
    ActivityLog.countDocuments(),
    ActivityLog.countDocuments({ timestamp: { $gte: since24h } }),
    ActivityLog.countDocuments({ severity: 'critical' }),
    ActivityLog.distinct('actorId'),
  ]);
  res.json({ total, last24h, critical, distinctActors: distinctActors.filter(Boolean).length });
}
