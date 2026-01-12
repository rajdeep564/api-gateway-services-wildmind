import { Router } from 'express';
import { logoVariationsController } from '../../../controllers/workflows/branding/logoVariationsController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, logoVariationsController);

export default router;
