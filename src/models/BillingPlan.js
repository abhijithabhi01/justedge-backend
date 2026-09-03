import mongoose from 'mongoose';

const billingPlanSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  desc: { type: String, trim: true, default: '' },
  price: { type: String, trim: true, default: '' },
  durationMonths: {
    type: Number,
    enum: [1, 3, 6, 12],
    default: 1,
  },
}, { timestamps: true });

billingPlanSchema.methods.toSafeJSON = function toSafeJSON() {
  const { id, name, desc, price, durationMonths } = this;
  return { id, name, desc, price, durationMonths: durationMonths || 1 };
};

export const BillingPlan = mongoose.model('BillingPlan', billingPlanSchema);