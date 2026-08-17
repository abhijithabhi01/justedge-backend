import mongoose from 'mongoose';

const securityFlagSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  severity: { type: String, enum: ['info', 'warn', 'critical'], default: 'info' },
  category: { type: String, enum: ['security', 'access', 'account', 'sensor'], default: 'security' },
  relatedAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminAccount', default: null },
  resolved: { type: Boolean, default: false },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminAccount', default: null },
  resolvedAt: { type: Date, default: null },
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } });

// listFlags filters on `resolved` and sorts by `createdAt` — this compound
// index covers both in one pass instead of a full collection scan.
securityFlagSchema.index({ resolved: 1, createdAt: -1 });

export const SecurityFlag = mongoose.model('SecurityFlag', securityFlagSchema);