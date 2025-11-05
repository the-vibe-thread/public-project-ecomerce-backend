import Order from "../models/order.js";
import User from "../models/user.js";
import Preorder from "../models/preorder.js"; // Import Preorder model
import Product from "../models/product.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { sendToShipCorrect, fetchShipCorrectTracking } from "./shipcorrect.js";
import { uploadBufferToCloudinary } from "../utils/uploadbuffertocloudinary.js";

dotenv.config();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Store Socket.IO instance globally
let io;
export const setSocket = (socketInstance) => {
  io = socketInstance;
};

// Rate limiter for Razorpay Webhook
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
});

// PATCHED placeOrder for COD orders:
export const placeOrder = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Extract order details from request
    const {
      products,
      paymentMethod,
      totalPrice,
      shippingCost,
      name,
      email,
      address,
      pincode,
      deliveryPhone,
    } = req.body;

    // Only allow COD orders here
    if (paymentMethod !== "cod") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "Only Cash on Delivery orders are supported on this endpoint. For prepaid, use Razorpay flow.",
      });
    }

    // Basic validation
    if (!products?.length || !address || !paymentMethod || !totalPrice) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "Missing required order details." });
    }

    const shippingAddress = {
      name,
      address,
      deliveryPhone,
      email,
      postalCode: pincode,
    };

    // Get user
    let user = await User.findById(req.user._id);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "User does not exist. Please sign up before placing an order.",
      });
    }
    const userId = user._id;

    // Check for active preorders and apply discount if applicable
    let orderTotal = totalPrice;
    const preorderPromises = products.map(async (item) => {
      const preorders = await Preorder.find({
        user: userId,
        product: item.productId,
        color: item.color,
        size: item.size,
        status: "pending",
      });
      if (preorders.length > 0) {
        // Use the latest preorder for discount info
        const preorder = preorders[0];
        let discount = 0;
        if (preorder.discountType === "percentage") {
          discount = (item.price * preorder.discountValue) / 100;
        } else if (preorder.discountType === "fixed") {
          discount = preorder.discountValue;
        }
        // Always deduct the ₹100 deposit paid during preorder
        discount += preorder.amountPaid || 100;
        orderTotal -= discount;
        // Mark preorder as completed
        await Preorder.updateMany(
          { _id: { $in: preorders.map((p) => p._id) } },
          { $set: { status: "completed" } }
        );
      }
    });
    await Promise.all(preorderPromises);

    // ---- PATCH: ENRICH PRODUCTS ----
    const enrichedProducts = await Promise.all(
      products.map(async (item) => {
        const prodDoc = await Product.findById(item.productId).lean();
        if (!prodDoc) throw new Error("Product not found: " + item.productId);

        const colorVariant = prodDoc.colors.find((c) => c.name === item.color);
        if (!colorVariant)
          throw new Error(
            `Color ${item.color} not found for product ${prodDoc.name}`
          );

        // sizes might be a Map or plain object
        const sizeDetails = colorVariant.sizes.get
          ? colorVariant.sizes.get(item.size)
          : colorVariant.sizes[item.size];
        if (!sizeDetails)
          throw new Error(
            `Size ${item.size} not found for product ${prodDoc.name}`
          );

        return {
          product: prodDoc._id,
          productId: prodDoc._id.toString(),
          productName: prodDoc.name, // <-- CORRECT FIELD
          slug: prodDoc.slug, // <-- Add this line
          color: item.color,
          size: item.size,
          sku: sizeDetails.sku,
          quantity: item.quantity,
          priceAtOrder: item.price, // or sizeDetails.price if you store per-size price
        };
      })
    );
    // ---- END PATCH ----

    // Create the order
    const order = new Order({
      user: userId,
      products: enrichedProducts, // PATCHED
      shippingAddress,
      paymentMethod,
      totalPrice: orderTotal,
      status: "Pending",
      shippingCost,
      isPaid: false,
    });

    const createdOrder = await order.save({ session });
    await session.commitTransaction();
    session.endSession();

    // --- SHIPCORRECT AUTO-SEND HERE ---
    try {
      if (createdOrder.products.length > 0) {
        const prod = createdOrder.products[0];
        const shipCorrectResponse = await sendToShipCorrect(createdOrder, prod);
        if (shipCorrectResponse && shipCorrectResponse.order_no) {
          createdOrder.shipcorrectOrderNo = shipCorrectResponse.order_no;
          await createdOrder.save();
        }
      }
    } catch (err) {
      console.error("ShipCorrect error:", err.message);
    }
    // ---

    // Emit real-time event if using socket.io
    if (typeof io !== "undefined" && io) {
      io.emit("orderPlaced", createdOrder);
    }

    res.status(201).json({
      success: true,
      message: "Order placed successfully!",
      order: createdOrder,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

// @desc Handle Razorpay Webhook for payment verification
export const handleRazorpayWebhook = [
  webhookLimiter,
  async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
      const signature = req.headers["x-razorpay-signature"];
      const body = JSON.stringify(req.body);

      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(body)
        .digest("hex");
      if (signature !== expectedSignature) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid webhook signature." });
      }

      const { order_id, payment_id, amount } = req.body.payload.payment.entity;
      const order = await Order.findOne({ razorpayOrderId: order_id });
      if (!order) {
        return res
          .status(404)
          .json({ success: false, message: "Order not found for payment." });
      }

      if (order.totalPrice * 100 !== amount) {
        return res
          .status(400)
          .json({ success: false, message: "Payment amount mismatch." });
      }
      if (order.isPaid) {
        return res
          .status(200)
          .json({ success: true, message: "Order already paid." });
      }

      order.isPaid = true;
      order.paidAt = new Date();
      order.paymentStatus = "Paid";
      order.razorpayPaymentId = payment_id;
      order.paymentDetails = req.body.payload.payment.entity; // ✅ Add this here
      await order.save({ session });

      // Emit event when order is paid
      io.emit("orderPaid", order);

      await session.commitTransaction();
      session.endSession();
      res
        .status(200)
        .json({ success: true, message: "Payment verified via webhook." });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      next(error);
    }
  },
];

