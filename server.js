import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import xssClean from "xss-clean";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import connectDB from "./config/db.js";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import logger from "./utils/logger.js";
import morgan from "morgan";
import mongoose from "mongoose";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { initializeSocket } from "./socket.js";

// Import Routes
import userRoutes from "./routes/userRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import discountRoutes from "./routes/discountRoutes.js";
import CarouselRoutes from "./routes/CarasoulRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import shippingRoutes from "./routes/shippingRoutes.js";
import pincodeRoutes from "./routes/pincodeRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js"; // Import feedback routes
import NewsletterRoutes from "./routes/newsletterRoutes.js"; // Import newsletter routes
import BlogRoutes from "./routes/blogRoutes.js"; // Import blog routes
import GallaryRoutes from "./routes/GallaryRoutes.js"; // Import gallery routes
import preorderRoutes from "./routes/preorderRoutes.js"; // Import ProductController for tag suggestions
import invoiceRoutes from "./routes/invoiceRoutes.js"; // Import invoice routes

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const requiredEnvVars = ["MONGO_URI", "PORT", "JWT_SECRET", "CLIENT_URL"];
for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    logger.error(`❌ Missing environment variable: ${varName}`);
    process.exit(1);
  }
}

connectDB();

const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);

initializeSocket(server);

// ✅ Improved Helmet Configuration for CORS in Images
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// ✅ CORS Configuration (Moved ABOVE `/uploads` Route)
app.use(
  cors({
    origin: [
      "https://adminpanel-ruby-seven.vercel.app",
      "https://frontend-xodi.vercel.app",
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ✅ Correct `/uploads` Route for Image Loading
app.use("/uploads", (req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); // ✅ Key Fix
  res.setHeader("Access-Control-Allow-Origin", "*"); // ✅ Allow images across origins
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Serve static files after setting headers
  express.static(path.join(__dirname, "uploads"))(req, res, next);
});

app.use("/uploads/carousel", (req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); // ✅ Key Fix
  res.setHeader("Access-Control-Allow-Origin", "*"); // ✅ Allow images across origins
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Serve static files after setting headers
  express.static(path.join(__dirname, "uploads/carousel"))(req, res, next);
});

// Security Middleware
app.use(xssClean());
app.use(mongoSanitize());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.RATE_LIMIT || 1000,
  message: "Too many requests, please try again later.",
});
app.use(limiter);

// Logging Middleware
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev", { stream: logger.stream }));
}
// Middleware to parse JSON and x-www-form-urlencoded data
app.use(express.json({ limit: "100mb" })); // Increased limit for large payloads
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true, limit: "100mb" })); // Increased limit for large payloads

// API Routes
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/discounts", discountRoutes);
app.use("/api/carousel", CarouselRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/pincodes", pincodeRoutes);
app.use("/api/feedback", feedbackRoutes); // Use feedback routes
app.use("/api/newsletter", NewsletterRoutes); // Use newsletter routes
app.use("/api/blogs", BlogRoutes); // Use blog routes
app.use("/api/gallery", GallaryRoutes); // Use gallery routes
app.use("/api/preorders", preorderRoutes); // Use preorder routes
app.use("/api/invoices", invoiceRoutes); // Import invoice routes dynamically

// Health Check Route
app.get("/", (req, res) => {
  res.status(200).json({ message: "✅ API is running..." });
});

// 404 Not Found Middleware
app.use((req, res, next) => {
  logger.warn(`⚠️ 404 - Not Found: ${req.originalUrl}`);
  res.status(404).json({ message: "Route not found" });
});

// Global Error Handling
app.use((err, req, res, next) => {
  logger.error(`❌ Server Error: ${err.message}`);
  res.status(500).json({ message: "Server Error", error: err.message });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, "0.0.0.0", () =>
  logger.info(`🚀 Server running on http://0.0.0.0:${PORT}`)
);

// Graceful Shutdown Handling
process.on("SIGINT", async () => {
  logger.warn("🔴 Shutting down server...");
  await mongoose.connection.close();
  server.close(() => {
    logger.info("✅ Server closed. Database disconnected.");
    process.exit(0);
  });
});
