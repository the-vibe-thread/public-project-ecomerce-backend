import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const AdminSchema = new mongoose.Schema(
  {
    email: { 
      type: String, 
      required: true, 
      unique: true, // ✅ This is enough
      lowercase: true, 
      trim: true 
    },
    password: { 
      type: String, 
      required: true, 
      select: false 
    },
    isAdmin: { 
      type: Boolean, 
      default: true 
    },
    role: { 
      type: String, 
      enum: ["admin", "superadmin"], 
      default: "admin",
      lowercase: true,
      trim: true
    }
  },
  { timestamps: true }
);

// ❌ REMOVE this duplicate index (Not needed)
// AdminSchema.index({ email: 1 }, { unique: true });

// Hash password before saving
AdminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(12); // Stronger encryption
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare passwords
AdminSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

const Admin = mongoose.model("Admin", AdminSchema);
export default Admin;
