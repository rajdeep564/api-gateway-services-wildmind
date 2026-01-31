
import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { billingController } from '../controllers/billingController';

const router = Router();

// Invoices
router.get('/invoices', requireAuth, billingController.getUserInvoices);

// Payment History
router.get('/payments', requireAuth, billingController.getPaymentHistory);

export default router;
