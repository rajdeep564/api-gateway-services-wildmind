import express from 'express';
import { deconstructOutfitController } from '../../../controllers/workflows/fashion/deconstructOutfitController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, deconstructOutfitController);

export default router;
