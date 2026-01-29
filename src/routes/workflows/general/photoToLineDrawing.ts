import express from 'express';
import { photoToLineDrawingController } from '../../../controllers/workflows/general/photoToLineDrawingController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, photoToLineDrawingController);

export default router;
