import mongoose from "mongoose";

const carouselSchema = new mongoose.Schema({
    imageUrl: { type: String, required: true },
    caption: { type: String },  // Optional: Add captions for carousel slides
    link: { type: String },     // Optional: Add clickable links for each image
    isActive: { type: Boolean, default: true }  // For controlling visibility
}, { timestamps: true });

const Carousel = mongoose.model("Carousel", carouselSchema);

export default Carousel;
