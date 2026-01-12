import { Router } from 'express';
import { requireAuth } from '../../../middlewares/authMiddleware';
import { createLogoController } from '../../../controllers/workflows/branding/createLogoController';

const router = Router();

router.post('/', requireAuth, createLogoController);

export default router;
