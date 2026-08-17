import mongoose from 'mongoose';

const automationSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAccount', default: null },
  deviceId: { type: String, default: '' },
  icon: { type: String, default: '' },
  name: { type: String, required: true },
  // Plain-language/condition string the UI already displays, e.g.
  // "IF Data Center > 29°C THEN notify Aditya" — kept as a string rather
  // than a structured condition schema unless a rule-builder UI needs it.
  rule: { type: String, required: true },
  on: { type: Boolean, default: true },
  runs: { type: Number, default: 0 },
  lastRun: { type: Date, default: null },
}, { timestamps: true });

automationSchema.index({ ownerId: 1, createdAt: -1 });

automationSchema.methods.toSafeJSON = function toSafeJSON() {
  const { _id, ownerId, deviceId, icon, name, rule, on, runs, lastRun, createdAt } = this;
  return { id: _id, ownerId, deviceId, icon, name, rule, on, runs, lastRun, createdAt };
};

export const Automation = mongoose.model('Automation', automationSchema);
