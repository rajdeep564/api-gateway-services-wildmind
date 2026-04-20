import express from 'express';
import { fashionModelingPosesController } from '../../../controllers/workflows/fashion/fashionModelingPosesController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, fashionModelingPosesController);

export default router;
