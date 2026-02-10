import { Router } from 'express';
import { famousPhotographerController } from '../../../controllers/workflows/photography/famousPhotographerController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, famousPhotographerController);

export default router;
