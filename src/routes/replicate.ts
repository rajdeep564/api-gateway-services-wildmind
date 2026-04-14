import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
// Removed route-level debit writes; controller handles debit via unified helper
import { replicateController, multiangle } from '../controllers/replicateController';
import { computeReplicateBgRemoveCost, computeReplicateImageGenCost, computeReplicateUpscaleCost, computeReplicateMultiangleCost } from '../utils/pricing/replicatePricing';
import { computeQwenImageEditCost } from '../utils/pricing/replicatePricing';
import { computeWanVideoCost } from '../utils/pricing/wanPricing';
import { computeKlingVideoCost, computeKlingLipsyncCost } from '../utils/pricing/klingPricing';
import { computeSeedanceVideoCost } from '../utils/pricing/seedancePricing';
import { computePixverseVideoCost } from '../utils/pricing/pixversePricing';
import { computeLtx23FastVideoCost } from '../utils/pricing/ltx23FastPricing';
import { computeLtx23ProVideoCost } from '../utils/pricing/ltx23ProPricing';
import { validateRemoveBg } from '../middlewares/validators/replicate/validateRemoveBg';
import { validateUpscale } from '../middlewares/validators/replicate/validateUpscale';
import { validateReplicateGenerate } from '../middlewares/validators/replicate/validateImageGenerate';
import { validateWan25I2V } from '../middlewares/validators/replicate/validateWan25I2V';
import { validateWan25T2V } from '../middlewares/validators/replicate/validateWan25T2V';
import { validateKlingT2V } from '../middlewares/validators/replicate/validateKlingT2V';
import { validateKlingI2V } from '../middlewares/validators/replicate/validateKlingI2V';
import { validateKlingLipsync } from '../middlewares/validators/replicate/validateKlingLipsync';
import { validateSeedanceT2V } from '../middlewares/validators/replicate/validateSeedanceT2V';
import { validateSeedanceI2V } from '../middlewares/validators/replicate/validateSeedanceI2V';
import { validateSeedanceProFastT2V } from '../middlewares/validators/replicate/validateSeedanceProFastT2V';
import { validateSeedanceProFastI2V } from '../middlewares/validators/replicate/validateSeedanceProFastI2V';
import { validatePixverseT2V } from '../middlewares/validators/replicate/validatePixverseT2V';
import { validatePixverseI2V } from '../middlewares/validators/replicate/validatePixverseI2V';
import { validateWanAnimateReplace } from '../middlewares/validators/replicate/validateWanAnimateReplace';
import { validateWanAnimateAnimation } from '../middlewares/validators/replicate/validateWanAnimateAnimation';
import { validateLtx23FastT2V } from '../middlewares/validators/replicate/validateLtx23FastT2V';
import { validateLtx23FastI2V } from '../middlewares/validators/replicate/validateLtx23FastI2V';
import { validateLtx23ProT2V } from '../middlewares/validators/replicate/validateLtx23ProT2V';
import { validateLtx23ProI2V } from '../middlewares/validators/replicate/validateLtx23ProI2V';
import { validateStorage } from '../middlewares/validators/validateStorageMiddleware';

console.log('[ReplicateRoutes] Reloading routes...'); // Force refresh log

const router = Router();

// Background removal (Replicate)
router.post(
  '/remove-bg',
  requireAuth,
  validateRemoveBg,
  makeCreditCost('replicate', 'bg-remove', computeReplicateBgRemoveCost),
  validateStorage('image'),
  replicateController.removeBackground as any
);

// Upscale (Replicate)
router.post(
  '/upscale',
  requireAuth,
  validateUpscale,
  makeCreditCost('replicate', 'upscale', computeReplicateUpscaleCost),
  validateStorage('image'),
  replicateController.upscale as any
);

// Multiangle (Replicate)
router.post(
  '/multiangle',
  requireAuth,
  makeCreditCost('replicate', 'multiangle', computeReplicateMultiangleCost),
  multiangle as any
);

