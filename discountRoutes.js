import express from "express";
import Discount from "../models/discount.js";
import { protect, protectAdmin, admin } from "../middleware/authMiddleware.js";
import { getIoInstance } from "../socket.js"; // Correctly importing the function

const router = express.Router();

/**
 * ✅ Apply Discount Code (Supports Single & Multiple Products)
 */
router.post("/apply", async (req, res) => {
  try {
    const { code, orderAmount, productSlug, productPrice, cartItems } =
      req.body;

    if (!code)
      return res
        .status(400)
        .json({ success: false, message: "Discount code is required." });

    const discount = await Discount.findOne({ code: code.toUpperCase() });
    if (!discount)
      return res
        .status(400)
        .json({ success: false, message: "Invalid discount code." });

    if (new Date() > discount.expiryDate)
      return res
        .status(400)
        .json({ success: false, message: "Discount code expired." });

    if (discount.usedCount >= discount.usageLimit)
      return res
        .status(400)
        .json({
          success: false,
          message: "Discount code usage limit reached.",
        });

    if (orderAmount < discount.minOrderAmount) {
      return res
        .status(400)
        .json({
          success: false,
          message: `Minimum order amount must be ₹${discount.minOrderAmount}.`,
        });
    }

    // Check if discount applies to any product in the cart
    if (discount.productSlugs.length > 0) {
      const validProductInCart = cartItems.some((item) =>
        discount.productSlugs.includes(item.productSlug)
      );
      if (!validProductInCart) {
        return res
          .status(400)
          .json({
            success: false,
            message: "This discount is not valid for any product in your cart.",
          });
      }
    }

    // Calculate the discount
    let discountAmount = 0;
    if (discount.discountType === "percentage") {
      discountAmount = (orderAmount * discount.discountValue) / 100;
    } else if (discount.discountType === "fixed") {
      discountAmount = discount.discountValue;
    } else if (discount.discountType === "bulk_discount") {
      // Additional logic for bulk discounts based on `minQuantity` in cart items
    }

    // Prevent over-discounting
    discountAmount = Math.min(discountAmount, orderAmount);

    // Track the usage of the discount
    await discount.isAppDiscount(req.user._id); // This method updates usedCount and usersUsed

    // Emit an event to notify admins about discount application
    const io = getIoInstance(); // Get the io instance here
    io.emit("discount-applied", {
      discountCode: discount.code,
      discountAmount,
      appliedAt: new Date(),
    });

    res.json({ success: true, discountAmount });
  } catch (error) {
    console.error("Discount apply error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Server error while applying discount.",
      });
  }
});

/**
 * ✅ Create Discount Code (Supports Single & Multiple Products)
 */
router.post("/create", protectAdmin, admin, async (req, res) => {
  try {
    let {
      code,
      discountType,
      discountValue,
      expiryDate,
      usageLimit,
      minOrderAmount,
      productSlugs,
      minQuantity,
    } = req.body;

    if (!code)
      return res
        .status(400)
        .json({ success: false, message: "Code is required." });

    code = code.toUpperCase();
    const existingCode = await Discount.findOne({ code });
    if (existingCode)
      return res
        .status(400)
        .json({ success: false, message: "Code already exists." });

    if (!discountType)
      return res
        .status(400)
        .json({ success: false, message: "Discount type is required." });

    const newDiscount = new Discount({
      code,
      discountType,
      discountValue,
      expiryDate,
      usageLimit,
      minOrderAmount,
      productSlugs,
      minQuantity,
    });

    await newDiscount.save();

    // Emit an event to notify admins about the new discount creation
    const io = getIoInstance();
    io.emit("discount-created", {
      discountCode: newDiscount.code,
      message: "A new discount code has been created",
    });

    res.json({
      success: true,
      message: "Discount code created successfully.",
      discount: newDiscount,
    });
  } catch (error) {
    console.error("Discount create error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Server error while creating discount.",
      });
  }
});

/**
 * ✅ Get All Discount Codes (Admin Only)
 */
router.get("/all", protectAdmin, admin, async (req, res) => {
  try {
    const discounts = await Discount.find();
    res.json({ success: true, discounts });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * ✅ Delete Discount Code (Admin Only)
 */
router.delete("/delete/:id", protectAdmin, admin, async (req, res) => {
  try {
    await Discount.findByIdAndDelete(req.params.id);

    // Emit an event to notify admins about the discount deletion
    const io = getIoInstance();
    io.emit("discount-deleted", {
      discountId: req.params.id,
      message: "A discount code has been deleted.",
    });

    res.json({ success: true, message: "Discount code deleted." });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * ✅ Update Discount Code (Admin Only, Supports Multiple Products)
 */
router.put("/update/:id", protectAdmin, admin, async (req, res) => {
  try {
    const { productSlugs, minQuantity } = req.body;

    if (productSlugs && !Array.isArray(productSlugs)) {
      req.body.productSlugs = [productSlugs];
    }

    const updatedDiscount = await Discount.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    // Emit an event to notify admins about the discount update
    const io = getIoInstance();
    io.emit("discount-updated", {
      discountCode: updatedDiscount.code,
      message: "A discount code has been updated",
    });

    res.json({ success: true, discount: updatedDiscount });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * ✅ Get Available Discounts (For Users)
 */
router.get("/available",async (req, res) => {
  try {
    const discounts = await Discount.find({
      isActive: true,
      expiryDate: { $gte: new Date() },
    });
    res.json(discounts);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
