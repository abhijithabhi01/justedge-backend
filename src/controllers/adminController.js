import { AdminAccount, defaultPermissionsForRole } from '../models/AdminAccount.js';
import { UserAccount } from '../models/UserAccount.js';
import { Device } from '../models/Device.js';
import { logActivity } from '../middleware/activityLogger.js';

// Only pull the fields toSafeJSON() actually exposes — trims what Mongo
// has to load and send over the wire (passwordHash is already excluded by
// the schema's `select: false`, this goes further for the rest).
const ADMIN_LIST_FIELDS = 'name email phone companyName role status twoFactor permissions lastLogin createdAt';

export async function listAdmins(req, res) {
  const { page = 1, pageSize = 50 } = req.query;
  const skip = (Number(page) - 1) * Number(pageSize);

  const [admins, total] = await Promise.all([
    AdminAccount.find().select(ADMIN_LIST_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(Number(pageSize)),
    AdminAccount.countDocuments(),
  ]);

   const results = await Promise.all(admins.map(async (admin) => {
    const users = await UserAccount.find({ createdBy: admin._id })
      .select('_id name email status role')
      .sort({ name: 1 });
    const userIds = users.map((user) => user._id);
    const subscriptionCount = userIds.length
      ? await Device.countDocuments({
        assignedUserId: { $in: userIds },
        subscriptionPlan: { $ne: '' },
      })
      : 0;

    return {
      ...admin.toSafeJSON(),
      userCount: users.length,
      subscriptionCount,
      teamUsers: users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        status: u.status,
        role: u.role,
      })),
    };
  }));

  res.json({ admins: results, total, page: Number(page), pageSize: Number(pageSize) });
}

export async function createAdmin(req, res) {
  const { name, email, phone, companyName, twoFactor, tempPassword } = req.body;
  if (!name || !email || !companyName) return res.status(400).json({ error: 'name, email and companyName are required' });

  const existing = await AdminAccount.findOne({ email: email.toLowerCase().trim() });
  if (existing) return res.status(409).json({ error: 'An admin account with that email already exists' });

  const admin = new AdminAccount({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    phone: phone?.trim() || '',
    companyName: companyName.trim(),
    role: 'Admin',
    status: 'invited',
    twoFactor: !!twoFactor,
    permissions: defaultPermissionsForRole('Admin'),
    createdBy: req.admin._id,
  });
  // Default password is derived from the email's local-part, e.g.
  // "priya@company.com" -> "priya123", unless the superadmin supplied one
  // explicitly via tempPassword. Returned once in the response so it can be
  // shared with the new admin; never stored in plaintext or retrievable again.
  const usernamePart = admin.email.split('@')[0].replace(/[^a-z0-9]/gi, '') || 'admin';
  const finalTempPassword = tempPassword || `${usernamePart}123`;
  await admin.setPassword(finalTempPassword);
  await admin.save();

  await logActivity(req, { action: 'Created admin account', target: `${admin.name} (${admin.role})`, targetType: 'admin', category: 'admin', severity: 'warn' });
  res.status(201).json({ admin: admin.toSafeJSON(), tempPassword: finalTempPassword });
}

export async function updateAdmin(req, res) {
  const { id } = req.params;
  const admin = await AdminAccount.findById(id);
  if (!admin) return res.status(404).json({ error: 'Admin account not found' });

  const { name, email, phone, companyName, status, twoFactor } = req.body;
  if (name !== undefined) admin.name = name.trim();
  if (email !== undefined) admin.email = email.toLowerCase().trim();
  if (phone !== undefined) admin.phone = phone.trim();
  if (companyName !== undefined) admin.companyName = companyName.trim();
  if (status !== undefined) admin.status = status;
  if (twoFactor !== undefined) admin.twoFactor = !!twoFactor;

  await admin.save();
  await logActivity(req, { action: 'Updated admin account', target: admin.name, targetType: 'admin', category: 'admin', severity: 'info' });
  res.json({ admin: admin.toSafeJSON() });
}

export async function setAdminStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body; // 'active' | 'suspended'
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'status must be active or suspended' });

  const admin = await AdminAccount.findById(id);
  if (!admin) return res.status(404).json({ error: 'Admin account not found' });

  if (status === 'suspended' && admin.role === 'Superadmin') {
    const otherActiveSuperadmins = await AdminAccount.countDocuments({ role: 'Superadmin', status: 'active', _id: { $ne: admin._id } });
    if (otherActiveSuperadmins === 0) return res.status(400).json({ error: 'Cannot suspend the last active Superadmin' });
  }
  if (String(admin._id) === String(req.admin._id) && status === 'suspended') {
    return res.status(400).json({ error: 'You cannot suspend your own account' });
  }

  admin.status = status;
  await admin.save();

  // Cascade status to users created by this admin (company fleet accounts).
  const userCascade = await UserAccount.updateMany(
    { createdBy: admin._id },
    { $set: { status } }
  );
  const cascadedUsers = userCascade.modifiedCount ?? userCascade.nModified ?? 0;

  await logActivity(req, {
    action:
      status === 'suspended'
        ? `Suspended admin account (+${cascadedUsers} users)`
        : `Reactivated admin account (+${cascadedUsers} users)`,
    target: admin.name,
    targetType: 'admin',
    category: 'admin',
    severity: 'critical',
  });
  res.json({
    admin: admin.toSafeJSON(),
    cascadedUsers,
  });
}

export async function removeAdmin(req, res) {
  const { id } = req.params;
  const admin = await AdminAccount.findById(id);
  if (!admin) return res.status(404).json({ error: 'Admin account not found' });

  if (String(admin._id) === String(req.admin._id)) {
    return res.status(400).json({ error: 'You cannot remove your own account' });
  }
  if (admin.role === 'Superadmin') {
    const otherSuperadmins = await AdminAccount.countDocuments({ role: 'Superadmin', _id: { $ne: admin._id } });
    if (otherSuperadmins === 0) return res.status(400).json({ error: 'Cannot remove the last Superadmin account' });
  }

  await admin.deleteOne();
  await logActivity(req, { action: 'Removed admin account', target: admin.name, targetType: 'admin', category: 'admin', severity: 'critical' });
  res.json({ ok: true });
}

export async function setAdminPermission(req, res) {
  const { id } = req.params;
  const { key, value } = req.body;
  const admin = await AdminAccount.findById(id);
  if (!admin) return res.status(404).json({ error: 'Admin account not found' });
  if (!(key in admin.permissions.toObject())) return res.status(400).json({ error: `Unknown permission: ${key}` });
  if (key === 'manageAdmins' && admin.role !== 'Superadmin') {
    return res.status(400).json({ error: 'manageAdmins can only be granted to Superadmins' });
  }

  admin.permissions[key] = !!value;
  await admin.save();
  await logActivity(req, { action: 'Changed permission', target: `${admin.name} · ${key} → ${value}`, targetType: 'admin', category: 'access', severity: 'warn' });
  res.json({ admin: admin.toSafeJSON() });
}