// ============ Queue-style endpoints for Replicate WAN 2.5 ============
// Pre-authorize credits at submit time; actual debit is performed in queue result handler
router.post(
  '/wan-2-5-t2v/submit',
  requireAuth,
  validateWan25T2V,
  makeCreditCost('replicate', 'wan-t2v', computeWanVideoCost),
  validateStorage('video'),
  replicateController.wanT2vSubmit as any
);

// Explicit FAST alias for WAN 2.5 T2V
router.post(
  '/wan-2-5-t2v/fast/submit',
  requireAuth,
  validateWan25T2V,
  makeCreditCost('replicate', 'wan-t2v', computeWanVideoCost),
  validateStorage('video'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Force fast mode; prefer explicit -fast slug if not provided
      req.body = {
        ...req.body,
        speed: 'fast',
        model: req.body?.model && String(req.body.model).toLowerCase().includes('fast')
          ? req.body.model
          : 'wan-video/wan-2.5-t2v-fast'
      };
      return (replicateController as any).wanT2vSubmit(req, res, next);
    } catch (e) { next(e); }
  }
);

// Image generate (seedream/ideogram/magic-refiner)
router.post(
  '/generate',
  requireAuth,
  validateReplicateGenerate,
  makeCreditCost('replicate', 'generate', computeReplicateImageGenCost),
  validateStorage('image'),
  replicateController.generateImage as any
);

router.post(
  '/wan-2-5-i2v/submit',
  requireAuth,
  validateWan25I2V,
  makeCreditCost('replicate', 'wan-i2v', computeWanVideoCost),
  validateStorage('video'),
  replicateController.wanI2vSubmit as any
);

// Explicit FAST alias for WAN 2.5 I2V
router.post(
  '/wan-2-5-i2v/fast/submit',
  requireAuth,
  validateWan25I2V,
  makeCreditCost('replicate', 'wan-i2v', computeWanVideoCost),
  validateStorage('video'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Force fast mode; prefer explicit -fast slug if not provided
      req.body = {
        ...req.body,
        speed: 'fast',
        model: req.body?.model && String(req.body.model).toLowerCase().includes('fast')
          ? req.body.model
          : 'wan-video/wan-2.5-i2v-fast'
      };
      return (replicateController as any).wanI2vSubmit(req, res, next);
    } catch (e) { next(e); }
  }
);

// ============ Queue-style endpoints for Replicate Kling models ============
router.post(
  '/kling-t2v/submit',
  requireAuth,
  validateKlingT2V,
  makeCreditCost('replicate', 'kling-t2v', computeKlingVideoCost),
  validateStorage('video'),
  (replicateController as any).klingT2vSubmit
);

router.post(
  '/kling-i2v/submit',
  requireAuth,
  validateKlingI2V,
  makeCreditCost('replicate', 'kling-i2v', computeKlingVideoCost),
  validateStorage('video'),
  (replicateController as any).klingI2vSubmit
);

router.post(
  '/kling-lipsync/submit',
  requireAuth,
  validateKlingLipsync,
  makeCreditCost('replicate', 'kling-lipsync', computeKlingLipsyncCost),
  validateStorage('video'),
  (replicateController as any).klingLipsyncSubmit
);

// ============ Queue-style endpoints for Replicate WAN 2.2 Animate Replace ============
router.post(
  '/wan-2-2-animate-replace/submit',
  requireAuth,
  validateWanAnimateReplace,
  (replicateController as any).wanAnimateReplaceSubmit
);

// ============ Queue-style endpoints for Replicate WAN 2.2 Animate Animation ============
router.post(
  '/wan-2-2-animate-animation/submit',
  requireAuth,
  validateWanAnimateAnimation,
  (replicateController as any).wanAnimateAnimationSubmit
);

router.get('/queue/status', requireAuth, replicateController.queueStatus as any);
router.get('/queue/result', requireAuth, replicateController.queueResult as any);

