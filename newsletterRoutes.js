import express from "express";
import mongoose from "mongoose";

const router = express.Router();

const newsletterSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  subscribedAt: { type: Date, default: Date.now },
});

const NewsletterSubscriber = mongoose.model("NewsletterSubscriber", newsletterSchema);

router.post("/subscribe", async (req, res) => {
  const { email } = req.body;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ message: "Invalid email address." });
  }
  try {
    const existing = await NewsletterSubscriber.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Email already subscribed." });
    }
    await NewsletterSubscriber.create({ email });
    res.status(201).json({ message: "Subscribed successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Server error." });
  }
});

export default router;