import express from "express";
import {
  getShippingCost,
  updateShippingCost,
  getAdminShippingCost,
} from "../controllers/shippingController.js";
import { protectAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", getShippingCost);               // Public API
router.get("/shipping", protectAdmin, getAdminShippingCost); // Admin API to view current settings
router.put("/", protectAdmin, updateShippingCost);        // Admin API to update settings

export default router;
