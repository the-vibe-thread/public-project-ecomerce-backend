import { Schema, model } from "mongoose";

const galleryVideoSchema = new Schema(
  {
    url: { type: String, required: true },
    filename: { type: String }, // For uploaded files
    // Optionally add more fields like title, description, etc.
  },
  { timestamps: true }
);

export default model("GalleryVideo", galleryVideoSchema);
