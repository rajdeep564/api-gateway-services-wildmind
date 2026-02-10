import { Router } from 'express';
import { reimagineProductController } from '../../../controllers/workflows/photography/reimagineProductController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, reimagineProductController);

export default router;
