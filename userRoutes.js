import express from "express";
import {
  sendOtpToUser,
  verifyOtp,
  getUserProfile,
  updateUserProfile,
  getAllUsers,
  getUserByIdOrPhone,
} from "../controllers/userController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public routes
router.post("/send-otp", sendOtpToUser);
router.post("/verify-otp", verifyOtp);

// Private routes (requires authentication)
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, updateUserProfile);

// Admin-only routes
router.get("/", protect, admin, getAllUsers);
router.get("/:identifier", protect, admin, getUserByIdOrPhone);

export default router;
