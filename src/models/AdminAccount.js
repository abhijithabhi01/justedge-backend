import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Platform-wide role model is Superadmin | Admin | User. This table only
// ever holds the first two (platform staff) — fleet customers ("User")
// live in models/UserAccount.js, a separate table with its own permission
// set, so the two dashboards keep clean data boundaries. Both tables draw
// their `role` value from the same conceptual 3-value enum.
const ADMIN_ROLES = ['Superadmin', 'Admin'];

export function defaultPermissionsForRole(role) {
  if (role === 'Superadmin') {
    return { manageAdmins: true, manageAccessControl: true, viewActivityLogs: true, systemOversight: true, manageUsers: true, manageSensors: true, billingAccess: true, exportData: true };
  }
  // Admin — everything except the two Superadmin-reserved powers.
  return { manageAdmins: false, manageAccessControl: false, viewActivityLogs: true, systemOversight: true, manageUsers: true, manageSensors: true, billingAccess: true, exportData: true };
}

const permissionsSchema = new mongoose.Schema({
  manageAdmins: { type: Boolean, default: false },
  manageAccessControl: { type: Boolean, default: false },
  viewActivityLogs: { type: Boolean, default: true },
  systemOversight: { type: Boolean, default: false },
  manageUsers: { type: Boolean, default: false },
  manageSensors: { type: Boolean, default: false },
  billingAccess: { type: Boolean, default: false },
  exportData: { type: Boolean, default: false },
}, { _id: false });

const adminAccountSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true, default: '' },
  companyName: { type: String, required: true, trim: true, default: 'Unassigned' },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ADMIN_ROLES, required: true, default: 'Admin' },
  status: { type: String, enum: ['invited', 'active', 'suspended'], default: 'invited' },
  twoFactor: { type: Boolean, default: false },
  permissions: { type: permissionsSchema, default: () => defaultPermissionsForRole('Admin') },
  lastLogin: { type: Date, default: null },
  failedLoginAttempts: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminAccount', default: null },
}, { timestamps: true });

adminAccountSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};

adminAccountSchema.methods.checkPassword = function checkPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

adminAccountSchema.methods.toSafeJSON = function toSafeJSON() {
  const { _id, name, email, phone, companyName, role, status, twoFactor, permissions, lastLogin, createdAt } = this;
  return { id: _id, name, email, phone, companyName, role, status, twoFactor, permissions, lastLogin, createdAt };
};

export const AdminAccount = mongoose.model('AdminAccount', adminAccountSchema);
export { ADMIN_ROLES };
