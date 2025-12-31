import express from 'express';
import { lineDrawingToPhotoController } from '../../../controllers/workflows/general/lineDrawingToPhotoController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, lineDrawingToPhotoController);

export default router;
