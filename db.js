import mongoose from "mongoose";
import dotenv from "dotenv";
import logger from "../utils/logger.js"; // Winston Logger

dotenv.config();

const MAX_RETRIES = 5;
let retryCount = 0;

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("❌ MONGO_URI is not set in the .env file");
    }

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s
      autoIndex: true, // Ensure indexes are created
    });

    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
    logger.info(`🛢️  Database: ${conn.connection.name}`);

    // Enable debug mode in development
    if (process.env.NODE_ENV === "development") {
      mongoose.set("debug", true);
    }

    retryCount = 0; // Reset retry counter on success
  } catch (error) {
    logger.error(`❌ MongoDB Connection Error: ${error.message}`);

    if (retryCount < MAX_RETRIES) {
      retryCount++;
      logger.warn(`🔄 Retrying connection (${retryCount}/${MAX_RETRIES}) in 5s...`);
      setTimeout(connectDB, 5000);
    } else {
      logger.error("🚨 Maximum retries reached. Exiting...");
      process.exit(1);
    }
  }
};

// MongoDB Event Listeners
mongoose.connection.on("error", (err) => {
  logger.error(`❌ MongoDB Error: ${err.message}`);
});

mongoose.connection.on("disconnected", () => {
  logger.warn("⚠️ MongoDB Disconnected. Retrying in 5s...");
  setTimeout(connectDB, 5000);
});

mongoose.connection.on("reconnected", () => {
  logger.info("✅ MongoDB Reconnected Successfully");
});

// Graceful Shutdown
process.on("SIGINT", async () => {
  logger.warn("🔴 Closing MongoDB Connection...");
  await mongoose.connection.close();
  logger.info("✅ MongoDB Connection Closed.");
  process.exit(0);
});

export default connectDB;
