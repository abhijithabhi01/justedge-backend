import { UserAccount, defaultUserPermissions, USER_PERMISSION_KEYS } from '../models/UserAccount.js';
import { Device } from '../models/Device.js';
import { AdminAccount } from '../models/AdminAccount.js';
import { logActivity } from '../middleware/activityLogger.js';
import { sendUserWelcomeEmail } from '../services/emailService.js';

const USER_LIST_FIELDS = 'name email phone status permissions lastLogin createdAt createdBy';

function belongsToAdmin(user, admin) {
  return admin.role === 'Superadmin' || String(user.createdBy) === String(admin._id);
}

export async function listUsers(req, res) {
  const { page = 1, pageSize = 50, q } = req.query;
  const filter = req.admin.role === 'Superadmin'
    ? {}
    : { createdBy: req.admin._id };
  if (q) {
    const re = new RegExp(q, 'i');
    filter.$or = [{ name: re }, { email: re }];
  }

  const skip = (Number(page) - 1) * Number(pageSize);
  const [users, total] = await Promise.all([
    UserAccount.find(filter).select(USER_LIST_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(Number(pageSize)),
    UserAccount.countDocuments(filter),
  ]);

  res.json({ users: users.map((u) => u.toSafeJSON()), total, page: Number(page), pageSize: Number(pageSize) });
}

export async function getUser(req, res) {
  const { id } = req.params;
  const isSelf = req.user && String(req.user._id) === String(id);
  if (!req.admin && !isSelf) return res.status(403).json({ error: 'Forbidden' });

  const user = await UserAccount.findById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: user.toSafeJSON() });
}

export async function createUser(req, res) {
  const { name, email, phone, permissions } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });

  const emailNorm = email.toLowerCase().trim();

  const existingUser = await UserAccount.findOne({ email: emailNorm });
  if (existingUser) {
    return res.status(409).json({ error: 'A user account with that email already exists' });
  }

  // Same email cannot be used for both Admin and User logins
  const existingAdmin = await AdminAccount.findOne({ email: emailNorm });
  if (existingAdmin) {
    return res.status(409).json({
      error: 'This email is already used by an admin account. Choose a different email for the user.',
    });
  }

  const user = new UserAccount({
    name: name.trim(),
    email: emailNorm,
    phone: phone?.trim() || '',
    status: 'invited',
    permissions: defaultUserPermissions(permissions || {}),
    createdBy: req.admin._id,
  });

  const usernamePart = user.email.split('@')[0].replace(/[^a-z0-9]/gi, '') || 'user';
  const tempPassword = `${usernamePart}123`;
  await user.setPassword(tempPassword);
  await user.save();

  // Fetch admin info for the welcome email (company name, admin name)
  const creatingAdmin = await AdminAccount.findById(req.admin._id).select('name companyName');

  // Send welcome email — fire-and-forget (never block the response)
  sendUserWelcomeEmail({
    name:        user.name,
    email:       user.email,
    tempPassword,
    adminName:   creatingAdmin?.name   || '',
    companyName: creatingAdmin?.companyName || '',
  }).catch((err) => console.error('[email] sendUserWelcomeEmail failed:', err.message));

  await logActivity(req, { action: 'Created user account', target: user.name, targetType: 'user', category: 'user', severity: 'info' });
  res.status(201).json({ user: user.toSafeJSON(), tempPassword });
}

export async function updateUser(req, res) {
  const user = await UserAccount.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!belongsToAdmin(user, req.admin)) return res.status(403).json({ error: 'Forbidden' });

  const { name, email, phone } = req.body;
  if (name !== undefined) user.name = name.trim();
  if (email !== undefined) {
    const emailNorm = email.toLowerCase().trim();
    if (emailNorm !== user.email) {
      const takenUser = await UserAccount.findOne({ email: emailNorm, _id: { $ne: user._id } });
      if (takenUser) {
        return res.status(409).json({ error: 'A user account with that email already exists' });
      }
      const takenAdmin = await AdminAccount.findOne({ email: emailNorm });
      if (takenAdmin) {
        return res.status(409).json({
          error: 'This email is already used by an admin account. Choose a different email.',
        });
      }
      user.email = emailNorm;
    }
  }
  if (phone !== undefined) user.phone = phone.trim();

  await user.save();
  await logActivity(req, { action: 'Updated user account', target: user.name, targetType: 'user', category: 'user', severity: 'info' });
  res.json({ user: user.toSafeJSON() });
}

export async function setUserStatus(req, res) {
  const { status } = req.body;
  if (!['invited', 'active', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'status must be invited, active or suspended' });
  }

  const user = await UserAccount.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!belongsToAdmin(user, req.admin)) return res.status(403).json({ error: 'Forbidden' });

  user.status = status;
  await user.save();

  await logActivity(req, {
    action: status === 'suspended' ? 'Suspended user account' : 'Updated user status',
    target: user.name, targetType: 'user', category: 'user', severity: status === 'suspended' ? 'warn' : 'info',
  });
  res.json({ user: user.toSafeJSON() });
}

export async function setUserPermission(req, res) {
  const { key, value } = req.body;
  const user = await UserAccount.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!belongsToAdmin(user, req.admin)) return res.status(403).json({ error: 'Forbidden' });
  if (!USER_PERMISSION_KEYS.includes(key)) return res.status(400).json({ error: `Unknown permission: ${key}` });
  if (key === 'monitor') return res.status(400).json({ error: '"monitor" is locked on and cannot be changed' });

  user.permissions[key] = !!value;
  await user.save();

  await logActivity(req, { action: 'Changed permission', target: `${user.name} · ${key} → ${value}`, targetType: 'user', category: 'access', severity: 'info' });
  res.json({ user: user.toSafeJSON() });
}

export async function removeUser(req, res) {
  const user = await UserAccount.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!belongsToAdmin(user, req.admin)) return res.status(403).json({ error: 'Forbidden' });

  await user.deleteOne();
  // Un-assign any sensors owned by this user rather than leaving dangling references.
  await Device.updateMany({ assignedUserId: user._id }, { $set: { assignedUserId: null } });

  await logActivity(req, { action: 'Removed user account', target: user.name, targetType: 'user', category: 'user', severity: 'warn' });
  res.json({ ok: true });
}