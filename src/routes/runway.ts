import { Router } from 'express';
import { runwayController } from '../controllers/runwayController';
import { validateRunwayTextToImage, validateRunwayStatus, validateRunwayImageToVideo, validateRunwayTextToVideo, validateRunwayVideoToVideo, validateRunwayVideoUpscale } from '../middlewares/validators/runway/validateRunway';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

router.post('/generate', requireAuth, validateRunwayTextToImage, runwayController.textToImage);
router.get('/status/:id', requireAuth, validateRunwayStatus, runwayController.getStatus);
router.post('/video', requireAuth, runwayController.videoGenerate);
// optional granular endpoints if needed later:
// router.post('/image_to_video', validateRunwayImageToVideo, runwayController.imageToVideo)
// router.post('/text_to_video', validateRunwayTextToVideo, runwayController.textToVideo)
// router.post('/video_to_video', validateRunwayVideoToVideo, runwayController.videoToVideo)
// router.post('/video_upscale', validateRunwayVideoUpscale, runwayController.videoUpscale)

export default router;


