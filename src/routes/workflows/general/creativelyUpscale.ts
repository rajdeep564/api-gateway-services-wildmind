import { Router } from 'express';
import { requireAuth } from '../../../middlewares/authMiddleware';
import * as creativelyUpscaleController from '../../../controllers/workflows/general/creativelyUpscaleController';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Creatively Upscale endpoint
router.post('/', creativelyUpscaleController.creativelyUpscaleController);

export default router;
