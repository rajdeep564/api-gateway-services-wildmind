import express from 'express';
import { rampwalkController } from '../../../controllers/workflows/fashion/rampwalkController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, rampwalkController);

export default router;
