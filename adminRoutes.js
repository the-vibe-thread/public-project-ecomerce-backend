import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import Order from "../models/order.js";

import {
  adminLogin,
  createAdmin,
  getOrders,
  getUsers,
  updateOrderStatus,
  getAnalytics,
  updateAdminProfile,
  adminLogout,
  verifyAdminAuth,
  deleteUser,
  updateReturnStatus,
  getReturnRequests,
  processRefund,
} from "../controllers/adminController.js";
import { protectAdmin, superAdminOnly } from "../middleware/authMiddleware.js";
import { updateStockFromCSV } from "../controllers/adminController.js";

const router = express.Router();

// @desc    Admin Login
// @route   POST /api/admin/login
router.post("/login", adminLogin);

// @desc    Create New Admin (Super Admin Only)
// @route   POST /api/admin/create
router.post("/create", protectAdmin, superAdminOnly, createAdmin);

// @desc    Get All Orders (Admin Only)
// @route   GET /api/admin/orders
router.get("/orders", protectAdmin, getOrders);

// @desc    Get All Users (Admin Only)
// @route   GET /api/admin/users
router.get("/users", protectAdmin, getUsers);

// @desc    Update Order Status (Admin Only)
// @route   PUT /api/admin/orders/:id/status
router.put("/orders/:id/status", protectAdmin, updateOrderStatus);

// @desc    Get Admin Analytics
// @route   GET /api/admin/analytics/:type?
router.get("/analytics/:type?", protectAdmin, getAnalytics);

// @desc    Get Admin Profile (Fetch Admin Details)
// @route   GET /api/admin/profile
router.get("/profile", protectAdmin, (req, res) => {
  res.json({ email: req.admin.email });
});

// @desc    Update Admin Profile (Email & Password)
// @route   PUT /api/admin/update-profile
router.put("/update-profile", protectAdmin, updateAdminProfile);

// @desc    Check if Admin is Authenticated
// @route   GET /api/admin/check-auth
router.get("/check-auth", protectAdmin, verifyAdminAuth, (req, res) => {
  res.json({ isAuthenticated: true, admin: req.admin });
});

// @desc    Admin Logout
// @route   POST /api/admin/logout
router.post("/logout", protectAdmin, adminLogout);

// Admin approves return request
router.put("/returns/:orderId/:productId", protectAdmin, updateReturnStatus);

router.delete("/users/:id", protectAdmin, deleteUser); // DELETE - Delete user by ID

router.post(
  "/upload-stock",
  upload.single("file"),
  protectAdmin,
  updateStockFromCSV
);

router.get("/returns", protectAdmin, getReturnRequests);

router.get("/:id", protectAdmin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("user", "name email")
      .populate({
        path: "products.product",
        select: "name colors images slug", // add or remove fields as needed
      });

    if (!order) return res.status(404).json({ message: "Order not found" });

    const items = order.products.map((p) => {
      const productDoc = p.product;
      return {
        productId: productDoc?._id?.toString() || p.productId?.toString() || "",
        name: productDoc?.name || "",
        images: productDoc?.images || [],
        color: p.color || "",
        size: p.size || "",
        quantity: p.quantity,
        price: p.priceAtOrder || p.price,
        sku: (() => {
          if (productDoc?.colors && p.color && p.size) {
            const colorObj = productDoc.colors.find((c) => c.name === p.color);
            if (colorObj && colorObj.sizes && colorObj.sizes[p.size]) {
              return colorObj.sizes[p.size].sku;
            }
          }
          return p.sku || "";
        })(),
        // Return info for this product (even if not returned)
        returnStatus: p.status, // e.g. "Return Requested", "Return Approved", etc.
        returnDetails: {
          reason: p.returnIssueType,
          issue: p.returnIssueDesc,
          resolution: p.returnResolutionType,
          images: p.returnImages || [],
          pickupStatus: p.pickupStatus,
          refundAmount: p.refundAmount,
          refundDate: p.refundDate,
        },
        replacementOrderId: p.replacementOrderId,
      };
    });

    res.json({
      _id: order._id,
      customer: order.shippingAddress?.name || order.user?.name || "",
      status: order.status,
      paymentStatus: order.isPaid ? "Paid" : "Unpaid",
      paymentMethod: order.paymentMethod || "",
      totalAmount: order.totalPrice,
      items,
      shippedFrom: order.shippedFrom || "",
      trackingNumber: order.trackingNumber || "",
      shippingCarrier: order.shippingCarrier || "",
    });
  } catch (err) {
    console.error("Error fetching admin order:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Add after return handling routes, with protect and admin middleware
router.put(
  "/returns/:orderId/:productId/pickup",
  protectAdmin,
  async (req, res) => {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    const product = order.products.find(
      (p) =>
        p.productId === req.params.productId ||
        p.product.toString() === req.params.productId
    );
    if (!product)
      return res.status(404).json({ message: "Product not found in order" });

    product.pickupStatus = "Picked Up";
    await order.save();
    res.json({ message: "Pickup marked as done", order });
  }
);

// Bulk or single product replacement/exchange
router.post("/returns/:orderId/replacement", protectAdmin, async (req, res) => {
  // Accepts: [{productId, size, color}] in req.body.products
  const { products } = req.body;
  const order = await Order.findById(req.params.orderId);
  if (!order) return res.status(404).json({ message: "Order not found" });

  const newOrderProducts = [];
  products.forEach(({ productId, size, color }) => {
    const product = order.products.find(
      (p) => p.productId === productId || p.product.toString() === productId
    );
    if (!product) return; // skip if not found
    // Mark replacement/exchange details in original order
    product.exchangeToSize = size;
    product.exchangeToColor = color;
    product.status = "Returned"; // after pickup and replacement creation

    newOrderProducts.push({
      product: product.product,
      productId: product.productId,
      quantity: product.quantity,
      priceAtOrder: 0, // free replacement
      color,
      size,
      status: "Pending",
    });
  });

  // Create new order
  const replacementOrder = new Order({
    user: order.user,
    products: newOrderProducts,
    shippingAddress: order.shippingAddress,
    paymentMethod: "replacement",
    totalPrice: 0,
    status: "Pending",
  });
  await replacementOrder.save();

  // Link replacementOrderId in original order's products
  newOrderProducts.forEach((item) => {
    const origProd = order.products.find(
      (p) =>
        p.productId === item.productId ||
        p.product.toString() === item.productId
    );
    if (origProd) origProd.replacementOrderId = replacementOrder.orderId;
  });

  await order.save();

  res.json({
    message: "Replacement order created",
    replacementOrder,
    order,
  });
});

// Process refund for a returned product
router.post("/orders/:orderId/:productId/refund", protectAdmin, processRefund);

export default router;
