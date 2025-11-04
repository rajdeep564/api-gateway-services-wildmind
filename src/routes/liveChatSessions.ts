import { Router } from 'express';
import { liveChatSessionController } from '../controllers/liveChatSessionController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Create a new session
router.post('/', liveChatSessionController.create);

// Find or create session by sessionId
router.post('/find-or-create', liveChatSessionController.findOrCreate);

// List all sessions for current user
router.get('/', liveChatSessionController.list);

// Get session by image URL (for restoring sessions when clicking on images)
router.get('/by-image-url', liveChatSessionController.getByImageUrl);

// Get session by document ID
router.get('/:sessionDocId', liveChatSessionController.get);

// Update session
router.patch('/:sessionDocId', liveChatSessionController.update);

// Add message to session
router.post('/:sessionDocId/messages', liveChatSessionController.addMessage);

// Complete session
router.patch('/:sessionDocId/complete', liveChatSessionController.complete);

export default router;

