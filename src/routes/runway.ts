import { Router } from 'express';
import { runwayController } from '../controllers/runwayController';
import { validateRunwayTextToImage, validateRunwayStatus, validateRunwayImageToVideo, validateRunwayTextToVideo, validateRunwayVideoToVideo, validateRunwayVideoUpscale } from '../middlewares/validators/runway/validateRunway';

const router = Router();

router.post('/generate', validateRunwayTextToImage, runwayController.textToImage);
router.get('/status/:id', validateRunwayStatus, runwayController.getStatus);
router.post('/video', runwayController.videoGenerate);
// optional granular endpoints if needed later:
// router.post('/image_to_video', validateRunwayImageToVideo, runwayController.imageToVideo)
// router.post('/text_to_video', validateRunwayTextToVideo, runwayController.textToVideo)
// router.post('/video_to_video', validateRunwayVideoToVideo, runwayController.videoToVideo)
// router.post('/video_upscale', validateRunwayVideoUpscale, runwayController.videoUpscale)

export default router;


