// routes/feedbackRoutes.js
import express from 'express';
import { createFeedback, getAllFeedback, deleteFeedback } from '../controllers/feedbackController.js';
import { protectAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// POST route to submit feedback
router.post('/', createFeedback);

// GET route to fetch all feedback
router.get('/',protectAdmin, getAllFeedback);

// DELETE route to delete feedback
router.delete('/:id',protectAdmin, deleteFeedback);

export default router;
