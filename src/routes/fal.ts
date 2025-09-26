import { Router } from 'express';
import  {falController} from '../controllers/falController';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { computeFalImageCost, computeFalVeoI2vSubmitCost, computeFalVeoTtvSubmitCost } from '../utils/pricing/falPricing';
import { validateFalGenerate, validateFalQueueStatus, validateFalVeoTextToVideoSubmit, validateFalVeoTextToVideoFastSubmit, validateFalVeoImageToVideoSubmit, validateFalVeoImageToVideoFastSubmit } from '../middlewares/validators/fal/validateFalGenerate';

const router = Router();

router.post('/generate', requireAuth, validateFalGenerate, makeCreditCost('fal', 'generate', computeFalImageCost), falController.generate);

// Queue style endpoints
router.post('/veo3/text-to-video/submit', requireAuth as any, validateFalVeoTextToVideoSubmit as any, makeCreditCost('fal','veo_t2v_submit', (req)=>computeFalVeoTtvSubmitCost(req,false)) as any, falController.veoTtvSubmit as any);
router.post('/veo3/text-to-video/fast/submit', requireAuth as any, validateFalVeoTextToVideoFastSubmit as any, makeCreditCost('fal','veo_t2v_fast_submit', (req)=>computeFalVeoTtvSubmitCost(req,true)) as any, falController.veoTtvFastSubmit as any);
router.post('/veo3/image-to-video/submit', requireAuth as any, validateFalVeoImageToVideoSubmit as any, makeCreditCost('fal','veo_i2v_submit', (req)=>computeFalVeoI2vSubmitCost(req,false)) as any, falController.veoI2vSubmit as any);
router.post('/veo3/image-to-video/fast/submit', requireAuth as any, validateFalVeoImageToVideoFastSubmit as any, makeCreditCost('fal','veo_i2v_fast_submit', (req)=>computeFalVeoI2vSubmitCost(req,true)) as any, falController.veoI2vFastSubmit as any);
router.get('/queue/status', requireAuth as any, validateFalQueueStatus as any, falController.queueStatus as any);
router.get('/queue/result', requireAuth as any, validateFalQueueStatus as any, falController.queueResult as any);

// NanoBanana queue submit
// Note: NanoBanana uses the unified /fal/generate route; no separate routes needed

export default router;


