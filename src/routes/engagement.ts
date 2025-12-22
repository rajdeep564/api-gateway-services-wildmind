import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { engagementController } from '../controllers/engagementController';

const router = Router();

// Toggle like
router.post('/like', requireAuth as any, engagementController.toggleLike as any);

// Toggle bookmark
router.post('/bookmark', requireAuth as any, engagementController.toggleBookmark as any);

// Bulk status for a set of generation IDs (likes/bookmarks + counts)
router.post('/bulk-status', requireAuth as any, engagementController.bulkStatus as any);

// Current user's liked generations (IDs + timestamps)
router.get('/me/likes', requireAuth as any, engagementController.listMyLikes as any);

// Current user's bookmarked generations
router.get('/me/bookmarks', requireAuth as any, engagementController.listMyBookmarks as any);

export default router;


