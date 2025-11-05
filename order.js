import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

// PATCH: Add returnDetails for refund info to product schema
const orderProductSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  productId: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  priceAtOrder: { type: Number, required: true },
  sku: { type: String },
  color: { type: String },
  size: { type: String },
  productName: { type: String },
  slug: { type: String },
  status: {
    type: String,
    enum: [
      "Pending",
      "Delivered",
      "Return Requested",
      "Returned",
      "Return Approved",
      "Return Rejected",
      "Refunded" // Optional: you may want to track per-product refunded state
    ],
    default: "Delivered",
  },
  returnIssueType: { type: String },
  returnIssueDesc: { type: String },
  returnResolutionType: { type: String, enum: ["Refund", "Replacement"] },
  returnImages: [{ type: String }],
  pickupStatus: { type: String, enum: ["Pending", "Picked Up"], default: "Pending" },
  replacementOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
  exchangeToSize: { type: String },
  exchangeToColor: { type: String },

  // PATCH: Add returnDetails for refund info
  returnDetails: {
    refundDate: { type: Date },
    refundAmount: { type: Number },
    refundTransactionId: { type: String }
  }
});

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, unique: true, index: true },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    products: [orderProductSchema],

    shippingAddress: {
      name: { type: String, required: true },
      email: { type: String, required: true },
      address: { type: String, required: true },
      postalCode: { type: String, required: true },
      deliveryPhone: { type: String },
    },

    paymentMethod: { type: String, required: true },
    shippingCost: { type: Number, default: 0 },
    totalPrice: { type: Number, required: true, min: 0 },

    // Payment Tracking
    isPaid: { type: Boolean, default: false },
    paidAt: { type: Date },
    expiresAt: { type: Date, index: true },
    isExpired: { type: Boolean, default: false },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    paymentDetails: { type: Object },

    // Order Lifecycle Tracking
    status: {
      type: String,
      enum: [
        "Pending",
        "Processing",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Return Requested",
        "Returned",
      ],
      default: "Pending",
    },
    deliveredAt: { type: Date },
    cancellationReason: { type: String },
    cancelledAt: { type: Date },
    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Refund & Return (order-level)
    refundStatus: {
      type: String,
      enum: ["None", "Requested", "Approved", "Rejected", "Processed"],
      default: "None",
    },
    refundedAmount: { type: Number }, // PATCH: add this for total refund amount
    refundTransactionId: { type: String }, // PATCH: add this for Razorpay refund txn
    refundDate: { type: Date }, // PATCH: add this for refund date
    returnRequestedAt: { type: Date },
    refundProcessedAt: { type: Date },

    returnReason: { type: String },
    returnRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    returnNotes: { type: String },

    // Shipping Tracking Fields
    shippedFrom: { type: String, default: "Main Warehouse" },
    trackingNumber: { type: String, unique: true, sparse: true, index: true },
    shippingCarrier: { type: String },

    shipcorrectOrderNo: { type: String, index: true },
  },
  { timestamps: true }
);

// Auto-generate Order ID before saving
orderSchema.pre("save", function (next) {
  if (!this.orderId) {
    const timestamp = new Date().toISOString().split("T")[0].replace(/-/g, "");
    this.orderId = `ORD-${timestamp}-${uuidv4().split("-")[0].toUpperCase()}`;
  }
  next();
});

const Order = mongoose.model("Order", orderSchema);
export default Order;