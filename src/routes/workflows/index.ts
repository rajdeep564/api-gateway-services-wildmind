import { Router } from 'express';
import selfieVideoRoutes from './selfieVideo';

const router = Router();

// Selfie Video workflow
router.use('/selfie-video', selfieVideoRoutes);

export default router;
