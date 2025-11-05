import asyncHandler from "express-async-handler";
import ShippingCost from "../models/shippingCost.js";

// @desc    Get Shipping Cost
// @route   GET /api/shipping-cost
// @access  Public
export const getShippingCost = asyncHandler(async (req, res) => {
  const { orderValue } = req.query; // Order value for tiered logic
  const shipping = await ShippingCost.findOne();

  if (!shipping) {
    return res.json({ shippingCost: 0 });
  }

  // Free Shipping Logic
  if (orderValue >= shipping.freeShippingThreshold) {
    return res.json({ shippingCost: 0 });
  }

  // Tiered Cost Logic
  const tieredCost = shipping.tieredCosts
    .filter((tier) => orderValue >= tier.minOrderValue)
    .sort((a, b) => b.minOrderValue - a.minOrderValue)[0]; // Highest eligible tier

  const finalShippingCost = tieredCost
    ? tieredCost.shippingCost
    : shipping.baseCost;

  // Ensure final cost falls within min & max limits
  const calculatedCost = Math.max(shipping.minCost, Math.min(finalShippingCost, shipping.maxCost));

  res.json({ shippingCost: calculatedCost });
});

// @desc    Update or Insert Shipping Cost
// @route   PUT /api/admin/shipping-cost
// @access  Private/Admin
export const updateShippingCost = asyncHandler(async (req, res) => {
  const { baseCost, minCost, maxCost, freeShippingThreshold, tieredCosts } = req.body;

  let shipping = await ShippingCost.findOne();

  if (!shipping) {
    // If no shipping cost exists, create a new entry
    shipping = new ShippingCost({
      baseCost,
      minCost,
      maxCost,
      freeShippingThreshold,
      tieredCosts,
    });
  } else {
    // Update existing shipping cost
    shipping.baseCost = baseCost !== undefined ? baseCost : shipping.baseCost;
    shipping.minCost = minCost !== undefined ? minCost : shipping.minCost;
    shipping.maxCost = maxCost !== undefined ? maxCost : shipping.maxCost;
    shipping.freeShippingThreshold =
      freeShippingThreshold !== undefined
        ? freeShippingThreshold
        : shipping.freeShippingThreshold;
    shipping.tieredCosts = tieredCosts !== undefined ? tieredCosts : shipping.tieredCosts;
  }

  await shipping.save();
  res.json({ success: true, message: "Shipping cost updated successfully" });
});

// @desc    Get Current Shipping Cost (Admin View)
// @route   GET /api/admin/shipping-cost
// @access  Private/Admin
export const getAdminShippingCost = asyncHandler(async (req, res) => {
  const shipping = await ShippingCost.findOne();

  if (!shipping) {
    return res.status(200).json({
      baseCost: 0,
      minCost: 0,
      maxCost: 0,
      freeShippingThreshold: 0,
      tieredCosts: [],
      message: "No shipping cost set yet. Please add a new shipping cost.",
    });
  }

  res.json({
    baseCost: shipping.baseCost,
    minCost: shipping.minCost,
    maxCost: shipping.maxCost,
    freeShippingThreshold: shipping.freeShippingThreshold,
    tieredCosts: shipping.tieredCosts,
  });
});
