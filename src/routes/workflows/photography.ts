import express from 'express';
import { reimagineProductController } from '../../../controllers/workflows/photography/reimagineProductController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/reimagine-product', requireAuth, reimagineProductController);

export default router;
