import express from 'express';
import { hairStyleController } from '../../../controllers/workflows/fashion/hairStyleController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, hairStyleController);

export default router;
