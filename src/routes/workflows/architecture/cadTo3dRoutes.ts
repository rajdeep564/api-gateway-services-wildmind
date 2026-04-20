import express from 'express';
import { cadTo3dController } from '../../../controllers/workflows/architecture/cadTo3dController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, cadTo3dController);

export default router;
