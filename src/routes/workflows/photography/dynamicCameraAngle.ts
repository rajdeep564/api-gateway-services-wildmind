import { Router } from 'express';
import * as dynamicCameraAngleController from '../../../controllers/workflows/photography/dynamicCameraAngleController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, dynamicCameraAngleController.handleDynamicCameraAngle);

export default router;
