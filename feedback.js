// models/feedbackModel.js
import { Schema, model } from 'mongoose';

// Feedback Schema
const feedbackSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    message: { type: String, required: true },
  },
  { timestamps: true } // Automatically adds createdAt and updatedAt
);

// Export the Feedback model
export default model('Feedback', feedbackSchema);
