import { AdminAccount, ADMIN_ROLES, defaultPermissionsForRole } from '../models/AdminAccount.js';

// Read-only view of what each role gets by default — the frontend's "Role defaults" table.
export async function roleMatrix(req, res) {
  const matrix = ADMIN_ROLES.reduce((acc, role) => {
    acc[role] = defaultPermissionsForRole(role);
    return acc;
  }, {});
  res.json({ roles: ADMIN_ROLES, matrix });
}

export async function accountAccess(req, res) {
  const { id } = req.params;
  const admin = await AdminAccount.findById(id);
  if (!admin) return res.status(404).json({ error: 'Admin account not found' });
  res.json({
    id: admin._id, name: admin.name, role: admin.role, status: admin.status,
    twoFactor: admin.twoFactor, permissions: admin.permissions,
  });
}
