import mongoose from 'mongoose';

/**
 * Single collection for the public demo experience.
 * - kind: 'account'  → demo admin / user metadata
 * - kind: 'sensor'   → default sensor definitions
 * - kind: 'reading'  → live GPS / temperature samples (TTL)
 * Never written to AWS / DynamoDB.
 */
const demoDataSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ['account', 'sensor', 'reading'],
      required: true,
      index: true,
    },
    role: { type: String, enum: ['Admin', 'User', null], default: null },
    email: { type: String, default: null, index: true },
    name: { type: String, default: null },
    refId: { type: String, default: null },

    deviceKey: { type: String, default: null, index: true },
    deviceName: { type: String, default: null },
    boardType: { type: String, default: null },

    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    temp: { type: Number, default: null },
    humidity: { type: Number, default: null },
    battery: { type: Number, default: null },
    status: { type: String, default: 'online' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: 'demodata',
  }
);

demoDataSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: Number(process.env.DEMO_READING_TTL_SEC || 3600),
    partialFilterExpression: { kind: 'reading' },
  }
);

demoDataSchema.index({ kind: 1, deviceKey: 1, createdAt: -1 });

export const DemoData = mongoose.model('DemoData', demoDataSchema);