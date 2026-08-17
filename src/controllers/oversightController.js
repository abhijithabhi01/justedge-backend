import { AdminAccount } from '../models/AdminAccount.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { SecurityFlag } from '../models/SecurityFlag.js';
import { logActivity } from '../middleware/activityLogger.js';

export async function oversightSummary(req, res) {
  const since7d = new Date(Date.now() - 7 * 86400000);
  const since30d = new Date(Date.now() - 30 * 86400000);

  // This is a dashboard summary, not a full listing — cap each list (with
  // a real count alongside) instead of returning every matching admin.
  const LIST_CAP = 20;
  const without2faFilter = { twoFactor: false, status: { $ne: 'suspended' } };
  const inactive30dFilter = { lastLogin: { $lt: since30d, $ne: null } };
  const suspendedFilter = { status: 'suspended' };

  const [
    openFlags, criticalOpen, failedSignins7d,
    without2fa, without2faCount,
    inactive30d, inactive30dCount,
    suspended, suspendedCount,
  ] = await Promise.all([
    SecurityFlag.countDocuments({ resolved: false }),
    SecurityFlag.countDocuments({ resolved: false, severity: 'critical' }),
    ActivityLog.countDocuments({ action: /failed/i, timestamp: { $gte: since7d } }),
    AdminAccount.find(without2faFilter, 'name role').limit(LIST_CAP),
    AdminAccount.countDocuments(without2faFilter),
    AdminAccount.find(inactive30dFilter, 'name role lastLogin').limit(LIST_CAP),
    AdminAccount.countDocuments(inactive30dFilter),
    AdminAccount.find(suspendedFilter, 'name role').limit(LIST_CAP),
    AdminAccount.countDocuments(suspendedFilter),
  ]);

  res.json({
    openFlags, criticalOpen, failedSignins7d,
    without2fa, without2faCount,
    inactive30d, inactive30dCount,
    suspended, suspendedCount,
  });
}

export async function listFlags(req, res) {
  const { resolved } = req.query;
  const filter = {};
  if (resolved !== undefined) filter.resolved = resolved === 'true';
  const flags = await SecurityFlag.find(filter).sort({ createdAt: -1 });
  res.json({ flags });
}

export async function resolveFlag(req, res) {
  const { id } = req.params;
  const flag = await SecurityFlag.findById(id);
  if (!flag) return res.status(404).json({ error: 'Flag not found' });

  flag.resolved = true;
  flag.resolvedBy = req.admin._id;
  flag.resolvedAt = new Date();
  await flag.save();

  await logActivity(req, { action: 'Resolved oversight flag', target: flag.title, targetType: 'security', category: 'security', severity: 'info' });
  res.json({ flag });
}

// Un-resolves a flag — not currently wired into the UI, but the data layer
// already expects it (resolvedBy/resolvedAt get cleared) so the UI hookup
// is a pure frontend change later.
export async function reopenFlag(req, res) {
  const { id } = req.params;
  const flag = await SecurityFlag.findById(id);
  if (!flag) return res.status(404).json({ error: 'Flag not found' });

  flag.resolved = false;
  flag.resolvedBy = null;
  flag.resolvedAt = null;
  await flag.save();

  await logActivity(req, { action: 'Reopened oversight flag', target: flag.title, targetType: 'security', category: 'security', severity: 'warn' });
  res.json({ flag });
}
