import express from "express";
import { signupUser, loginUser, verifyOTP,logout } from "../controllers/authcontroller.js";
import { protect } from "../middleware/authMiddleware.js";


const router = express.Router();

router.post("/send-otp")
  // Generate and store OTP

// @desc    User Signup
// @route   POST /api/auth/signup
router.post("/signup", signupUser);

// @desc    User Login (OTP-based if implemented)
// @route   POST /api/auth/login
router.post("/login", loginUser);

// @desc    Verify OTP (for login/signup)
// @route   POST /api/auth/verify-otp
router.post("/verify-otp", verifyOTP);

// @desc    Protected User Route (Example)
// @route   GET /api/auth/me
router.get("/me", protect, (req, res) => {
  
  res.json({ success: true, user: req.user });
});

router.post("/logout", logout);


export default router;
