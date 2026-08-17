import mongoose from 'mongoose';

const billingPlanSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  desc: { type: String, trim: true, default: '' },
  // Kept as a display string ("$9/mo") rather than a number — no
  // currency math happens server-side today.
  price: { type: String, trim: true, default: '' },
}, { timestamps: true });

billingPlanSchema.methods.toSafeJSON = function toSafeJSON() {
  const { id, name, desc, price } = this;
  return { id, name, desc, price };
};

export const BillingPlan = mongoose.model('BillingPlan', billingPlanSchema);
