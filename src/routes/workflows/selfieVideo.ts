import { Router } from 'express';
import { requireAuth } from '../../middlewares/authMiddleware';
import * as selfieVideoController from '../../controllers/workflows/selfieVideoController';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Generate image for selfie video workflow
router.post('/generate-image', selfieVideoController.generateImage);

export default router;
