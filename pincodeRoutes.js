import express from "express";
import {
    addPincode,
    addPincodeManually,
    deletePincode,
    checkPincode,
    getPincodes,
} from "../controllers/PincodeController.js";
import { protectAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protectAdmin, getPincodes);
router.post("/", protectAdmin, addPincode);
router.post("/manual", protectAdmin, addPincodeManually);
router.delete("/:pincode", protectAdmin, deletePincode);
router.get("/:pincode", checkPincode);

export default router;
