import mongoose from "mongoose";

const pincodeSchema = new mongoose.Schema({
    pincode: { type: String, required: true, unique: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    isActive: { type: Boolean, default: true }, // Enable/Disable Pincode
}, { timestamps: true });

const Pincode = mongoose.model("Pincode", pincodeSchema);
export default Pincode;
