// models/preorder.js
import mongoose from "mongoose";
const preorderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  color: String,
  size: String,
  amountPaid: { type: Number, default: 100 },
  status: { type: String, default: "pending" }, // pending, completed, refunded, etc.
  createdAt: { type: Date, default: Date.now },
  discountType: { type: String, enum: ["fixed", "percentage"], default: "fixed" },
  discountValue: { type: Number, default: 100 } // default ₹100
});
export default mongoose.model("Preorder", preorderSchema);