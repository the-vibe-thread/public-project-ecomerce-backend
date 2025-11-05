// routes/preorderRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import Preorder from "../models/preorder.js";
const router = express.Router();

router.post("/", protect, async (req, res) => {
  const { productId, color, size, amount } = req.body;
  if (!productId || !color || !size) return res.status(400).json({ message: "Missing fields" });
  // Optionally: check if user already preordered this product/color/size
  const preorder = new Preorder({
    user: req.user._id,
    product: productId,
    color,
    size,
    amountPaid: amount || 100
  });
  await preorder.save();
  res.status(201).json({ message: "Preorder placed", preorder });
});

export default router;