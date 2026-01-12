import { Router } from 'express';
import { mockupGenerationController } from '../../../controllers/workflows/branding/mockupGenerationController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, mockupGenerationController);

export default router;
