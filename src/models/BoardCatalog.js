import mongoose from 'mongoose';

export const BOARD_CATEGORIES = [
  'commercial',
  'infotainment',
  'industrial',
  'fleet',
  'cold-storage',
  'lab',
  'other',
];

export const BOARD_CONNECTIVITY = [
  'WiFi',
  'BLE',
  '4G LTE',
  'LoRaWAN',
  'Ethernet',
  'Other',
];

const boardCatalogSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  category: {
    type: String,
    enum: BOARD_CATEGORIES,
    default: 'other',
    trim: true,
  },
  conn: { type: String, trim: true, default: 'WiFi' },
  probes: { type: [String], default: [] },
  desc: { type: String, trim: true, default: '' },
}, { timestamps: true });

boardCatalogSchema.methods.toSafeJSON = function toSafeJSON() {
  const { id, name, category, conn, probes, desc } = this;
  return { id, name, category, conn, probes, desc };
};

export const BoardCatalog = mongoose.model('BoardCatalog', boardCatalogSchema);