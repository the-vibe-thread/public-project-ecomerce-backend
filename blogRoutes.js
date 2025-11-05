import express from "express";
import Blog from "../models/Blog.js";
import multer from "multer";
import cloudinary from "../config/cloudinaryConfig.js"; // Adjust path as needed
import streamifier from "streamifier";
import { protectAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Multer in-memory storage for streaming to Cloudinary
const upload = multer({ storage: multer.memoryStorage() });

// Helper to upload buffer to Cloudinary
const uploadBufferToCloudinary = (buffer, filename) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "blog_images",
        resource_type: "image",
        public_id: filename,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });

// Get all blogs
router.get("/", async (req, res) => {
  try {
    const blogs = await Blog.find().sort({ date: -1 });
    res.json(blogs);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get single blog by slug
router.get("/:slug", async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug });
    if (!blog) return res.status(404).json({ message: "Blog not found" });
    res.json(blog);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Create a new blog with image upload to Cloudinary
router.post("/", protectAdmin, upload.single("image"), async (req, res) => {
  try {
    const { title, slug, summary, content, author, date } = req.body;
    if (!title || !slug || !summary || !content) {
      return res.status(400).json({ message: "Required fields missing." });
    }
    const exists = await Blog.findOne({ slug });
    if (exists) {
      return res.status(409).json({ message: "Slug already exists." });
    }

    let image = "";
    if (req.file) {
      image = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname);
    }

    const blog = new Blog({
      title,
      slug,
      image, // Cloudinary URL
      summary,
      content,
      author,
      date: date ? new Date(date) : new Date(),
    });
    await blog.save();
    res.status(201).json({ message: "Blog created successfully.", blog });
  } catch (err) {
    console.error("Blog upload error:", err);
    res.status(500).json({ message: "Server error." });
  }
});

export default router;