// controllers/feedbackController.js
import Feedback from '../models/feedback.js';

// Handle creating feedback
export const createFeedback = async (req, res) => {
  const { name, email, message } = req.body;

  // Validate the input data
  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: "All fields are required" });
  }

  try {
    // Create and save new feedback to the database
    const newFeedback = new Feedback({ name, email, message });
    await newFeedback.save();

    // Send response to the client
    return res.status(201).json({ success: true, message: "Feedback submitted successfully!" });
  } catch (error) {
    console.error("Error saving feedback:", error);
    return res.status(500).json({ success: false, message: "Error submitting feedback" });
  }
};
// Fetch all feedback
export const getAllFeedback = async (req, res) => {
  try {
    const feedbacks = await Feedback.find();
    res.status(200).json({ success: true, feedbacks });
  } catch (error) {
    console.error("Error fetching feedbacks:", error);
    res.status(500).json({ success: false, message: "Error fetching feedbacks" });
  }
};

// Delete a specific feedback
export const deleteFeedback = async (req, res) => {
  const { id } = req.params;

  try {
    const feedback = await Feedback.findByIdAndDelete(id);
    if (!feedback) {
      return res.status(404).json({ success: false, message: "Feedback not found" });
    }

    res.status(200).json({ success: true, message: "Feedback deleted successfully" });
  } catch (error) {
    console.error("Error deleting feedback:", error);
    res.status(500).json({ success: false, message: "Error deleting feedback" });
  }
};

