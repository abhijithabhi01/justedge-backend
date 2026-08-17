import mongoose from 'mongoose';

// `id` is the human-chosen board type slug (e.g. "smart-meter-3phase") —
// used both as the public identifier in the API and, where a matching
// simulation profile exists, as the key into DEVICE_PROFILES in
// services/sensorFeed.js. Board types added here without a matching
// profile still work: the simulator falls back to a generic profile
// (see sensorFeed.profileFor).
const boardCatalogSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  conn: { type: String, trim: true, default: '' }, // e.g. "WiFi", "LoRaWAN", "Cellular"
  probes: { type: [String], default: [] }, // e.g. ["Temperature", "Humidity"]
  desc: { type: String, trim: true, default: '' },
}, { timestamps: true });

boardCatalogSchema.methods.toSafeJSON = function toSafeJSON() {
  const { id, name, conn, probes, desc } = this;
  return { id, name, conn, probes, desc };
};

export const BoardCatalog = mongoose.model('BoardCatalog', boardCatalogSchema);
