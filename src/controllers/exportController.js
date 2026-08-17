import { Device } from '../models/Device.js';
import { UserAccount } from '../models/UserAccount.js';
import { ActivityLog } from '../models/ActivityLog.js';

function toCSV(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((c) => esc(row[c])).join(','));
  return [header, ...lines].join('\n');
}

function sendCSV(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// Same query params as the matching list route (q/from/to/etc.) so "export
// what I'm currently viewing" is a straight passthrough where applicable.
const EXPORTERS = {
  sensors: async (req) => {
    const filter = {};
    // A User's export is always scoped to their own assigned sensors.
    if (req.user) filter.assignedUserId = req.user._id;
    const devices = await Device.find(filter);
    const rows = devices.map((d) => d.toSafeJSON());
    return {
      filename: 'sensors.csv',
      csv: toCSV(rows, ['id', 'name', 'boardId', 'imei', 'simNo', 'subscriptionPlan', 'subscriptionExpiry', 'assignedUserId', 'createdAt']),
    };
  },
  users: async () => {
    const users = await UserAccount.find().select('name email phone status lastLogin createdAt');
    const rows = users.map((u) => u.toSafeJSON());
    return {
      filename: 'users.csv',
      csv: toCSV(rows, ['id', 'name', 'email', 'phone', 'status', 'lastLogin', 'createdAt']),
    };
  },
  activity: async (req) => {
    const { from, to, q } = req.query;
    const filter = {};
    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = new Date(from);
      if (to) filter.timestamp.$lte = new Date(to);
    }
    if (q) {
      const re = new RegExp(q, 'i');
      filter.$or = [{ actorName: re }, { action: re }, { target: re }];
    }
    const logs = await ActivityLog.find(filter).sort({ timestamp: -1 }).limit(5000);
    const rows = logs.map((l) => ({
      id: l._id, actorName: l.actorName, actorRole: l.actorRole, action: l.action,
      target: l.target, category: l.category, severity: l.severity, timestamp: l.timestamp,
    }));
    return {
      filename: 'activity.csv',
      csv: toCSV(rows, ['id', 'actorName', 'actorRole', 'action', 'target', 'category', 'severity', 'timestamp']),
    };
  },
  billing: async () => {
    const devices = await Device.find().select('name subscriptionPlan subscriptionExpiry assignedUserId');
    const rows = devices.map((d) => ({
      id: d._id, name: d.name, subscriptionPlan: d.subscriptionPlan,
      subscriptionExpiry: d.subscriptionExpiry, assignedUserId: d.assignedUserId,
    }));
    return {
      filename: 'billing.csv',
      csv: toCSV(rows, ['id', 'name', 'subscriptionPlan', 'subscriptionExpiry', 'assignedUserId']),
    };
  },
};

export async function exportData(req, res) {
  const { type } = req.params;
  const exporter = EXPORTERS[type];
  if (!exporter) return res.status(400).json({ error: 'type must be one of sensors, users, activity, billing' });

  // A User's exportData permission only ever covers their own sensors —
  // the other export types are admin-console reporting surfaces.
  if (req.user && type !== 'sensors') return res.status(403).json({ error: 'Forbidden' });

  const { filename, csv } = await exporter(req);
  sendCSV(res, filename, csv);
}
