import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAccount', default: null },
  deviceId: { type: String, default: '' },
  icon: { type: String, default: '' },
  tone: { type: String, enum: ['info', 'warn', 'critical'], default: 'info' },
  title: { type: String, required: true },
  desc: { type: String, default: '' },
  resolved: { type: Boolean, default: false },
  snoozedUntil: { type: Date, default: null },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

alertSchema.index({ ownerId: 1, resolved: 1, createdAt: -1 });

alertSchema.methods.toSafeJSON = function toSafeJSON() {
  const { _id, ownerId, deviceId, icon, tone, title, desc, resolved, snoozedUntil, createdAt } = this;
  return { id: _id, ownerId, deviceId, icon, tone, title, desc, resolved, snoozedUntil, createdAt };
};

export const Alert = mongoose.model('Alert', alertSchema);
