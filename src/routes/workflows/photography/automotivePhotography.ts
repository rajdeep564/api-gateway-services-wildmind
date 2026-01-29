import { Router } from 'express';
import { automotivePhotographyController } from '../../../controllers/workflows/photography/automotivePhotographyController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = Router();

router.post('/', requireAuth, automotivePhotographyController);

export default router;
