import { Router } from 'express';
import selfieVideoRoutes from './viraltrend/selfieVideo';
import removeBackgroundRoutes from './general/removeBackground';
import restoreOldPhotoRoutes from './general/restoreOldPhoto';
import photoToLineDrawingRoutes from './general/photoToLineDrawing';
import lineDrawingToPhotoRoutes from './general/lineDrawingToPhoto';
import removeElementRoutes from './general/removeElement';
import removeWatermarkRoutes from './general/removeWatermark';
import creativelyUpscaleRoutes from './general/creativelyUpscale';
import becomeCelebrityRoutes from './fun/becomeCelebrity';
import replaceElementRoutes from './general/replaceElement';

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
router.use('/general/creatively-upscale', creativelyUpscaleRoutes);
router.use('/general/replace-element', replaceElementRoutes);

// Fun workflows
router.use('/fun/become-celebrity', becomeCelebrityRoutes);

export default router;
