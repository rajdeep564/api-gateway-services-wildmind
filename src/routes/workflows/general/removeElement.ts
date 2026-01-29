import express from 'express';
import { removeElementController } from '../../../controllers/workflows/general/removeElementController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, removeElementController);

export default router;
