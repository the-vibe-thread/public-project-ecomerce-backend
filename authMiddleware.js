import jwt from "jsonwebtoken";
import User from "../models/user.js";
import Admin from "../models/admin.js";

// For admin-only routes:
const getAdminToken = (req) => {
  if (req.cookies?.adminToken) return req.cookies.adminToken;
  if (req.headers.authorization?.startsWith("Bearer ")) {
    return req.headers.authorization.split(" ")[1];
  }
  return null;
};

// For user-only routes:
const getUserToken = (req) => {
  if (req.cookies?.userToken) return req.cookies.userToken;
  if (req.headers.authorization?.startsWith("Bearer ")) {
    return req.headers.authorization.split(" ")[1];
  }
  return null;
};

// For routes that allow both (shared):
const getAnyToken = (req) => {
  if (req.cookies?.adminToken) return req.cookies.adminToken;
  if (req.cookies?.userToken) return req.cookies.userToken;
  if (req.headers.authorization?.startsWith("Bearer ")) {
    return req.headers.authorization.split(" ")[1];
  }
  return null;
};

// Middleware: Protect User Routes (Requires User Authentication)
export const protect = async (req, res, next) => {
  try {
    const token = getUserToken(req);
    console.log("Token:", token)
;
    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized: No token provided" });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("-password");

      if (!user) {
        return res.status(401).json({ success: false, message: "Unauthorized: User not found" });
      }

      req.user = user;
      next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: err.name === "TokenExpiredError" ? "Unauthorized: Token expired" : "Unauthorized: Invalid token",
      });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

// Middleware: Protect Admin Routes (Requires Admin Authentication)
export const protectAdmin = async (req, res, next) => {
  try {
    const token = getAdminToken(req);
    console.log("Admin Token:", token);
    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized: No token provided" });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Check if the admin exists in the database
      let admin = await Admin.findById(decoded.id).select("-password");

      // If admin is not in DB, check for environment-based super admin
      if (!admin && decoded.id === process.env.SUPER_ADMIN_ID) {
        admin = { email: process.env.ADMIN_EMAIL, isAdmin: true, role: "superadmin" }; // Temporary admin object
      }

      if (!admin || !admin.isAdmin) {
        return res.status(403).json({ success: false, message: "Unauthorized: Admin access required" });
      }

      req.admin = admin;
      next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: err.name === "TokenExpiredError" ? "Unauthorized: Token expired" : "Unauthorized: Invalid token",
      });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

// Middleware: Admin Access (Admins & Super Admins)
export const admin = (req, res, next) => {
  if (req.admin?.isAdmin) {
    return next();
  }
  return res.status(403).json({ success: false, message: "Forbidden: Admin access required" });
};

// Middleware: Super Admin Access (Only Super Admins)
export const superAdminOnly = (req, res, next) => {
  if (req.admin?.role === "superadmin") {
    return next();
  }
  return res.status(403).json({ success: false, message: "Forbidden: Super Admin access required" });
};

// Middleware: Allow Both Users & Admins (For Shared APIs)
export const protectUserOrAdmin = async (req, res, next) => {
  try {
    const token = getAnyToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized: No token provided" });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      let user = await User.findById(decoded.id).select("-password");
      let admin = await Admin.findById(decoded.id).select("-password");

      if (!user && !admin) {
        return res.status(401).json({ success: false, message: "Unauthorized: User/Admin not found" });
      }

      req.user = user || null;
      req.admin = admin || null;
      next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: err.name === "TokenExpiredError" ? "Unauthorized: Token expired" : "Unauthorized: Invalid token",
      });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};
