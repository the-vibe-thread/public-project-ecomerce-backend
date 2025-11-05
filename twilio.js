import twilio from "twilio";
import logger from "../utils/logger.js"; // Use Winston or another logger

// Validate Twilio Environment Variables
if (!process.env.TWILIO_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE) {
  throw new Error("❌ Twilio environment variables are missing! Check .env file.");
}

// Twilio Client
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

// Rate Limiter (Simple In-Memory Cache)
const otpRequests = new Map();

const sendOTP = async (mobile, otp) => {
  try {
    // Check rate limit (prevent multiple OTP requests within 60 seconds)
    const lastRequestTime = otpRequests.get(mobile);
    if (lastRequestTime && Date.now() - lastRequestTime < 60000) {
      throw new Error("Too many OTP requests. Please wait 1 minute.");
    }
    
    otpRequests.set(mobile, Date.now()); // Update request timestamp

    // OTP Message
    const messageBody = `Your OTP code is: ${otp}. It will expire in 5 minutes.`;

    const message = await client.messages.create({
      body: messageBody,
      from: process.env.TWILIO_PHONE,
      to: mobile,
    });

    logger.info(`✅ OTP sent to ${mobile}: Message SID ${message.sid}`);
    return { success: true, message: "OTP sent successfully." };

  } catch (error) {
    logger.error(`❌ OTP sending failed for ${mobile}: ${error.message}`);
    return { success: false, error: error.message };
  }
};

export default sendOTP;
