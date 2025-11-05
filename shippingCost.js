import mongoose from "mongoose";

const shippingCostSchema = new mongoose.Schema({
  baseCost: { type: Number, required: true, default: 0 }, // Default flat shipping cost
  minCost: { type: Number, default: 0 },                  // Minimum possible shipping cost
  maxCost: { type: Number, default: 500 },                // Maximum possible shipping cost
  freeShippingThreshold: { type: Number, default: 1000 }, // Free shipping above this value
  tieredCosts: [
    {
      minOrderValue: { type: Number, required: true },     // Example: Orders above ₹500
      shippingCost: { type: Number, required: true }       // Example: ₹20 for orders above ₹500
    }
  ],
});

const ShippingCost = mongoose.model("ShippingCost", shippingCostSchema);

export default ShippingCost;
