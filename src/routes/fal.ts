import { Router } from 'express';
import  {falController} from '../controllers/falController';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateFalGenerate, validateFalQueueStatus, validateFalVeoTextToVideoSubmit, validateFalVeoTextToVideoFastSubmit, validateFalVeoImageToVideoSubmit, validateFalVeoImageToVideoFastSubmit } from '../middlewares/validators/fal/validateFalGenerate';

const router = Router();

router.post('/generate', requireAuth, validateFalGenerate, falController.generate);

// Queue style endpoints
router.post('/veo3/text-to-video/submit', requireAuth as any, validateFalVeoTextToVideoSubmit as any, falController.veoTtvSubmit as any);
router.post('/veo3/text-to-video/fast/submit', requireAuth as any, validateFalVeoTextToVideoFastSubmit as any, falController.veoTtvFastSubmit as any);
router.post('/veo3/image-to-video/submit', requireAuth as any, validateFalVeoImageToVideoSubmit as any, falController.veoI2vSubmit as any);
router.post('/veo3/image-to-video/fast/submit', requireAuth as any, validateFalVeoImageToVideoFastSubmit as any, falController.veoI2vFastSubmit as any);
router.get('/queue/status', requireAuth as any, validateFalQueueStatus as any, falController.queueStatus as any);
router.get('/queue/result', requireAuth as any, validateFalQueueStatus as any, falController.queueResult as any);

// NanoBanana queue submit
// Note: NanoBanana uses the unified /fal/generate route; no separate routes needed

export default router;


