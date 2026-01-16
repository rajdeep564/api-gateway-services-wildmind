import { Router } from 'express';
import { businessCardController } from '../../../controllers/workflows/photography/businessCardController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, businessCardController);

export default router;
