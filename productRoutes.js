import express from "express";
import multer from "multer";
import cloudinary from "../config/cloudinaryConfig.js";
import streamifier from "streamifier";

import {
  getProducts,
  getProductBySlug,
  createProductBYAdmin,
  updateProductBYAdmin,
  deleteProduct,
  bulkDeleteProducts,
  createReview,
  getTopProducts,
  getProductSuggestions,
  getProductWithReviews,
  getProductsBYAdmin,
  getProductBySlugBYAdmin,
  getTagSuggestions,
} from "../controllers/ProductController.js";

import { protect, protectAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/upload-images", upload.any(), async (req, res) => {
  try {
    if (!req.files || !req.files.length) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const mainImages = [];
    const colorIcons = [];
    const colorMainImages = {};

    const uploadBufferToCloudinary = (buffer, filename) =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "products", resource_type: "auto", public_id: filename },
          (error, result) => {
            if (error) reject(error);
            else resolve(result.secure_url);
          }
        );
        streamifier.createReadStream(buffer).pipe(stream);
      });

    for (const file of req.files) {
      const cloudUrl = await uploadBufferToCloudinary(
        file.buffer,
        file.originalname
      );

      if (file.fieldname === "images") {
        mainImages.push(cloudUrl);
      } else if (file.fieldname.startsWith("colorIcons")) {
        colorIcons.push(cloudUrl);
      } else if (file.fieldname.startsWith("colorMainImages")) {
        const match = file.fieldname.match(/colorMainImages\[(\d+)\]/);
        if (match) {
          const idx = match[1];
          if (!colorMainImages[idx]) colorMainImages[idx] = [];
          colorMainImages[idx].push(cloudUrl);
        }
      }
    }

    const colorVariantImages = Object.values(colorMainImages);

    res.json({
      mainImages,
      colorIcons,
      colorVariantImages,
    });
  } catch (err) {
    console.error("Error occurred in /upload-images:", err);
    res
      .status(500)
      .json({ message: "Server error", error: err.message || err });
  }
});
// Public Routes
router.get("/top", getTopProducts);
router.get("/suggestions", getProductSuggestions);
router.get("/", getProducts);
router.get("/:slug", getProductWithReviews);
router.get("/tags/suggestions", getTagSuggestions);

// Admin Routes (Requires Admin Role)
router.get("/admin", protectAdmin, getProductsBYAdmin);
router.get("/admin/:slug", protectAdmin, getProductBySlugBYAdmin);
router.post("/admin/products", protectAdmin, createProductBYAdmin);
router.put("/admin/:slug", protectAdmin, upload.any(), updateProductBYAdmin);
router.delete("/admin/:slug", protectAdmin, deleteProduct);
router.post("/admin/bulk-delete", protectAdmin, bulkDeleteProducts);

// Product Reviews (Logged-in Users Only)
router.post("/:slug/review", protect, createReview);

// Error Handling Middleware
router.use((err, req, res, next) => {
  console.error("Error occurred:", err);
  res.status(500).json({ message: "Server error", error: err.message });
});

export default router;
