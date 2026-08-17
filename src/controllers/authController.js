import jwt from 'jsonwebtoken';
import { AdminAccount } from '../models/AdminAccount.js';
import { UserAccount } from '../models/UserAccount.js';
import { logActivity } from '../middleware/activityLogger.js';
import { SecurityFlag } from '../models/SecurityFlag.js';

function signToken(account, kind) {
  return jwt.sign({ sub: account._id.toString(), role: account.role, kind }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });
}

// Unified login: the frontend has one login screen for both the admin
// console and the user dashboard, so this checks both identity tables with
// one request. Email is unique per-table (not globally), so it's two
// lookups rather than one query across a merged collection.
export async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const normalizedEmail = email.toLowerCase().trim();

  const admin = await AdminAccount.findOne({ email: normalizedEmail }).select('+passwordHash');
  if (admin) return loginAdmin(req, res, admin, password);

  const user = await UserAccount.findOne({ email: normalizedEmail }).select('+passwordHash');
  if (user) return loginUser(req, res, user, password);

  return res.status(401).json({ error: 'Invalid email or password' });
}

async function loginAdmin(req, res, admin, password) {
  if (admin.status === 'suspended') {
    return res.status(403).json({ error: 'This admin account is suspended' });
  }

  const valid = await admin.checkPassword(password);
  if (!valid) {
    admin.failedLoginAttempts = (admin.failedLoginAttempts || 0) + 1;
    await admin.save();
    await ActivityLogFor(req, admin, {
      action: 'Failed sign-in attempt', target: 'Admin console', targetType: 'session',
      category: 'security', severity: 'critical',
    });

    // Three or more failed attempts raises an oversight flag automatically —
    // this is the kind of signal the Oversight view surfaces beyond raw logs.
    if (admin.failedLoginAttempts >= 3) {
      await SecurityFlag.create({
        title: 'Repeated failed sign-ins',
        description: `${admin.name} (${admin.email}) has had ${admin.failedLoginAttempts} failed sign-in attempts.`,
        severity: 'critical',
        category: 'security',
        relatedAdminId: admin._id,
      });
    }
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  admin.failedLoginAttempts = 0;
  admin.lastLogin = new Date();
  if (admin.status === 'invited') admin.status = 'active';
  await admin.save();

  req.admin = admin; // for logActivity's normal signature
  await logActivity(req, { action: 'Signed in', target: 'Admin console', targetType: 'session', category: 'access', severity: 'info' });

  const token = signToken(admin, 'admin');
  res.json({ token, admin: admin.toSafeJSON() });
}

async function loginUser(req, res, user, password) {
  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'This account is suspended' });
  }

  const valid = await user.checkPassword(password);
  if (!valid) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    await user.save();
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  user.failedLoginAttempts = 0;
  user.lastLogin = new Date();
  if (user.status === 'invited') user.status = 'active';
  await user.save();

  // User-dashboard sign-ins aren't written to the admin activity log —
  // that log/audit trail is scoped to admin-console actors and actions.
  const token = signToken(user, 'user');
  res.json({ token, user: user.toSafeJSON() });
}

// Small helper so the failed-login path (before req.admin is set) can still log with the right actor.
async function ActivityLogFor(req, admin, fields) {
  req.admin = admin;
  await logActivity(req, fields);
  req.admin = null;
}

export async function me(req, res) {
  if (req.user) return res.json({ user: req.user.toSafeJSON() });
  res.json({ admin: req.admin.toSafeJSON() });
}

export async function logout(req, res) {
  if (req.admin) {
    await logActivity(req, { action: 'Signed out', target: 'Admin console', targetType: 'session', category: 'access', severity: 'info' });
  }
  // JWTs are stateless here; the client discards the token. A denylist/refresh-token
  // store can be added later without changing this route's contract.
  res.json({ ok: true });
}
