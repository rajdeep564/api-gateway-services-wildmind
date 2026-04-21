import express from 'express';
import { fashionStylistController } from '../../../controllers/workflows/fashion/fashionStylistController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, fashionStylistController);

export default router;
