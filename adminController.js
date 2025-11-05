import User from "../models/user.js";
import Order from "../models/order.js";
import Product from "../models/product.js";
import Admin from "../models/admin.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import csv from "csv-parser";
import fs from "fs";
// Add at the top
import Razorpay from "razorpay";
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Admin Login
export const adminLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    let admin = await Admin.findOne({ email }).select("+password");

    // Hardcoded Admin Login (for emergency use)
    if (
      !admin &&
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      admin = { email, isAdmin: true, _id: "envAdmin" };
    }

    if (!admin) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Ensure admin has a password before comparing
    if (admin.password) {
      const isMatch = await bcrypt.compare(password, admin.password);
      if (!isMatch)
        return res.status(401).json({ message: "Invalid credentials" });
    } else if (admin._id !== "envAdmin") {
      return res.status(500).json({
        message: "Admin account is missing a password. Please reset.",
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: admin._id, isAdmin: true, role: admin.role || "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("adminToken", token, {
      httpOnly: true,
      secure: true, // Set to true if using HTTPS
      sameSite: "None", // Adjust based on your needs
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({ success: true, message: "Admin logged in successfully", token });
  } catch (error) {
    console.error("Admin Login Error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// Create New Admin
export const createAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin)
      return res.status(400).json({ message: "Admin already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newAdmin = new Admin({
      email,
      password: hashedPassword,
      isAdmin: true,
    });
    await newAdmin.save();

    res.status(201).json({ message: "Admin created successfully" });
  } catch (error) {
    console.error("Create Admin Error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// Get All Orders
export const getOrders = async (req, res) => {
  try {
    const orders = await Order.find().populate("user", "name").lean();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// Get All Users
export const getUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password").lean();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// Order Status Update with Logical Transitions
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validTransitions = {
      Pending: ["Shipped", "Cancelled"],
      Shipped: ["Delivered", "Cancelled"],
      Delivered: [],
      Cancelled: [],
    };

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    if (!validTransitions[order.status].includes(status)) {
      return res.status(400).json({
        message: `Cannot change order status from ${order.status} to ${status}`,
      });
    }

    order.status = status;
    await order.save();

    res.json({ message: "Order status updated successfully", order });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// Utility for building match filter from query
const buildMatch = (type, query) => {
  const match = {};
  // Date range (all types)
  if (query.dateFrom || query.dateTo) match.createdAt = {};
  if (query.dateFrom) match.createdAt.$gte = new Date(query.dateFrom);
  if (query.dateTo) match.createdAt.$lte = new Date(query.dateTo);

  if (type === "sales" || type === "orders") {
    // Product filter
    if (query.productId)
      match["products.productId"] = mongoose.Types.ObjectId(query.productId);
    // Status filter (orders)
    if (type === "orders" && query.status) match.status = query.status;
  }
  if (type === "sales" || type === "orders" || type === "revenue") {
    // User filter by email
    if (query.userEmail) match.user = { $in: [] }; // filled below
  }
  return match;
};

// Get Analytics Data (FULLY UPDATED FOR DASHBOARD)
export const getAnalytics = async (req, res) => {
  try {
    const { type } = req.params;
    const q = req.query;

    if (!type) {
      // Existing stats
      const totalUsers = await User.countDocuments();
      const totalOrders = await Order.countDocuments();
      const revenueData = await Order.aggregate([
        { $group: { _id: null, totalRevenue: { $sum: "$totalPrice" } } },
      ]);
      const totalProducts = await Product.countDocuments();

      // NEW: Order status breakdown
      const completed = await Order.countDocuments({ status: "Delivered" });
      const pending = await Order.countDocuments({ status: "Pending" });
      const shipped = await Order.countDocuments({ status: "Shipped" });
      const canceled = await Order.countDocuments({ status: "Cancelled" });

      // Arrays for download functionality
      const sales = await Order.aggregate([
        {
          $group: {
            _id: { $month: "$createdAt" },
            sales: { $sum: { $size: "$products" } },
            users: { $addToSet: "$user" },
          },
        },
        {
          $project: {
            month: "$_id",
            sales: 1,
            users: { $size: "$users" },
          },
        },
        { $sort: { month: 1 } },
      ]);
      const products = await Product.find().select("name").lean();
      const ordersArr = await Order.find().lean();
      const usersArr = await User.find().select("-password").lean();
      const revenue = await Order.aggregate([
        {
          $group: {
            _id: { $month: "$createdAt" },
            revenue: { $sum: "$totalPrice" },
          },
        },
        {
          $project: {
            month: "$_id",
            revenue: 1,
          },
        },
        { $sort: { month: 1 } },
      ]);

      return res.json({
        totalUsers,
        totalOrders,
        totalRevenue: revenueData.length ? revenueData[0].totalRevenue : 0,
        totalProducts,
        orders: {
          completed,
          pending,
          shipped,
          canceled,
        },
        sales,
        products,
        ordersArr,
        usersArr,
        revenue,
      });
    }
    // USERS
    if (type === "users") {
      // Filter by email, name, date range
      const filter = {};
      if (q.email) filter.email = new RegExp(q.email, "i");
      if (q.name) filter.name = new RegExp(q.name, "i");
      if (q.dateFrom || q.dateTo) filter.createdAt = {};
      if (q.dateFrom) filter.createdAt.$gte = new Date(q.dateFrom);
      if (q.dateTo) filter.createdAt.$lte = new Date(q.dateTo);

      const usersArr = await User.find(filter).select("-password").lean();
      return res.json({ usersArr });
    }

    // ORDERS
    if (type === "orders") {
      const match = buildMatch("orders", q);
      if (q.userEmail) {
        const users = await User.find({
          email: new RegExp(q.userEmail, "i"),
        }).select("_id");
        match.user = { $in: users.map((u) => u._id) };
      }
      const ordersArr = await Order.find(match)
        .populate("user", "name email")
        .populate("products.productId", "name")
        .lean();

      // Flatten each product line for detailed analysis
      const flatOrders = [];
      ordersArr.forEach((order) => {
        order.products.forEach((prod) => {
          flatOrders.push({
            orderId: order._id,
            orderDate: order.createdAt,
            userName: order.user?.name || "",
            userEmail: order.user?.email || "",
            productId: prod.productId?._id || prod.productId,
            productName: prod.productId?.name || "",
            quantity: prod.quantity,
            price: prod.price,
            total: prod.quantity * prod.price,
            status: order.status,
            paymentMethod: order.paymentMethod,
            shippingAddress: order.shippingAddress || "",
          });
        });
      });

      return res.json({ ordersArr: flatOrders });
    }

    // DETAILED PRODUCTS (by sales)
    if (type === "products") {
      const pfilter = {};
      if (q.name) pfilter.name = new RegExp(q.name, "i");
      if (q.productId) pfilter._id = mongoose.Types.ObjectId(q.productId);
      // Aggregate product sales, join with product info
      const productSales = await Order.aggregate([
        { $unwind: "$products" },
        {
          $group: {
            _id: "$products.productId",
            totalSold: { $sum: "$products.quantity" },
            revenue: {
              $sum: { $multiply: ["$products.quantity", "$products.price"] },
            },
          },
        },
        {
          $lookup: {
            from: "products",
            localField: "_id",
            foreignField: "_id",
            as: "productInfo",
          },
        },
        {
          $project: {
            productId: "$_id",
            name: { $arrayElemAt: ["$productInfo.name", 0] },
            totalSold: 1,
            revenue: 1,
          },
        },
        { $sort: { totalSold: -1 } },
      ]);
      // Further filter by name if needed
      const filtered = !q.name
        ? productSales
        : productSales.filter(
            (p) => p.name && p.name.toLowerCase().includes(q.name.toLowerCase())
          );
      return res.json({ productSales: filtered });
    }

    // DETAILED SALES (every sale line, order + product + user)
    if (type === "sales") {
      const match = buildMatch("sales", q);
      if (q.userEmail) {
        const users = await User.find({
          email: new RegExp(q.userEmail, "i"),
        }).select("_id");
        match.user = { $in: users.map((u) => u._id) };
      }
      const salesData = await Order.aggregate([
        { $unwind: "$products" },
        {
          $lookup: {
            from: "products",
            localField: "products.productId",
            foreignField: "_id",
            as: "productInfo",
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "userInfo",
          },
        },
        {
          $project: {
            orderId: "$_id",
            orderDate: "$createdAt",
            userEmail: { $arrayElemAt: ["$userInfo.email", 0] },
            productId: "$products.productId",
            productName: { $arrayElemAt: ["$productInfo.name", 0] },
            quantity: "$products.quantity",
            price: "$products.price",
            total: { $multiply: ["$products.quantity", "$products.price"] },
          },
        },
      ]);
      return res.json({ salesData });
    }

    // DETAILED REVENUE (each order, per month)
    if (type === "revenue") {
      const match = buildMatch("revenue", q);
      if (q.userEmail) {
        const users = await User.find({
          email: new RegExp(q.userEmail, "i"),
        }).select("_id");
        match.user = { $in: users.map((u) => u._id) };
      }
      // Per month: list of all orders, with month, value, user, etc.
      const revenueArr = await Order.aggregate([
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "userInfo",
          },
        },
        {
          $project: {
            orderId: "$_id",
            orderDate: "$createdAt",
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
            userEmail: { $arrayElemAt: ["$userInfo.email", 0] },
            totalPrice: 1,
            paymentMethod: 1,
          },
        },
      ]);
      return res.json({ revenueArr });
    }

    return res.status(400).json({ message: "Invalid analytics type" });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

// Update Admin Profile (Email & Password)
export const updateAdminProfile = async (req, res) => {
  try {
    const { email, password } = req.body;
    const adminId = req.admin.id; // Extract admin ID from middleware

    // Find Admin
    const admin = await Admin.findById(adminId);
    if (!admin) return res.status(404).json({ error: "Admin not found" });

    // Check if email already exists (except for the same admin)
    if (email !== admin.email) {
      const emailExists = await Admin.findOne({ email });
      if (emailExists)
        return res.status(400).json({ error: "Email already in use" });
      admin.email = email;
    }

    // Update Password (Hash before saving)
    if (password) {
      const salt = await bcrypt.genSalt(10);
      admin.password = await bcrypt.hash(password, salt);
    }

    await admin.save();
    res.json({ success: "Profile updated successfully", admin });
  } catch (error) {
    res.status(500).json({ error: "Server error", message: error.message });
  }
};

// Admin Logout
export const adminLogout = async (req, res) => {
  res.clearCookie("adminToken", {
    httpOnly: true,
    secure: true,
    sameSite: "None",
  });
  res.json({ message: "Logout successful" });
};
// Helper function to extract token
const getToken = (req) => {
  return req.cookies?.adminToken || req.headers.authorization?.split(" ")[1];
};

// Verify Admin Token Middleware
export const verifyToken = async (req, res, next) => {
  const token = getToken(req);
  if (!token)
    return res
      .status(401)
      .json({ message: "Unauthorized - No token provided" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.isAdmin) {
      return res
        .status(403)
        .json({ message: "Forbidden - Admin access required" });
    }

    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

// Verify Admin Authentication
export const verifyAdminAuth = (req, res, next) => {
  const token = getToken(req);

  if (!token) {
    return res
      .status(401)
      .json({ isAuthenticated: false, message: "Not authenticated" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ isAuthenticated: false, message: "Invalid token" });
  }
};

// Delete User Account
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user has orders
    const orders = await Order.find({ user: id });

    if (orders.length > 0) {
      // Option 1: Soft delete user (mark as deleted instead of removing)
      user.isDeleted = true;
      await user.save();

      // Option 2: Reassign orders to a default "Deleted User" account
      const deletedUser = await User.findOne({ email: "deleted@system.com" });
      const newOwner = deletedUser ? deletedUser._id : null;

      if (newOwner) {
        await Order.updateMany({ user: id }, { $set: { user: newOwner } });
      }

      return res.json({ message: "User deleted, orders reassigned" });
    }

    // If no orders, delete user permanently
    await User.findByIdAndDelete(id);
    res.json({ message: "User account deleted successfully" });
  } catch (error) {
    console.error("Delete User Error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

export const updateStockFromCSV = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const filePath = req.file.path;
  const stockUpdates = [];

  // ✅ Read CSV file
  fs.createReadStream(filePath)
    .pipe(csv())
    .on("data", (row) => {
      stockUpdates.push(row);
    })
    .on("end", async () => {
      try {
        // ✅ Process each row in CSV
        for (const update of stockUpdates) {
          const { slug, color, size, quantity } = update;
          if (!slug || !color || !size || !quantity) continue;

          // ✅ Find product by slug
          const product = await Product.findOne({ slug });
          if (!product) continue;

          // ✅ Update stock for matching color & size
          const colorVariant = product.colors.find((c) => c.name === color);
          if (colorVariant && colorVariant.sizes[size] !== undefined) {
            colorVariant.sizes[size] = parseInt(quantity);
          }

          await product.save();
        }

        res.json({ message: "Stock updated successfully!" });
      } catch (error) {
        res.status(500).json({ message: "Error updating stock", error });
      } finally {
        fs.unlinkSync(filePath); // ✅ Delete CSV after processing
      }
    });
};

// Helper: Group returned products by order for frontend
function groupReturnsByOrder(productReturns) {
  const orderMap = {};

  productReturns.forEach((prod) => {
    const orderId = prod.orderId.toString();

    if (!orderMap[orderId]) {
      orderMap[orderId] = {
        orderId: prod.orderId,
        user: prod.user,
        createdAt: prod.createdAt,
        items: [],
      };
    }
    orderMap[orderId].items.push({
      productId: prod.productId,
      slug: prod.slug,
      name: prod.name,
      images: prod.images,
      color: prod.color,
      size: prod.size,
      quantity: prod.quantity,
      price: prod.price,
      status: prod.status,
      returnStatus: prod.status, // for frontend compatibility
      returnDetails: prod.returnDetails,
      replacementOrderId: prod.replacementOrderId,
      sku: prod.sku,
      exchangeToColor: prod.exchangeToColor || "",
      exchangeToSize: prod.exchangeToSize || "",
    });
  });

  return Object.values(orderMap);
}

// Robust helper: always use order subdoc for color/size/sku, and fallback to populated doc for name/images
function getProductReturnDetails(product) {
  console.log("Processing product return details for:", product);
  // product.productId may be populated (object) or just an ID (string)
  const prodDoc =
    product.productId && typeof product.productId === "object"
      ? product.productId
      : {};
  return {
    productId: prodDoc._id?.toString() || product.productId?.toString() || "",
    slug: product.slug || "",
    name: product.productName || prodDoc.productName || "",
    images: prodDoc.images || [],
    color: product.color || "",
    size: product.size || "",
    quantity: product.quantity,
    price: product.priceAtOrder || product.price,
    status: product.status,
    returnDetails: {
      reason: product.returnIssueType,
      issue: product.returnIssueDesc,
      resolution: product.returnResolutionType,
      images: product.returnImages || [],
      pickupStatus: product.pickupStatus,
      refundAmount: product.refundAmount,
      refundDate: product.refundDate,
    },
    replacementOrderId: product.replacementOrderId,
    sku: product.sku || "",
    exchangeToColor: product.exchangeToColor || "",
    exchangeToSize: product.exchangeToSize || "",
  };
}

// Main: Get all return requests for admin panel, any state, pending at top
export const getReturnRequests = async (req, res) => {
  try {
    // 1. Find all orders where at least one product has any return status (excluding those never returned)
    const orders = await Order.find({
      products: {
        $elemMatch: {
          status: {
            $in: [
              "Return Requested",
              "Return Approved",
              "Return Rejected",
              "Refunded",
              "Returned",
            ],
          },
        },
      },
    })
      .populate("user", "email")
      .populate("products.productId", "name images colors slug")
      .lean();

    const productReturns = [];
    orders.forEach((order) => {
      // Only include products that have any return status
      const returnedProducts = order.products.filter((p) =>
        [
          "Return Requested",
          "Return Approved",
          "Return Rejected",
          "Refunded",
          "Returned",
        ].includes(p.status)
      );

      returnedProducts.forEach((product) => {
        const prodDetails = getProductReturnDetails(product);
        productReturns.push({
          ...prodDetails,
          orderId: order.orderId,
          user: order.user,
          createdAt: order.createdAt,
        });
      });
    });

    // 2. Group by order for frontend
    const groupedReturns = groupReturnsByOrder(productReturns);

    // 3. Sort so that orders with "Return Requested" appear at the top
    groupedReturns.sort((a, b) => {
      // Find the highest-priority status for each order
      const aHasPending = a.items.some(
        (item) => item.returnStatus === "Return Requested"
      );
      const bHasPending = b.items.some(
        (item) => item.returnStatus === "Return Requested"
      );
      if (aHasPending && !bHasPending) return -1;
      if (!aHasPending && bHasPending) return 1;
      // fallback: newest first
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    res.json({ returns: groupedReturns });
  } catch (error) {
    res.status(500).json({
      message: "Error fetching return requests",
      error: error.message,
    });
  }
};

// Approve or Reject a product return request
export const updateReturnStatus = async (req, res) => {
  try {
    const { orderId, productId } = req.params;
    const { status } = req.body; // "Return Approved" or "Return Rejected"
    if (!["Return Approved", "Return Rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    const product = order.products.find(
      (p) => p.productId === productId || p.product.toString() === productId
    );
    if (!product || product.status !== "Return Requested") {
      return res.status(400).json({ message: "Product is not pending return" });
    }
    product.status = status;
    await order.save();
    res.json({
      message: `Return ${
        status === "Return Approved" ? "approved" : "rejected"
      } successfully`,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
    console.error("Update Return Status Error:", error);
  }
};

export const processRefund = async (req, res) => {
  try {
    const { orderId, productId } = req.params;
    const order = await Order.findById(orderId);
    if (!order || order.paymentMethod !== "razorpay" || !order.isPaid) {
      return res.status(400).json({ message: "Refund not eligible" });
    }

    // Find product in order
    const product = order.products.find((p) => p.productId == productId);
    if (
      !product ||
      product.status !== "Return Approved" ||
      product.pickupStatus !== "Picked Up"
    ) {
      return res
        .status(400)
        .json({ message: "Product not eligible for refund" });
    }

    // Calculate refund amount (in paise)
    const refundAmount =
      Number(product.priceAtOrder) * Number(product.quantity)*100;
    console.log(product.priceAtOrder, product.quantity);
    console.log("Calculated refund amount (in paise):", refundAmount);
    console.log("Order total price:", order.totalPrice);

    // Get Razorpay payment amount (in paise)
    const paymentAmount = Number(
      order.paymentDetails?.amount || order.totalPrice * 100
    );
    console.log("Payment amount (in paise):", paymentAmount);

    // Validate refund amount
    if (!refundAmount || isNaN(refundAmount) || refundAmount <= 0) {
      return res.status(400).json({ message: "Refund amount invalid" });
    }
    if (refundAmount > paymentAmount) {
      return res.status(400).json({
        message: "Refund amount exceeds payment amount",
        refundAmount,
        paymentAmount,
      });
    }

    const paymentId = order.razorpayPaymentId;
    const refund = await razorpay.payments.refund(paymentId, {
      amount: refundAmount,
    });

    // Update DB: Patch for returnDetails
    product.status = "Refunded";
    if (!product.returnDetails) product.returnDetails = {};
    product.returnDetails.refundDate = new Date();
    product.returnDetails.refundAmount = refundAmount / 100; // Store in rupees
    product.returnDetails.refundTransactionId = refund.id;

    // Order level refund info
    order.refundStatus = "Processed";
    order.refundedAmount =
      (order.refundedAmount || 0) + product.returnDetails.refundAmount;
    order.refundDate = new Date();
    order.refundTransactionId = refund.id;

    await order.save();
    res.json({
      success: true,
      message: "Refund processed via Razorpay",
      refundId: refund.id,
      amount: product.returnDetails.refundAmount,
      refundDate: product.returnDetails.refundDate,
    });
  } catch (error) {
    res.status(500).json({ message: "Refund failed", error: error.message });
    console.error("Refund Error:", error);
  }
};
