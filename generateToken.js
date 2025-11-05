import jwt from "jsonwebtoken";

/**
 * Generate a JWT token for authentication
 * @param {string} userId - The user's unique ID from the database
 * @param {string} role - The user's role (e.g., "user", "admin")
 * @returns {string} - Signed JWT token
 */
const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role }, // Include role for role-based access control
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRY || "7d", // Expiry from .env, default 7 days
      algorithm: "HS256", // Secure signing algorithm
    }
  );
};

export default generateToken;
