import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import * as subscriptionsController from '../controllers/subscriptionsController';

const router = Router();

// All subscription routes require authentication
router.use(requireAuth);

// Create subscription
router.post('/create', subscriptionsController.createSubscription);

// Get current subscription
router.get('/current', subscriptionsController.getCurrentSubscription);

// Cancel subscription
router.post('/cancel', subscriptionsController.cancelSubscription);

// Change plan
router.post('/change-plan', subscriptionsController.changePlan);

// Verify payment (optional - for embedded modal)
router.post('/verify-payment', subscriptionsController.verifyPayment);

// Check expiry (Admin/Cron) - Ensure this is protected by appropriate roles in prod
router.post('/check-expiry', subscriptionsController.checkExpiry);

export default router;
