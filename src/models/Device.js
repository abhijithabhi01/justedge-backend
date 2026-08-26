import mongoose from 'mongoose';

// This is inventory/CRM data only — name, board type, IMEI, SIM, plan,
// who it's assigned to. Live telemetry (relays, sensor readings, battery,
// online/offline) never lives here; it comes from services/sensorFeed.js
// and is merged onto this record's fields at request time so
// GET /api/devices/:id/live returns both in one call.
const deviceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  // References BoardCatalog.id (and, incidentally, the simulator's device
  // profile key in sensorFeed.js — see profileFor()).
  boardId: { type: String, required: true, trim: true },
  imei: { type: String, required: true, unique: true, trim: true },
  simNo: { type: String, trim: true, default: '' },
  subscriptionPlan: { type: String, trim: true, default: '' },
  // Folded on here rather than a separate subscriptions collection — see
  // controllers/billingController.js for the reasoning.
  subscriptionExpiry: { type: Date, default: null },
  assignedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'UserAccount', default: null },
  // Links this inventory record to a physical board's deviceId in the
  // AWS SensorData table (see services/iotFeed.js). Only meaningful when
  // SENSOR_DATA_SOURCE=aws; null/unset devices keep using the simulator.
  awsDeviceId: { type: String, trim: true, default: null },
}, { timestamps: true });

deviceSchema.methods.toSafeJSON = function toSafeJSON() {
  const { _id, name, boardId, imei, simNo, subscriptionPlan, subscriptionExpiry, assignedUserId, awsDeviceId, createdAt } = this;
  return { id: _id, name, boardId, imei, simNo, subscriptionPlan, subscriptionExpiry, assignedUserId, awsDeviceId, createdAt };
};

export const Device = mongoose.model('Device', deviceSchema);