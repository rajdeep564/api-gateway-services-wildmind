import { Router } from 'express';
import selfieVideoRoutes from './viraltrend/selfieVideo';
import removeBackgroundRoutes from './general/removeBackground';
import restoreOldPhotoRoutes from './general/restoreOldPhoto';
import photoToLineDrawingRoutes from './general/photoToLineDrawing';
import lineDrawingToPhotoRoutes from './general/lineDrawingToPhoto';
import removeElementRoutes from './general/removeElement';
import removeWatermarkRoutes from './general/removeWatermark';
import becomeCelebrityRoutes from './fun/becomeCelebrity';

const router = Router();

// Selfie Video workflow
router.use('/selfie-video', selfieVideoRoutes);

// General workflows
// removeBackgroundRoutes defines: router.post('/remove-background', ...)
// restoreOldPhotoRoutes defines: router.post('/', ...)
// photoToLineDrawingRoutes defines: router.post('/', ...)
// lineDrawingToPhotoRoutes defines: router.post('/', ...)
// removeElementRoutes defines: router.post('/', ...)
// removeWatermarkRoutes defines: router.post('/', ...)
router.use('/general', removeBackgroundRoutes);
router.use('/general/restore-old-photo', restoreOldPhotoRoutes);
router.use('/general/photo-to-line-drawing', photoToLineDrawingRoutes);
router.use('/general/line-drawing-to-photo', lineDrawingToPhotoRoutes);
router.use('/general/remove-element', removeElementRoutes);
router.use('/general/remove-watermark', removeWatermarkRoutes);

// Fun workflows
router.use('/fun/become-celebrity', becomeCelebrityRoutes);

export default router;
