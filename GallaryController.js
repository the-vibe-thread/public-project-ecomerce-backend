// Example Express controller for handling gallery video uploads
import multer from "multer";
import cloudinary from "../config/cloudinaryConfig.js";
import streamifier from "streamifier";
import Gallery from "../models/GallaryVideo.js"; // Adjust model path

const upload = multer({ storage: multer.memoryStorage() });

const uploadBufferToCloudinary = (buffer, filename) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "gallery", resource_type: "auto", public_id: filename.split(".")[0] },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });

// POST /api/gallery
export const uploadGalleryVideo = async (req, res) => {
  // If uploading by URL:
  if (req.body.url) {
    // You might want to validate and save this URL
    const newVideo = await Gallery.create({ url: req.body.url });
    return res.status(201).json({ video: newVideo });
  }

  // If uploading by file:
  if (!req.file) {
    return res.status(400).json({ error: "No video file or URL provided" });
  }

  try {
    const url = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname);
    const newVideo = await Gallery.create({ url });
    res.status(201).json({ video: newVideo });
  } catch (err) {
    res.status(500).json({ error: "Failed to upload video" });
  }
};

// GET /api/gallery
export const getGalleryVideos = async (req, res) => {
  const videos = await Gallery.find().sort({ createdAt: -1 });
  res.json({ videos });
};

// DELETE /api/gallery/:id
export const deleteGalleryVideo = async (req, res) => {
  await Gallery.findByIdAndDelete(req.params.id);
  res.json({ success: true });
};

export const uploadMiddleware = upload.single("image"); // "image" must match key in FormData