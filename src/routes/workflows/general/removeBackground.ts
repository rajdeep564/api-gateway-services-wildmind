import { Router } from 'express';
import { requireAuth } from '../../../middlewares/authMiddleware';
import * as removeBackgroundController from '../../../controllers/workflows/general/removeBackgroundController';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Remove background endpoint
router.post('/remove-background', removeBackgroundController.removeBackgroundController);

export default router;
