import { Router } from 'express';
import { requireAuth } from '../../../middlewares/authMiddleware';
import { poseControlController } from '../../../controllers/workflows/photography/poseControlController';

const router = Router();

router.post('/', requireAuth, poseControlController);

export default router;
