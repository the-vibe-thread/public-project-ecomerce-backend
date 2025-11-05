import express from "express";
import Order from "../models/order.js";
import uploadReturnImages from "../middleware/returnImageUpload.js";
import {
  placeOrder,
  getOrders,
  updateOrderStatus,
  handleRazorpayWebhook,
  confirmDelivery,
  requestReturn,
  checkRefundStatus,
  trackOrder,
  getMyOrders,
  verifyPayment,
  verifyAndCreateOrder,
  //createRazorpayOrder,
  // 👇 Add these imports for new features
  cancelReturnOrder,
  cancelReturnProduct,
  cancelOrder,
  getShipcorrectTracking,
  validateAndInitiatePrepaidOrder
} from "../controllers/OrderController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// 📌 Place a new order (User)
router.post("/create", protect, placeOrder);

// 📌 Get all orders (Admin)
router.get("/", protect, admin, getOrders);

// 📌 Update order status (Admin)
router.put("/:id/status", protect, admin, updateOrderStatus);

// 📌 Handle Razorpay webhook
router.post("/webhook", handleRazorpayWebhook);

router.put("/:id/confirm-delivery", protect, confirmDelivery);
// For entire order return request
router.post(
  "/:orderId/return",
  protect,
  uploadReturnImages.array("returnImages", 5), // "returnImages" is the field name in the frontend form
  requestReturn
);

// For single product return request
router.post(
  "/:orderId/return/:productId",
  protect,
  uploadReturnImages.array("returnImages", 5),
  requestReturn
);

// User cancels a return request for an order (entire order)
router.post("/:orderId/cancel-return", protect, cancelReturnOrder);

// User cancels a return request for a single product in order
router.post("/:orderId/cancel-return/:productId", protect, cancelReturnProduct);

// User checks refund status
router.get("/:orderId/refund-status", protect, checkRefundStatus);

// Public route for tracking order by orderId and (optionally) phone/email
router.get("/track", protect, trackOrder);

router.get("/myorders", protect, getMyOrders);

router.post("/verify-payment", protect, verifyPayment);

// Razorpay Prepaid Flow
{/*router.post("/create-razorpay-order", protect, createRazorpayOrder);*/}

router.post("/verify-and-create", protect, verifyAndCreateOrder);

// ✅ New: Get single order details (Customer only)
router.get("/:id", protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate({
        path: "products.productId",
        select: "name colors",
      })
      .populate("user", "name email");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const formattedOrder = {
      ...order.toObject(),
      products: order.products.map((p) => ({
        ...p.toObject(),
        productId: {
          _id: p.productId?._id,
          name: p.productId?.name,
          mainImage: p.productId?.colors?.[0]?.images?.[0] || null,
          allImages: p.productId?.colors?.[0]?.images || [],
        },
      })),
    };

    res.json(formattedOrder);
  } catch (err) {
    console.error("Error fetching order:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// order cancel
// Cancel order by user (PUT to status endpoint)
router.put("/:id/status", protect, cancelOrder)

router.get("/:id/shipcorrect-tracking", protect, getShipcorrectTracking);

router.post('/prepaid/validate-and-initiate',protect, validateAndInitiatePrepaidOrder);

export default router;