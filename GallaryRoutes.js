import express from "express";
import {
  uploadMiddleware,
  uploadGalleryVideo,
  getGalleryVideos,
  deleteGalleryVideo,
} from "../controllers/GallaryController.js";
import {protectAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", getGalleryVideos);
router.post("/", protectAdmin, uploadMiddleware, uploadGalleryVideo);
router.delete("/:id", protectAdmin, deleteGalleryVideo);

export default router;
