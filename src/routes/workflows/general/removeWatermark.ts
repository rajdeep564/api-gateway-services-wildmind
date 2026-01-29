import express from 'express';
import { removeWatermarkController } from '../../../controllers/workflows/general/removeWatermarkController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, removeWatermarkController);

export default router;