// @desc Get all orders (Admin) with pagination & filtering
export const getOrders = async (req, res, next) => {
  try {
    if (!req.user.isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Access denied." });
    }

    const { status, page = 1 } = req.query;
    const limit = 10;
    const filter = status ? { status } : {};

    const [orders, totalOrders] = await Promise.all([
      Order.find(filter)
        .populate("user", "name email")
        .populate("lastUpdatedBy", "name email") // ✅ Add this
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    res.json({ success: true, orders, totalOrders });
  } catch (error) {
    next(error);
  }
};

// @desc Update order status (Admin)
export const updateOrderStatus = async (req, res, next) => {
  try {
    if (!req.user.isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Access denied." });
    }

    const { status, shippedFrom, trackingNumber, shippingCarrier } = req.body;
    const validStatuses = [
      "Pending",
      "Processing",
      "Shipped",
      "Delivered",
      "Cancelled",
    ];

    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid order status" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const oldStatus = order.status; // Store old status before update

    // ✅ Update status
    order.status = status;

    // ✅ Set admin who performed the update
    order.lastUpdatedBy = req.user.id;

    // ✅ Add shipping details when marking as "Shipped"
    if (status === "Shipped") {
      if (!shippedFrom || !trackingNumber || !shippingCarrier) {
        return res.status(400).json({
          success: false,
          message:
            "Shipped status requires shippedFrom, trackingNumber, and shippingCarrier.",
        });
      }
      order.shippedFrom = shippedFrom;
      order.trackingNumber = trackingNumber;
      order.shippingCarrier = shippingCarrier;
    }

    // ✅ Update delivery date when marking as "Delivered"
    if (status === "Delivered") {
      order.deliveredAt = new Date();
    }

    // ✅ Clear tracking details if order is cancelled
    if (status === "Cancelled") {
      order.shippedFrom = null;
      order.trackingNumber = null;
      order.shippingCarrier = null;
    }

    await order.save();

    // Emit event only if status has changed
    if (oldStatus !== order.status) {
      io.emit("orderUpdated", order);
    }

    res.json({ success: true, message: "Order status updated", order });
  } catch (error) {
    next(error);
  }
};
export const confirmDelivery = async (req, res, next) => {
  try {
    const order = await Order.findOne({
      orderId: req.params.id,
      user: req.user.id,
    });

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (order.status !== "Shipped") {
      return res.status(400).json({
        success: false,
        message: "Order must be shipped before marking as delivered.",
      });
    }

    order.status = "Delivered";
    order.deliveredAt = new Date();
    await order.save();

    // Emit real-time update
    io.emit("orderUpdated", order);

    res.json({ success: true, message: "Order marked as delivered", order });
  } catch (error) {
    next(error);
  }
};

export const requestReturn = async (req, res) => {
  try {
    const { orderId, productId } = req.params;
    const {
      returnIssueType,
      returnIssueDesc,
      returnResolutionType,
      selectedColor,
      selectedSize,
    } = req.body; // <-- read these

    if (!returnIssueType || !returnIssueDesc || !returnResolutionType) {
      return res.status(400).json({
        message: "Issue type, description, and resolution are required.",
      });
    }
    if (!req.files || req.files.length === 0) {
      return res
        .status(400)
        .json({ message: "At least one image is required." });
    }

    // Cloudinary upload block goes here
    const returnImages = [];
    for (const file of req.files) {
      const url = await uploadBufferToCloudinary(
        file.buffer,
        file.originalname
      );
      returnImages.push(url);
    }

    // Now, continue with your DB logic
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (productId) {
      // Single product return
      const product = order.products.find(
        (p) => p.productId === productId || p.product.toString() === productId
      );
      if (!product)
        return res.status(404).json({ message: "Product not found in order" });
      if (product.status !== "Delivered")
        return res
          .status(400)
          .json({ message: "Product not eligible for return" });

      product.status = "Return Requested";
      product.returnIssueType = returnIssueType;
      product.returnIssueDesc = returnIssueDesc;
      product.returnResolutionType = returnResolutionType;
      product.returnImages = returnImages;

      // PATCH: Save the exchange request color/size
      if (returnResolutionType === "Replacement") {
        product.exchangeToColor = selectedColor;
        product.exchangeToSize = selectedSize;
      }

      if (order.products.every((p) => p.status === "Return Requested"))
        order.status = "Return Requested";
    } else {
      // Entire order return
      order.status = "Return Requested";
      order.products.forEach((p) => {
        if (p.status === "Delivered") {
          p.status = "Return Requested";
          p.returnIssueType = returnIssueType;
          p.returnIssueDesc = returnIssueDesc;
          p.returnResolutionType = returnResolutionType;
          p.returnImages = returnImages;

          if (returnResolutionType === "Replacement") {
            p.exchangeToColor = selectedColor;
            p.exchangeToSize = selectedSize;
          }
        }
      });
    }

    await order.save();
    res.json({ message: "Return request submitted" });
  } catch (error) {
    console.error("Return request error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
// Cancel return for single product
export const cancelReturnProduct = async (req, res) => {
  try {
    const { orderId, productId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const product = order.products.find(
      (p) => p.productId === productId || p.product.toString() === productId
    );
    if (!product)
      return res.status(404).json({ message: "Product not found in order" });
    if (product.status !== "Return Requested")
      return res
        .status(400)
        .json({ message: "No return requested for this product" });

    product.status = "Delivered";
    // If any product is not 'Return Requested', set order status back to Delivered.
    if (order.products.some((p) => p.status !== "Return Requested"))
      order.status = "Delivered";
    await order.save();
    // Optional: io.emit("productReturnCancelled", { orderId, productId });
    res.json({ message: "Return request cancelled for product" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

// Cancel return for entire order
export const cancelReturnOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.status !== "Return Requested")
      return res
        .status(400)
        .json({ message: "No return requested for this order" });

    order.status = "Delivered";
    order.products.forEach((p) => {
      if (p.status === "Return Requested") p.status = "Delivered";
    });
    await order.save();
    // Optional: io.emit("orderReturnCancelled", order);
    res.json({ message: "Return request cancelled for order" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};
// @desc Track all active orders by user (requires login)
export const trackOrder = async (req, res) => {
  try {
    // Must be logged in
    if (!req.user || !req.user.id) {
      return res
        .status(401)
        .json({ message: "Login required to track orders." });
    }

    // Fetch orders for this user (excluding completed/returned)
    const orders = await Order.find({
      user: req.user.id,
      status: { $nin: ["Delivered", "Returned", "Return Requested"] },
    })
      .sort({ createdAt: -1 })
      .populate(
        "products.product",
        "name title brand colors" // no need to select image/images, we use colors
      )
      .lean();

    if (!orders || orders.length === 0) {
      return res
        .status(404)
        .json({ message: "No active order found for this user." });
    }

    res.json({
      orders: orders.map((order) => ({
        _id: order._id,
        orderId: order.orderId,
        status: order.status,
        createdAt: order.createdAt,
        totalPrice: order.totalPrice,
        items: order.products?.map((p) => {
          const prod = p.product || {};
          const mainColor =
            Array.isArray(prod.colors) && prod.colors.length > 0
              ? prod.colors[0]
              : {};

          return {
            name: prod.name || prod.title || prod._id,
            quantity: p.quantity,
            color: p.color || mainColor.name || null,
            size: p.size || null,
            // Pick best image source available
            image:
              mainColor.icon ||
              (Array.isArray(mainColor.images) && mainColor.images.length > 0
                ? mainColor.images[0]
                : "/images/placeholder.png"),
            // All available images
            images:
              Array.isArray(mainColor.images) && mainColor.images.length > 0
                ? mainColor.images
                : [],
            brand: prod.brand || null,
          };
        }),
        shippingAddress: order.shippingAddress,
        trackingNumber: order.trackingNumber,
        shippingCarrier: order.shippingCarrier,
        deliveredAt: order.deliveredAt,
        shipcorrectOrderNo: order.shipcorrectOrderNo || null,
      })),
    });
  } catch (err) {
    console.error("Error in trackOrder:", err);
    res.status(500).json({ message: "Server error." });
  }
};
export const getMyOrders = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const productName = req.query.product?.trim()?.toLowerCase();
    const orderIdQuery = req.query.orderId?.trim()?.toLowerCase();

    // Fetch orders for the user
    let orders = await Order.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate("products.product", "name slug colors")
      .lean();

    // Filter by product name
    if (productName) {
      orders = orders.filter((order) =>
        order.products.some(
          (item) =>
            item.product &&
            (item.product.name?.toLowerCase().includes(productName) ||
              item.product.slug?.toLowerCase().includes(productName))
        )
      );
    }

    // Filter by order ID
    if (orderIdQuery) {
      orders = orders.filter(
        (order) =>
          order.orderId?.toLowerCase().includes(orderIdQuery) ||
          order._id?.toString().toLowerCase().includes(orderIdQuery)
      );
    }

    const totalOrders = orders.length;
    const pagedOrders = orders.slice((page - 1) * limit, page * limit);

    // Defensive mapping: add image from colors array if present
    const ordersWithSafeProducts = pagedOrders.map((order) => ({
      ...order,
      products: order.products.map((item) => {
        const productData = item.product;
        let image = null;
        if (
          productData &&
          Array.isArray(productData.colors) &&
          productData.colors.length > 0
        ) {
          const color = productData.colors[0];
          image =
            color.images && color.images.length > 0
              ? color.images[0]
              : color.icon || null;
        }
        return {
          ...item,
          product: {
            ...productData,
            image,
          },
        };
      }),
    }));

    res.json({
      orders: ordersWithSafeProducts,
      totalOrders,
      page,
      pages: Math.ceil(totalOrders / limit),
    });
  } catch (error) {
    console.error("[getMyOrders error]", error);
    res.status(500).json({ message: "Server error" });
  }
};
export const verifyPayment = async (req, res) => {
  try {
    const { orderId, paymentId, razorpaySignature } = req.body;
    const order = await Order.findById(orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const generated_signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(order.razorpayOrderId + "|" + paymentId)
      .digest("hex");

    if (generated_signature !== razorpaySignature) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment signature" });
    }

    order.isPaid = true;
    order.paidAt = new Date();
    order.paymentStatus = "Paid";
    order.razorpayPaymentId = paymentId;
    order.razorpaySignature = razorpaySignature;
    await order.save();

    // Optionally emit socket event
    if (typeof io !== "undefined") io.emit("orderPaid", order);

    return res.json({ success: true, message: "Payment verified", order });
  } catch (error) {
    console.error("Payment verification error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Validate order, check courier, and only then create Razorpay order (DO NOT save DB order yet)
export const validateAndInitiatePrepaidOrder = async (req, res) => {
  try {
    const {
      products,
      totalPrice,
      shippingCost,
      name,
      email,
      address,
      pincode,
      deliveryPhone,
      city,
      state,
      giftWrap,
    } = req.body;
    // 1. Validate input
    if (
      !products?.length ||
      !address ||
      !totalPrice ||
      !name ||
      !email ||
      !pincode
    )
      return res
        .status(400)
        .json({ success: false, message: "Missing required order details." });

    // 2. Validate products exist and stock if needed
    for (let item of products) {
      const prodDoc = await Product.findById(item.productId).lean();
      if (!prodDoc)
        return res.status(400).json({
          success: false,
          message: `Product not found: ${item.productId}`,
        });
      const colorVariant = prodDoc.colors.find((c) => c.name === item.color);
      if (!colorVariant)
        return res.status(400).json({
          success: false,
          message: `Color ${item.color} not found for product ${prodDoc.name}`,
        });
      const sizeDetails = colorVariant.sizes.get
        ? colorVariant.sizes.get(item.size)
        : colorVariant.sizes[item.size];
      if (!sizeDetails)
        return res.status(400).json({
          success: false,
          message: `Size ${item.size} not found for product ${prodDoc.name}`,
        });
      // Optionally, check stock here
      // if (sizeDetails.stock < item.quantity) return res.status(400).json({ ... });
    }

    // 3. Send to courier/ShipCorrect (call your existing sendToShipCorrect, but don't save DB order yet)
    const fakeOrder = {
      user: "preview", // just for ShipCorrect, not in DB
      products,
      shippingAddress: {
        name,
        address,
        deliveryPhone,
        email,
        postalCode: pincode,
        city,
        state,
      },
      paymentMethod: "razorpay",
      totalPrice,
      shippingCost,
      giftWrap,
      isPaid: false,
      status: "Pending",
    };
    const courierResp = await sendToShipCorrect(fakeOrder, products[0]);
    if (!courierResp || courierResp.error)
      return res.status(400).json({
        success: false,
        message:
          "Shipping not possible: " + (courierResp.error || "Unknown error"),
      });

    // 4. Create the Razorpay payment intent/order
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(totalPrice * 100),
      currency: "INR",
      receipt: `prepaid_rcptid_${Date.now()}`,
      payment_capture: 1,
      notes: { userEmail: email, userName: name },
    });

    // 5. Return Razorpay order info and courier preview to frontend
    res.json({
      success: true,
      razorpayOrderId: razorpayOrder.id,
      courierStatus: courierResp.status,
      courierOrderNo: courierResp.order_no,
      courierRaw: courierResp,
    });
  } catch (error) {
    console.error("validateAndInitiatePrepaidOrder error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// 1. Create Razorpay Order (for payment intent, NOT DB order)
/*export const createRazorpayOrder = async (req, res) => {
  try {
    const { amount, name, email } = req.body;
    if (!amount || !name || !email) {
      return res.status(400).json({
        success: false,
        message: "Missing payment initiation details.",
      });
    }
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `order_rcptid_${Date.now()}`,
      payment_capture: 1,
      notes: { userEmail: email, userName: name },
    });
    res.json({ success: true, razorpayOrderId: razorpayOrder.id });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Failed to create Razorpay order" });
  }
};}*/

// 2. After payment, verify and create order in DB (with preorder logic)
export const verifyAndCreateOrder = async (req, res) => {
  console.log("==== [verifyAndCreateOrder] Called ====");
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      orderDetails,
    } = req.body;

    console.log("Received body:", {
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      orderDetails,
    });

    // Validate payment
    if (
      !razorpayOrderId ||
      !razorpayPaymentId ||
      !razorpaySignature ||
      !orderDetails
    ) {
      console.log("[Error] Missing payment/order details");
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "Missing payment/order details" });
    }

    const generated_signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpayOrderId + "|" + razorpayPaymentId)
      .digest("hex");
    console.log("Generated signature:", generated_signature);
    console.log("Provided signature:", razorpaySignature);

    if (generated_signature !== razorpaySignature) {
      console.log("[Error] Invalid payment signature");
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "Invalid payment signature" });
    }

    // Get user from authenticated request
    console.log("Request user:", req.user);
    const user = await User.findById(req.user._id);
    if (!user) {
      console.log("[Error] User not found with id:", req.user._id);
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "User not found." });
    }

    // Destructure order details (NO userId!)
    const {
      products,
      totalPrice,
      shippingMethod,
      shippingCost,
      name,
      email,
      address,
      pincode,
      deliveryPhone,
      city,
      state,
      giftWrap,
    } = orderDetails;

    console.log("Order details destructured:", {
      products,
      totalPrice,
      shippingMethod,
      shippingCost,
      name,
      email,
      address,
      pincode,
      deliveryPhone,
      city,
      state,
      giftWrap,
    });

    if (!products?.length || !address || !totalPrice) {
      console.log("[Error] Missing required order details.");
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: "Missing required order details." });
    }

    // Preorder logic: apply discounts, mark preorders complete
    let orderTotal = totalPrice;
    const preorderPromises = products.map(async (item) => {
      console.log("Checking preorders for item:", item);
      const preorders = await Preorder.find({
        user: req.user._id,
        product: item.productId,
        color: item.color,
        size: item.size,
        status: "pending",
      });
      console.log(
        `Found ${preorders.length} preorders for productId:`,
        item.productId
      );
      if (preorders.length > 0) {
        const preorder = preorders[0];
        let discount = 0;
        if (preorder.discountType === "percentage") {
          discount = (item.price * preorder.discountValue) / 100;
        } else if (preorder.discountType === "fixed") {
          discount = preorder.discountValue;
        }
        discount += preorder.amountPaid || 100;
        orderTotal -= discount;
        console.log(
          `Applied preorder discount: ${discount}, new orderTotal: ${orderTotal}`
        );
        // Mark preorders as completed
        await Preorder.updateMany(
          { _id: { $in: preorders.map((p) => p._id) } },
          { $set: { status: "completed" } },
          { session }
        );
        console.log("Marked preorders as completed.");
      }
    });
    await Promise.all(preorderPromises);

    // Shipping address structure
    const shippingAddress = {
      name,
      address,
      deliveryPhone,
      email,
      postalCode: pincode,
      city,
      state,
    };

    // --- PATCH: ENRICH PRODUCTS ---
    const enrichedProducts = await Promise.all(
      products.map(async (item) => {
        console.log("Enriching product item:", item);
        const prodDoc = await Product.findById(item.productId).lean();
        if (!prodDoc) throw new Error("Product not found: " + item.productId);

        if (!item.color || typeof item.color !== "string") {
          throw new Error(`No color passed for productId: ${item.productId}`);
        }

        if (!Array.isArray(prodDoc.colors)) {
          throw new Error(
            `Product ${prodDoc.name} has no color variants in DB`
          );
        }

        console.log(
          "Product colors in DB:",
          prodDoc.colors.map((c) => c.name)
        );
        console.log("Requested color from frontend:", item.color);

        const colorVariant = prodDoc.colors.find(
          (c) =>
            c.name &&
            c.name.trim().toLowerCase() === item.color.trim().toLowerCase()
        );

        console.log("Color variant found:", colorVariant);

        if (!colorVariant)
          throw new Error(
            `Color '${item.color}' not found for product '${
              prodDoc.name
            }'. Available: ${prodDoc.colors.map((c) => c.name).join(", ")}`
          );

        const sizeKey = (item.size || "").trim();
        const sizeDetails = colorVariant.sizes.get
          ? colorVariant.sizes.get(sizeKey)
          : colorVariant.sizes[sizeKey];

        if (!sizeDetails)
          throw new Error(
            `Size '${item.size}' not found for color '${item.color}' in product '${prodDoc.name}'.`
          );

        return {
          product: prodDoc._id,
          productId: prodDoc._id.toString(),
          productName: prodDoc.name,
          color: item.color,
          slug: prodDoc.slug,
          size: item.size,
          sku: sizeDetails.sku,
          quantity: item.quantity,
          priceAtOrder: item.price,
        };
      })
    );
    // --- END PATCH ---

    // Create DB order (now that payment is verified and discounts applied)
    const order = new Order({
      user: req.user._id,
      products: enrichedProducts,
      shippingAddress,
      paymentMethod: "razorpay",
      totalPrice: orderTotal,
      status: "Pending",
      shippingCost,
      isPaid: true,
      paidAt: new Date(),
      paymentStatus: "Paid",
      razorpayOrderId,
      razorpayPaymentId,
      giftWrap,
    });

    console.log("Saving order to DB:", order);

    const createdOrder = await order.save({ session });
    console.log("Order saved successfully:", createdOrder);

    await session.commitTransaction();
    session.endSession();

    // --- SHIPCORRECT AUTO-SEND HERE ---
    try {
      if (createdOrder.products.length > 0) {
        const prod = createdOrder.products[0];
        const shipCorrectResponse = await sendToShipCorrect(createdOrder, prod);
        if (shipCorrectResponse && shipCorrectResponse.order_no) {
          createdOrder.shipcorrectOrderNo = shipCorrectResponse.order_no;
          await createdOrder.save();
        }
      }
    } catch (err) {
      console.error("ShipCorrect error:", err.message);
    }
    // ---

    res.status(201).json({
      success: true,
      message: "Prepaid order placed successfully!",
      order: createdOrder,
    });
  } catch (error) {
    console.log("[Catch/Error] verifyAndCreateOrder:", error);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({
      success: false,
      message: "Payment/order failed",
      error: error.message,
    });
  }
};

// order cancel
export const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Only allow cancel if Pending, Processing, Shipped
    if (!["Pending", "Processing", "Shipped"].includes(order.status)) {
      return res
        .status(400)
        .json({ message: "Order cannot be cancelled at this stage." });
    }

    order.status = "Cancelled";
    order.cancelledAt = new Date();
    await order.save();

    res.json({ message: "Order cancelled." });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export const checkRefundStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    // Let's assume order.refundStatus is one of "Pending", "Processed", "Rejected"
    res.json({
      refundStatus: order.refundStatus || "Not Requested",
      refundedAmount: order.refundedAmount || 0,
      refundTransactionId: order.refundTransactionId || "",
      refundDate: order.refundDate || null,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

export const getShipcorrectTracking = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order || !order.orderId) {
      return res
        .status(404)
        .json({ message: "Order or ShipCorrect tracking not found." });
    }
    const trackingData = await fetchShipCorrectTracking(order.orderId);

    // Find the latest scan stage
    let latestScan =
      trackingData?.scan_stages?.[0]?.status || trackingData?.tracking_status;

    // Map scan stage to display status
    let displayStatus;
    switch (latestScan) {
      case "Delivered":
        displayStatus = "Delivered";
        break;
      case "Out For Delivery":
        displayStatus = "Out For Delivery";
        break;
      case "In Transit":
        displayStatus = "In Transit";
        break;
      default:
        displayStatus = order.status || "Pending";
    }

    // Optionally update order.status in DB as well (if you want)
    if (
      order.status !== displayStatus &&
      ["Delivered", "Out For Delivery", "In Transit"].includes(displayStatus)
    ) {
      order.status = displayStatus;
      if (displayStatus === "Delivered") {
        order.deliveredAt = new Date();
      }
      await order.save();
      if (typeof io !== "undefined" && io) {
        io.emit("orderUpdated", order);
      }
    }

    return res.json({
      tracking: trackingData,
      orderStatus: order.status,
      displayStatus,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch ShipCorrect tracking info." });
  }
};
