import { ActivityLog } from '../models/ActivityLog.js';

// Called explicitly at the end of a successful mutation (not as blanket route
// middleware) so each entry gets an accurate, human-readable action/target —
// "Suspended admin account" reads far better in the log than "PATCH /admins/:id".
//
// Actor resolution now covers both account tables: req.admin for platform
// staff (unchanged), falling back to req.user for fleet-customer actions
// (e.g. a User resolving their own alert) so those show up in the audit
// trail with the right name/role instead of being attributed to "System".
export async function logActivity(req, { action, target, targetType = 'other', category = 'admin', severity = 'info' }) {
  try {
    const actor = req.admin || req.user || null;
    const actorRole = req.admin ? req.admin.role : (req.user ? 'User' : 'system');

    await ActivityLog.create({
      actorId: actor?._id || null,
      actorName: actor?.name || 'System',
      actorRole,
      action, target, targetType, category, severity,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || '',
    });
  } catch (err) {
    // Never let a logging failure break the underlying request.
    console.error('[activity-log] failed to write entry:', err.message);
  }
}
