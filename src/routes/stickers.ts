import { Router } from 'express';
import { exportStickers } from '../controllers/stickerExportController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

// Export stickers to WhatsApp-ready formats
router.post('/export', requireAuth as any, exportStickers as any);

export default router;


