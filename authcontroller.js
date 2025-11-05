import User from "../models/user.js";
import generateToken from "../utils/generateToken.js";
import validator from "validator";
import { createClient } from "redis";
import nodemailer from "nodemailer";


const redisClient = createClient({
  username: "default",
  password: process.env.Redis_password,
  socket: {
    host: "redis-16709.crce179.ap-south-1-1.ec2.redns.redis-cloud.com",
    port: 16709,
  },
});

redisClient.on("error", (err) => console.error("Redis redisClient Error", err));

(async () => {
  try {
    await redisClient.connect();
    console.log("✅ Connected to Redis Cloud successfully");
  } catch (err) {
    console.error("❌ Redis connection failed:", err);
  }
})();

// Helper: Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Configure nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail", // or your SMTP provider
  auth: {
    user: process.env.EMAIL_HOST, // Use the environment variable for email host
    pass: process.env.EMAIL_PASSWORD, // Use the environment variable for email password
  },
});

// Helper: Send OTP email
async function sendOtpEmail(email, otp) {
  await transporter.sendMail({
    from: process.env.EMAIL_HOST, // <--- this is the "from" address
    to: email,
    subject: "Your OTP Code",
    text: `Your OTP code is: ${otp}`,
  });
  return true;
}

// @desc    Signup user after OTP verification
// @route   POST /api/auth/signup
export const signupUser = async (req, res) => {
  try {
    const { name, email, phoneNumber, address } = req.body;

    // Input Sanitization
    const sanitizedName = name?.trim();
    const sanitizedEmail = email?.trim();
    const sanitizedPhoneNumber = phoneNumber?.trim();
    const sanitizedAddress = address?.trim();

    // 1. Validate input fields
    if (
      !sanitizedName ||
      !sanitizedEmail ||
      !sanitizedPhoneNumber ||
      !sanitizedAddress
    ) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required." });
    }

    // 2. Validate email format
    if (!validator.isEmail(sanitizedEmail)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email format." });
    }

    // 3. Validate phone number format
    if (
      !validator.isMobilePhone(sanitizedPhoneNumber, "any", {
        strictMode: false,
      })
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid phone number format." });
    }

    // 4. Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: sanitizedEmail }, { phoneNumber: sanitizedPhoneNumber }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message:
          existingUser.email === sanitizedEmail
            ? "Email already registered. Please log in."
            : "Phone number already registered. Please log in.",
      });
    }

    // 5. Create new user
    const user = new User({
      name: sanitizedName,
      email: sanitizedEmail,
      phoneNumber: sanitizedPhoneNumber,
      address: sanitizedAddress,
      isAdmin: false,
    });

    await user.save();

    // 6. Generate JWT token and set it in HTTP-only cookie
    const token = generateToken(user._id, user.isAdmin);

    res
      .cookie("userToken", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      })
      .status(201)
      .json({
        success: true,
        message: "Signup successful!",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phoneNumber: user.phoneNumber,
          address: user.address,
          isAdmin: user.isAdmin,
        },
      });
  } catch (error) {
    console.error("Error during signup:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error. Please try again." });
  }
};

// @desc    Send OTP to any email
// @route   POST /api/auth/login
export const loginUser = async (req, res) => {
  const { email } = req.body;

  if (!email?.trim()) {
    return res
      .status(400)
      .json({ success: false, message: "Email is required." });
  }

  if (!validator.isEmail(email.trim())) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid email format." });
  }

  // Generate and store OTP
  const otp = generateOTP();

  await redisClient.set(`otp:${email.trim()}`, otp, { EX: 900 }); // 15 min expiry

  // Send OTP via email
  await sendOtpEmail(email.trim(), otp);

  res.status(200).json({ success: true, message: "OTP sent to your email." });
};

// @desc    Verify OTP and check user existence
export const verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  if (!email?.trim() || !otp?.trim()) {
    return res
      .status(400)
      .json({ success: false, message: "Email and OTP are required." });
  }

  if (!validator.isEmail(email.trim())) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid email format." });
  }

  const storedOtp = await redisClient.get(`otp:${email.trim()}`);
  if (!storedOtp || storedOtp !== otp) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Invalid or expired OTP. Please try again.",
      });
  }

  await redisClient.del(`otp:${email.trim()}`);

  const user = await User.findOne({ email: email.trim() });

  if (user) {
    const token = generateToken(user._id, user.isAdmin);
    res
      .cookie("userToken", token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      })
      .status(200)
      .json({
        success: true,
        exists: true,
        message: "OTP verified successfully!",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phoneNumber: user.phoneNumber,
          address: user.address,
          isAdmin: user.isAdmin,
        },
      });
  } else {
    res
      .status(200)
      .json({
        success: true,
        exists: false,
        message: "OTP verified, user not found.",
      });
  }
};

// @desc    Logout user (clear cookie)
// @route   POST /api/auth/logout
// @access  Public
export const logout = (req, res) => {
  res.clearCookie("userToken", {
    httpOnly: true,
    sameSite: "lax", // or "strict" if you want
    secure: process.env.NODE_ENV === "production",
  });
  res.status(200).json({ message: "Logged out successfully" });
};
