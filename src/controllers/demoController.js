import { DemoData } from '../models/DemoData.js';
import { AdminAccount } from '../models/AdminAccount.js';
import { UserAccount } from '../models/UserAccount.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'justedge-dev-secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

export async function getDemoLive(req, res) {
  const defaults = await DemoData.find({ kind: 'sensor' }).lean();

  const deviceKeys = [
    ...new Set(defaults.map((d) => d.deviceKey).filter(Boolean)),
  ];

  if (!deviceKeys.length) {
    const any = await DemoData.aggregate([
      { $match: { kind: 'reading' } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$deviceKey', doc: { $first: '$$ROOT' } } },
    ]);
    return res.json({
      sensors: any.map((x) => formatReading(x.doc)),
      generatedAt: new Date().toISOString(),
      source: 'mongodb-demodata',
    });
  }

  const latest = await DemoData.aggregate([
    { $match: { kind: 'reading', deviceKey: { $in: deviceKeys } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$deviceKey',
        doc: { $first: '$$ROOT' },
      },
    },
  ]);

  const byKey = new Map(latest.map((x) => [x._id, x.doc]));

  const sensors = defaults.map((def) => {
    const live = byKey.get(def.deviceKey);
    if (!live) return formatReading(def);
    return formatReading({ ...def, ...live, deviceName: def.deviceName });
  });

  res.json({
    sensors,
    generatedAt: new Date().toISOString(),
    source: 'mongodb-demodata',
  });
}

function formatReading(doc) {
  return {
    id: doc.deviceKey || String(doc._id),
    deviceKey: doc.deviceKey,
    name: doc.deviceName || doc.deviceKey,
    boardType: doc.boardType || 'Demo Board',
    status: doc.status || 'online',
    lat: doc.lat ?? null,
    lng: doc.lng ?? null,
    temp: doc.temp ?? null,
    humidity: doc.humidity ?? null,
    battery: doc.battery ?? null,
    location:
      doc.lat != null && doc.lng != null
        ? `${Number(doc.lat).toFixed(4)}, ${Number(doc.lng).toFixed(4)}`
        : '—',
    source: 'demo',
    updatedAt: doc.createdAt || doc.updatedAt || null,
  };
}

export async function demoLogin(req, res) {
  const role = String(req.body?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'user') {
    return res.status(400).json({ error: 'role must be admin or user' });
  }

  const accountMeta = await DemoData.findOne({
    kind: 'account',
    role: role === 'admin' ? 'Admin' : 'User',
  }).lean();

  if (!accountMeta?.email) {
    return res.status(503).json({
      error: 'Demo accounts not seeded. Run: npm run seed:demo-mongo',
    });
  }

  if (role === 'admin') {
    const admin = await AdminAccount.findOne({ email: accountMeta.email });
    if (!admin) {
      return res.status(503).json({ error: 'Demo admin missing — re-run seed' });
    }
    const token = jwt.sign(
      {
        sub: String(admin._id),
        type: 'admin',
        role: admin.role,
        isDemo: true,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );
    return res.json({
      token,
      isDemo: true,
      admin: admin.toSafeJSON(),
    });
  }

  const user = await UserAccount.findOne({ email: accountMeta.email });
  if (!user) {
    return res.status(503).json({ error: 'Demo user missing — re-run seed' });
  }
  const token = jwt.sign(
    {
      sub: String(user._id),
      type: 'user',
      role: user.role || 'User',
      isDemo: true,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
  return res.json({
    token,
    isDemo: true,
    user: user.toSafeJSON(),
  });
}

export async function listDemoAccounts(req, res) {
  const accounts = await DemoData.find({ kind: 'account' })
    .select('role email name')
    .lean();
  res.json({
    accounts: accounts.map((a) => ({
      role: a.role,
      email: a.email,
      name: a.name,
    })),
  });
}