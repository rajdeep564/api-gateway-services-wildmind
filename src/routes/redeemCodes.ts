import { Router } from 'express';
import { redeemCodeController } from '../controllers/redeemCodeController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

// Apply redeem code (requires authentication)
router.post('/apply', requireAuth, redeemCodeController.applyRedeemCode);

// Validate redeem code (public endpoint)
router.post('/validate', redeemCodeController.validateRedeemCode);


// Create redeem codes (admin function)
router.post('/create', redeemCodeController.createRedeemCodes);

export default router;
