import express from 'express';
import { makeupController } from '../../../controllers/workflows/fashion/makeupController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, makeupController);

export default router;
