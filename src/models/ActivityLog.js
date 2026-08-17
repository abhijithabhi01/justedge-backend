import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminAccount', default: null },
  actorName: { type: String, required: true },
  actorRole: { type: String, required: true },
  action: { type: String, required: true },
  target: { type: String, default: '' },
  targetType: { type: String, enum: ['admin', 'user', 'sensor', 'alert', 'automation', 'session', 'data', 'security', 'other'], default: 'other' },
  category: { type: String, enum: ['admin', 'access', 'user', 'sensor', 'data', 'security'], default: 'admin', index: true },
  severity: { type: String, enum: ['info', 'warn', 'critical'], default: 'info', index: true },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
}, { timestamps: { createdAt: 'timestamp', updatedAt: false } });

// Audit trail is append-only: no update/remove methods are exposed via the API.
activityLogSchema.index({ timestamp: -1 });

export const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
