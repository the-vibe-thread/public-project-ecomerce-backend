import express from "express";
import { uploadCarouselImage, getCarouselImages, deleteCarouselImage } from "../controllers/carasoulController.js";
import { protectAdmin } from "../middleware/authMiddleware.js"; 

const router = express.Router();

// ✅ Upload Carousel Image (Admin Only)
router.post("/upload", protectAdmin, uploadCarouselImage);

// ✅ Get All Carousel Images
router.get("/", getCarouselImages);

// ✅ Delete a Specific Carousel Image (Admin Only)
router.delete("/:id", protectAdmin, deleteCarouselImage);

export default router;