// ============ Queue-style endpoints for Replicate Seedance ============
router.post(
  '/seedance-t2v/submit',
  requireAuth,
  validateSeedanceT2V,
  makeCreditCost('replicate', 'seedance-t2v', computeSeedanceVideoCost),
  validateStorage('video'),
  (replicateController as any).seedanceT2vSubmit
);

router.post(
  '/seedance-i2v/submit',
  requireAuth,
  validateSeedanceI2V,
  makeCreditCost('replicate', 'seedance-i2v', computeSeedanceVideoCost),
  validateStorage('video'),
  (replicateController as any).seedanceI2vSubmit
);

// ============ Queue-style endpoints for Replicate Seedance Pro Fast ============
router.post(
  '/seedance-pro-fast-t2v/submit',
  requireAuth,
  validateSeedanceProFastT2V,
  makeCreditCost('replicate', 'seedance-pro-fast-t2v', computeSeedanceVideoCost),
  validateStorage('video'),
  (replicateController as any).seedanceProFastT2vSubmit
);

router.post(
  '/seedance-pro-fast-i2v/submit',
  requireAuth,
  validateSeedanceProFastI2V,
  makeCreditCost('replicate', 'seedance-pro-fast-i2v', computeSeedanceVideoCost),
  validateStorage('video'),
  (replicateController as any).seedanceProFastI2vSubmit
);

// ============ Queue-style endpoints for Replicate PixVerse v5 ============
router.post(
  '/pixverse-v5-t2v/submit',
  requireAuth,
  validatePixverseT2V,
  makeCreditCost('replicate', 'pixverse-t2v', computePixverseVideoCost),
  validateStorage('video'),
  (replicateController as any).pixverseT2vSubmit
);

router.post(
  '/pixverse-v5-i2v/submit',
  requireAuth,
  validatePixverseI2V,
  makeCreditCost('replicate', 'pixverse-i2v', computePixverseVideoCost),
  validateStorage('video'),
  (replicateController as any).pixverseI2vSubmit
);

// Qwen image edit (Replicate qwen/qwen-image-edit-2511)
router.post(
  '/qwen-image-edit/submit',
  requireAuth,
  validateReplicateGenerate,
  makeCreditCost('replicate', 'qwen-image-edit', computeQwenImageEditCost),
  validateStorage('image'),
  (replicateController as any).qwenImageEditSubmit
);

// ============ Queue-style endpoints for Replicate LTX 2.3 Fast ============
router.post(
  '/ltx-2-3-fast-t2v/submit',
  requireAuth,
  validateLtx23FastT2V,
  makeCreditCost('replicate', 'ltx-2.3-fast-t2v', computeLtx23FastVideoCost),
  validateStorage('video'),
  (replicateController as any).ltx23FastT2vSubmit
);

router.post(
  '/ltx-2-3-fast-i2v/submit',
  requireAuth,
  validateLtx23FastI2V,
  makeCreditCost('replicate', 'ltx-2.3-fast-i2v', computeLtx23FastVideoCost),
  validateStorage('video'),
  (replicateController as any).ltx23FastI2vSubmit
);

// ============ Queue-style endpoints for Replicate LTX 2.3 Pro ============
router.post(
  '/ltx-2-3-pro-t2v/submit',
  requireAuth,
  validateLtx23ProT2V,
  makeCreditCost('replicate', 'ltx-2.3-pro-t2v', computeLtx23ProVideoCost),
  validateStorage('video'),
  (replicateController as any).ltx23ProT2vSubmit
);

router.post(
  '/ltx-2-3-pro-i2v/submit',
  requireAuth,
  validateLtx23ProI2V,
  makeCreditCost('replicate', 'ltx-2.3-pro-i2v', computeLtx23ProVideoCost),
  validateStorage('video'),
  (replicateController as any).ltx23ProI2vSubmit
);

export default router;

