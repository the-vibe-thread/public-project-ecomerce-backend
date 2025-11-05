// utils/sendOtp.js
import twilio from "twilio";
import dotenv from "dotenv";
import Otp from "../models/otp.js"; // New OTP model

dotenv.config();

// Twilio setup
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Function to generate and store OTP
export const sendOtp = async (phoneNumber) => {
  const otp = Math.floor(100000 + Math.random() * 900000); // Generate 6-digit OTP
  const expiryTime = new Date(Date.now() + 5 * 60 * 1000); // OTP expires in 5 mins

  // Store OTP in DB
  await Otp.create({ phoneNumber, otp, expiresAt: expiryTime });

  // Send OTP via Twilio
  await client.messages.create({
    body: `Your OTP for login is ${otp}. It is valid for 5 minutes.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: phoneNumber,
  });

  return otp;
};
