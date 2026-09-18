import mongoose from 'mongoose';

const automationSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAccount', default: null },
    deviceId: { type: String, default: '' },
    icon: { type: String, default: 'i-zap' },
    name: { type: String, required: true },
    // Human-readable rule shown in the UI
    rule: { type: String, required: true },
    // Structured condition (preferred by the engine)
    metric: {
      type: String,
      enum: ['battery', 'temperature', 'humidity', 'offline', 'journey_started', 'journey_arrived', 'journey_returned', ''],
      default: '',
    },
    operator: {
      type: String,
      enum: ['<', '<=', '>', '>=', '==', 'offline', 'event', ''],
      default: '',
    },
    threshold: { type: Number, default: null },
    action: { type: String, enum: ['alert', 'notify', ''], default: 'alert' },
    on: { type: Boolean, default: true },
    runs: { type: Number, default: 0 },
    lastRun: { type: Date, default: null },
  },
  { timestamps: true }
);

automationSchema.index({ ownerId: 1, createdAt: -1 });
automationSchema.index({ on: 1 });

automationSchema.methods.toSafeJSON = function toSafeJSON() {
  const {
    _id,
    ownerId,
    deviceId,
    icon,
    name,
    rule,
    metric,
    operator,
    threshold,
    action,
    on,
    runs,
    lastRun,
    createdAt,
  } = this;
  return {
    id: _id,
    ownerId,
    deviceId,
    icon,
    name,
    rule,
    metric: metric || '',
    operator: operator || '',
    threshold: threshold ?? null,
    action: action || 'alert',
    on,
    runs,
    lastRun,
    createdAt,
  };
};

export const Automation = mongoose.model('Automation', automationSchema);
