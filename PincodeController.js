import asyncHandler from "express-async-handler";
import Pincode from "../models/Pincode.js";
import axios from "axios"; // For third-party API requests

const THIRD_PARTY_API_URL = "https://api.example.com/pincode"; // Replace with actual API

// Validate Pincode with Third-Party API
const validatePincodeWithAPI = async (pincode) => {
    try {
        const response = await axios.get(`${process.env.THIRD_PARTY_API_URL}/${pincode}`);
        return response.data; // Assuming API returns city & state
    } catch (error) {
        return null; // Pincode not found in API
    }
};
// @desc    Get all pincodes
export const getPincodes = asyncHandler(async (req, res) => {
    try {
    const pincodes = await Pincode.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(pincodes);}
    catch (error) {
        res.status(500).json({ success: false, message: "Error fetching pincodes" });
    }

});

// @desc    Add a new pincode (with optional API validation)
// @route   POST /api/admin/pincodes
// @access  Private/Admin
export const addPincode = asyncHandler(async (req, res) => {
    const { pincode } = req.body;

    let apiData = await validatePincodeWithAPI(pincode);
    
    if (!apiData) {
        return res.status(400).json({
            success: false,
            message: "Pincode not found in third-party API. Do you want to add manually?",
        });
    }

    // If API validation succeeds, use API data
    const existingPincode = await Pincode.findOne({ pincode });
    if (existingPincode) {
        return res.status(400).json({ success: false, message: "Pincode already exists" });
    }

    const newPincode = await Pincode.create({
        pincode,
        city: apiData.city,
        state: apiData.state,
    });

    res.status(201).json({ success: true, message: "Pincode added successfully", pincode: newPincode });
});

// @desc    Confirm manual addition of pincode
// @route   POST /api/admin/pincodes/manual
// @access  Private/Admin
export const addPincodeManually = asyncHandler(async (req, res) => {
    const { pincode, city, state } = req.body;

    const existingPincode = await Pincode.findOne({ pincode });
    if (existingPincode) {
        return res.status(400).json({ success: false, message: "Pincode already exists" });
    }

    const newPincode = await Pincode.create({ pincode, city, state });
    res.status(201).json({ success: true, message: "Pincode added manually", pincode: newPincode });
});

// @desc    Delete pincode
// @route   DELETE /api/admin/pincodes/:pincode
// @access  Private/Admin
export const deletePincode = asyncHandler(async (req, res) => {
    const { pincode } = req.params;
    await Pincode.findOneAndDelete({ pincode });

    res.json({ success: true, message: "Pincode deleted" });
});

// @desc    Website Frontend: Validate Pincode
// @route   GET /api/pincodes/:pincode
// @access  Public
export const checkPincode = asyncHandler(async (req, res) => {
    const { pincode } = req.params;

    try {
        let apiData = await validatePincodeWithAPI(pincode);

        if (apiData) {
            return res.json({
                success: true,
                source: "API",
                city: apiData.city,
                state: apiData.state,
                message: `Delivery available in ${apiData.city}, ${apiData.state}.`,
            });
        }

        // Check in the database if API fails
        const storedPincode = await Pincode.findOne({ pincode, isActive: true });

        if (storedPincode) {
            return res.json({
                success: true,
                source: "Stored",
                city: storedPincode.city,
                state: storedPincode.state,
                message: `Delivery available in ${storedPincode.city}, ${storedPincode.state}.`,
            });
        }

        return res.status(404).json({
            success: false,
            message: "Sorry, delivery is not available in your area.",
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Error checking pincode. Please try again later.",
        });
    }
});

