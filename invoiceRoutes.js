import express from "express";
import { protectAdmin ,protect } from "../middleware/authMiddleware.js";
import {
  downloadOrderInvoice,        // Single order invoice PDF (user)
  downloadBulkAdminInvoices,   // Bulk invoice ZIP (admin)
} from "../controllers/invoiceController.js";

const router = express.Router();

// Single invoice PDF for user
router.get("/:id", protect, downloadOrderInvoice);


// Bulk invoice ZIP for admin (with filters)
router.get("/admin/bulk", protectAdmin, downloadBulkAdminInvoices);

export default router;