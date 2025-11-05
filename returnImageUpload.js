import multer from "multer";

// Use memory storage since we'll upload buffers to cloudinary
const storage = multer.memoryStorage();

// Only allow image files (jpg, jpeg, png, webp)
const fileFilter = (req, file, cb) => {
  if (
    file.mimetype === "image/jpeg" ||
    file.mimetype === "image/png" ||
    file.mimetype === "image/webp" ||
    file.mimetype === "image/jpg"
  ) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed (jpg, jpeg, png, webp)."), false);
  }
};

const uploadReturnImages = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 5 }, // max 5MB/image, up to 5 images
});

export default uploadReturnImages;