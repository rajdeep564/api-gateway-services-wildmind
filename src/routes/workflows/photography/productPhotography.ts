import { Router } from 'express';
import { requireAuth } from '../../../middlewares/authMiddleware';
import { productPhotographyController } from '../../../controllers/workflows/photography/productPhotographyController';

const router = Router();

router.post('/', requireAuth, productPhotographyController);

export default router;
