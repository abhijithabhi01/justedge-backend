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
}, { timestamps: true });

deviceSchema.methods.toSafeJSON = function toSafeJSON() {
  const { _id, name, boardId, imei, simNo, subscriptionPlan, subscriptionExpiry, assignedUserId, createdAt } = this;
  return { id: _id, name, boardId, imei, simNo, subscriptionPlan, subscriptionExpiry, assignedUserId, createdAt };
};

export const Device = mongoose.model('Device', deviceSchema);
