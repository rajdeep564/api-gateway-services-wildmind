import { Router } from 'express';
import selfieVideoRoutes from './viraltrend/selfieVideo';
import removeBackgroundRoutes from './general/removeBackground';

const router = Router();

// Selfie Video workflow
router.use('/selfie-video', selfieVideoRoutes);

// General workflows
router.use('/general', removeBackgroundRoutes);

export default router;
