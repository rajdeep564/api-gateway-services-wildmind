import express from 'express';
import { restoreOldPhotoController } from '../../../controllers/workflows/general/restoreOldPhotoController';
import { requireAuth } from '../../../middlewares/authMiddleware';

const router = express.Router();

router.post('/', requireAuth, restoreOldPhotoController);

export default router;
