import Carousel from "../models/carasoul.js";
import multer from "multer";
import cloudinary from '../config/cloudinaryConfig.js';
import streamifier from "streamifier";
import path from "path";

// ✅ Configure Multer for Memory Storage
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Helper: Upload Buffer to Cloudinary
const uploadBufferToCloudinary = (buffer, filename) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'carousel', resource_type: 'auto', public_id: path.parse(filename).name },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });

// ✅ Upload Carousel Image
export const uploadCarouselImage = async (req, res) => {
  upload.single("image")(req, res, async (err) => {
    if (err) {
      return res.status(500).json({ success: false, message: "Image upload failed", error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    try {
      // Upload to Cloudinary
      const url = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname);

      const newImage = await Carousel.create({
        imageUrl: url, // Cloudinary URL
        caption: req.body.caption || "",
        link: req.body.link || "",
        isActive: req.body.isActive !== undefined ? req.body.isActive : true,
      });

      res.status(201).json({ success: true, image: newImage });
    } catch (error) {
      res.status(500).json({ success: false, message: "Failed to save image", error: error.message });
    }
  });
};

// ✅ Get All Carousel Images
export const getCarouselImages = async (req, res) => {
  try {
    const images = await Carousel.find();
    res.json({ success: true, images });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch images", error: error.message });
  }
};

// ✅ Delete Carousel Image
export const deleteCarouselImage = async (req, res) => {
  try {
    const image = await Carousel.findById(req.params.id);
    if (!image) {
      return res.status(404).json({ success: false, message: "Image not found" });
    }

    // Optionally: Delete from Cloudinary
    // If you want to also remove from Cloudinary, you can use:
    const publicId = image.imageUrl.split('/').pop().split('.')[0];
    await cloudinary.uploader.destroy(`carousel/${publicId}`);

    // Remove from database
    await image.deleteOne();
    res.json({ success: true, message: "Image deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete image", error: error.message });
  }
};