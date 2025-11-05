import asyncHandler from "express-async-handler";
import User from "../models/user.js";
import Otp from "../models/otp.js";
import generateToken from "../utils/generateToken.js";
import { sendOtp } from "../utils/sendOtp.js";

// @desc Send OTP for login/signup
// @route POST /api/users/send-otp
// @access Public
const sendOtpToUser = asyncHandler(async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber || !/^\+\d{10,15}$/.test(phoneNumber)) {
    res.status(400);
    throw new Error(
      "Invalid phone number format. Use international format (+1234567890)."
    );
  }

  // Send OTP and store in DB
  await sendOtp(phoneNumber);

  res.json({ message: "OTP sent successfully" });
});

// @desc Verify OTP & Authenticate User
// @route POST /api/users/verify-otp
// @access Public
const verifyOtp = asyncHandler(async (req, res) => {
  const { phoneNumber, otp, name, email, address } = req.body;

  if (!phoneNumber || !otp) {
    res.status(400);
    throw new Error("Phone number and OTP are required.");
  }

  // Find OTP in DB
  const otpRecord = await Otp.findOne({ phoneNumber, otp });

  if (!otpRecord || otpRecord.expiresAt < new Date()) {
    res.status(400);
    throw new Error("Invalid or expired OTP.");
  }

  let user = await User.findOne({ phoneNumber });

  // If user does not exist, create new user
  if (!user) {
    if (!name || !email || !address) {
      res.status(400);
      throw new Error("New users must provide name, email, and address.");
    }

    user = await User.create({ name, phoneNumber, email, address });
  } else {
    // Update existing user info (optional)
    user.email = email || user.email;
    user.address = address || user.address;
    await user.save();
  }

  // Delete OTP after successful verification
  await Otp.deleteOne({ phoneNumber });

  const token = generateToken(user._id, user.isAdmin);
  console.log("Generated Token:", token);

  // --- SET THE COOKIE HERE ---
  res.cookie("userToken", token, {
    httpOnly: true,
    secure: true, // use false for local development (http)
    sameSite: "none", // required for cross-origin cookies
    maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
  });

  res.json({
    _id: user._id,
    name: user.name,
    phoneNumber: user.phoneNumber,
    email: user.email,
    address: user.address,
    isAdmin: user.isAdmin,
    token: generateToken(user._id, user.isAdmin),
  });
});

// @desc Get user profile
// @route GET /api/users/profile
// @access Private
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    res.json({
      _id: user._id,
      name: user.name,
      phoneNumber: user.phoneNumber,
      email: user.email,
      address: user.address,
      isAdmin: user.isAdmin,
    });
  } else {
    res.status(404);
    throw new Error("User not found.");
  }
});

// @desc Update user profile
// @route PUT /api/users/profile
// @access Private
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.name = req.body.name || user.name;
    user.email = req.body.email || user.email;
    user.address = req.body.address || user.address;
    user.phoneNumber = req.body.phoneNumber || user.phoneNumber;

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      phoneNumber: updatedUser.phoneNumber,
      email: updatedUser.email,
      address: updatedUser.address,
      isAdmin: updatedUser.isAdmin,
      token: generateToken(updatedUser._id, updatedUser.isAdmin),
    });
  } else {
    res.status(404);
    throw new Error("User not found.");
  }
});

// @desc Get all users (Admin Only)
// @route GET /api/users
// @access Private/Admin
const getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find({});
  res.json(users);
});

// @desc Get user by ID or phone number (Admin Only)
// @route GET /api/users/:identifier
// @access Private/Admin
const getUserByIdOrPhone = asyncHandler(async (req, res) => {
  const { identifier } = req.params;

  let user;

  if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
    user = await User.findById(identifier);
  } else {
    user = await User.findOne({ phoneNumber: identifier });
  }

  if (user) {
    res.json({
      _id: user._id,
      name: user.name,
      phoneNumber: user.phoneNumber,
      email: user.email,
      address: user.address,
      isAdmin: user.isAdmin,
    });
  } else {
    res.status(404);
    throw new Error("User not found.");
  }
});

export {
  sendOtpToUser,
  verifyOtp,
  getUserProfile,
  updateUserProfile,
  getAllUsers,
  getUserByIdOrPhone,
};
