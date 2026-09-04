import mongoose from 'mongoose';

// Inventory/CRM only — live telemetry is merged at request time from
// services/sensorFeed.js (simulator or AWS via awsDeviceId).
const deviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    boardId: { type: String, required: true, trim: true },
    imei: { type: String, required: true, unique: true, trim: true },
    simNo: { type: String, trim: true, default: '' },
    subscriptionPlan: { type: String, trim: true, default: '' },
    subscriptionExpiry: { type: Date, default: null },
    assignedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserAccount',
      default: null,
    },
    // Physical board id in AWS SensorData table (when SENSOR_DATA_SOURCE=aws)
    awsDeviceId: { type: String, trim: true, default: null },
    site: { type: String, trim: true, default: '' },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    // Owning admin company. Superadmin sees all; regular Admin only their own.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AdminAccount',
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

deviceSchema.methods.toSafeJSON = function toSafeJSON() {
  const {
    _id,
    name,
    boardId,
    imei,
    simNo,
    subscriptionPlan,
    subscriptionExpiry,
    assignedUserId,
    awsDeviceId,
    site,
    lat,
    lng,
    createdBy,
    createdAt,
  } = this;
  return {
    id: _id,
    name,
    boardId,
    imei,
    simNo,
    subscriptionPlan,
    subscriptionExpiry,
    assignedUserId,
    awsDeviceId,
    site,
    lat,
    lng,
    createdBy: createdBy ? String(createdBy) : null,
    createdAt,
  };
};

export const Device = mongoose.model('Device', deviceSchema);