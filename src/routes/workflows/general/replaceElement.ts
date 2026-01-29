import { Router } from 'express';
import { replaceElementController } from '../../../controllers/workflows/general/replaceElementController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

// POST /api/workflows/general/replace-element/
router.post('/', requireAuth, replaceElementController);

export default router;
