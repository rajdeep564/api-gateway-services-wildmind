import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import * as queueController from '../controllers/queueController';

const router = Router();

// Add generation to queue
router.post('/add', requireAuth, queueController.addToQueue);

// Get queue item status
router.get('/status/:queueId', requireAuth, queueController.getQueueStatus);

// Get user's queue list
router.get('/list', requireAuth, queueController.getQueueList);

// Cancel queue item
router.post('/cancel/:queueId', requireAuth, queueController.cancelQueueItem);

// Deduct credits for queue item (frontend sync)
router.post('/deduct-credits', requireAuth, queueController.deductCreditsForQueue);

// Refund credits for queue item (frontend sync)
router.post('/refund-credits', requireAuth, queueController.refundCreditsForQueue);

export default router;

