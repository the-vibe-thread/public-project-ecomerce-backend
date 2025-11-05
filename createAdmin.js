import mongoose from "mongoose";
import Admin from "./models/admin.js";
import dotenv from "dotenv";

dotenv.config();

// ✅ Ensure environment variables are loaded
if (!process.env.MONGO_URI) {
  console.error("❌ MONGO_URI or DB_NAME is missing in .env file.");
  process.exit(1); // Exit the script
}

const mongoURI = `${process.env.MONGO_URI}`;

console.log("Connecting to:", mongoURI); // Debugging output

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ Connected to MongoDB",mongoURI))
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });

const createAdmin = async () => {
  try {
    const adminExists = await Admin.findOne({ email: "admin@example.com" });

    if (adminExists) {
      console.log("⚠️ Admin already exists.");
      mongoose.connection.close();
      return;
    }

    const admin = new Admin({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD, // Will be hashed before saving
    });

    await admin.save();
    console.log("✅ Admin created successfully.");
  } catch (error) {
    console.error("❌ Error creating admin:", error);
  } finally {
    mongoose.connection.close();
    console.log("🔌 Database connection closed.");
  }
};

createAdmin();
