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
import expressionSheetRoutes from './photography/expressionSheet';
import poseControlRoutes from './photography/poseControl';
import characterSheetRoutes from './photography/characterSheet';
import productPhotographyRoutes from './photography/productPhotography';
import reimagineProductRoutes from './photography/reimagineProduct';
import automotivePhotographyRoutes from './photography/automotivePhotography';
import createLogoRoutes from './branding/createLogo';
import mockupGenerationRoutes from './branding/mockupGeneration';
import logoVariationsRoutes from './branding/logoVariations';
import businessCardRoutes from './branding/businessCard';

const router = Router();

// Selfie Video workflow
router.use('/selfie-video', selfieVideoRoutes);

// Photography workflows
router.use('/photography/expression-sheet', expressionSheetRoutes);
router.use('/photography/character-sheet', characterSheetRoutes);
router.use('/photography/product-photography', productPhotographyRoutes);
router.use('/photography/reimagine-product', reimagineProductRoutes);
router.use('/photography/automotive', automotivePhotographyRoutes);
router.use('/photography/pose-control', poseControlRoutes);

// Branding workflows
router.use('/branding/create-logo', createLogoRoutes);
router.use('/branding/mockup-generation', mockupGenerationRoutes);
router.use('/branding/logo-variations', logoVariationsRoutes);
router.use('/branding/business-card', businessCardRoutes);

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
