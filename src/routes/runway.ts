import { Router } from 'express';
import { runwayController } from '../controllers/runwayController';
import { validateRunwayTextToImage, validateRunwayStatus, validateRunwayImageToVideo, validateRunwayTextToVideo, validateRunwayVideoToVideo, validateRunwayVideoUpscale, validateRunwayCharacterPerformance } from '../middlewares/validators/runway/validateRunway';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { computeRunwayImageCost, computeRunwayVideoCost } from '../utils/pricing/runwayPricing';

const router = Router();

router.post('/generate', requireAuth, validateRunwayTextToImage, makeCreditCost('runway','generate', computeRunwayImageCost), runwayController.textToImage);
router.get('/status/:id', requireAuth, validateRunwayStatus, runwayController.getStatus);
router.post('/video', requireAuth, makeCreditCost('runway','video', computeRunwayVideoCost), runwayController.videoGenerate);
router.post('/character-performance', requireAuth, validateRunwayCharacterPerformance, makeCreditCost('runway','video', computeRunwayVideoCost), runwayController.characterPerformance);
// optional granular endpoints if needed later:
// router.post('/image_to_video', validateRunwayImageToVideo, runwayController.imageToVideo)
// router.post('/text_to_video', validateRunwayTextToVideo, runwayController.textToVideo)
// router.post('/video_to_video', validateRunwayVideoToVideo, runwayController.videoToVideo)
// router.post('/video_upscale', validateRunwayVideoUpscale, runwayController.videoUpscale)

export default router;


