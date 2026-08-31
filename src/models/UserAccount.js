import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Owner/Manager/Viewer-style distinctions from the old two-role-set model
// are now expressed purely through these permission flags rather than a
// separate role label — e.g. an "Owner"-equivalent User has every
// fleet-facing permission granted, a "Viewer"-equivalent has only
// `monitor` + `exportData`.
export const USER_PERMISSION_KEYS = [
  'monitor', 'addSensor', 'editSensor', 'removeSensor', 'automations', 'alerts', 'manageUsers', 'exportData',
];

// `monitor` is always on and can't be turned off (see setUserPermission).
// `exportData` defaults on too since a User export is just "your own CSV
// download" — everything else starts off until an admin/superadmin grants it.
export function defaultUserPermissions(overrides = {}) {
  return {
    monitor: true,
    addSensor: false,
    editSensor: false,
    removeSensor: false,
    automations: false,
    alerts: false,
    manageUsers: false,
    exportData: true,
    ...overrides,
    monitor: true, // re-assert last: overrides can never turn this off
  };
}

const userPermissionsSchema = new mongoose.Schema({
  monitor: { type: Boolean, default: true },
  addSensor: { type: Boolean, default: false },
  editSensor: { type: Boolean, default: false },
  removeSensor: { type: Boolean, default: false },
  automations: { type: Boolean, default: false },
  alerts: { type: Boolean, default: false },
  manageUsers: { type: Boolean, default: false },
  exportData: { type: Boolean, default: true },
}, { _id: false });

const userAccountSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true, default: '' },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['User'], default: 'User' },
  status: { type: String, enum: ['invited', 'active', 'suspended'], default: 'invited' },
  permissions: { type: userPermissionsSchema, default: () => defaultUserPermissions() },
  lastLogin: { type: Date, default: null },
  failedLoginAttempts: { type: Number, default: 0 },
  // Which admin/superadmin created this fleet account, for traceability.
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminAccount', default: null },
}, { timestamps: true });

// Belt-and-braces: even if something assigns `permissions` wholesale, monitor
// stays locked on rather than relying on every call site to remember.
userAccountSchema.pre('save', function guardMonitor(next) {
  if (this.permissions) this.permissions.monitor = true;
  next();
});

userAccountSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};

userAccountSchema.methods.checkPassword = function checkPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userAccountSchema.methods.toSafeJSON = function toSafeJSON() {
  const { _id, name, email, phone, role, status, permissions, lastLogin, createdAt, createdBy } = this;
  return {
    id: _id,
    name,
    email,
    phone,
    role,
    status,
    permissions,
    lastLogin,
    createdAt,
    createdBy: createdBy ? String(createdBy) : null,
  };
};

export const UserAccount = mongoose.model('UserAccount', userAccountSchema);
