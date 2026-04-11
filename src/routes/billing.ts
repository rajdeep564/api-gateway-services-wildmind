
import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { billingController } from '../controllers/billingController';

const router = Router();

// Billing summary (plan/credits/storage/subscription)
router.get('/summary', requireAuth, billingController.getBillingSummary);

// Invoices
router.get('/invoices', requireAuth, billingController.getUserInvoices);
router.get('/invoices/:invoiceId', requireAuth, billingController.getInvoiceDetail);

// Payment History
router.get('/payments', requireAuth, billingController.getPaymentHistory);

router.get(
  '/invoices/:invoiceId/pdf',
  requireAuth,
  billingController.downloadInvoicePdf,
);

router.post(
  '/validate-gstin',
  requireAuth,
  billingController.validateGSTIN,
);

export default router;
