import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { creditsRepository } from '../repository/creditsRepository';
import { replicateController } from '../controllers/replicateController';
import { computeReplicateBgRemoveCost, computeReplicateImageGenCost, computeReplicateUpscaleCost } from '../utils/pricing/replicatePricing';
import { computeWanVideoCost } from '../utils/pricing/wanPricing';
import { computeKlingVideoCost } from '../utils/pricing/klingPricing';
import { computeSeedanceVideoCost } from '../utils/pricing/seedancePricing';
import { computePixverseVideoCost } from '../utils/pricing/pixversePricing';
import { validateRemoveBg } from '../middlewares/validators/replicate/validateRemoveBg';
import { validateUpscale } from '../middlewares/validators/replicate/validateUpscale';
import { validateReplicateGenerate } from '../middlewares/validators/replicate/validateImageGenerate';
import { validateWan25I2V } from '../middlewares/validators/replicate/validateWan25I2V';
import { validateWan25T2V } from '../middlewares/validators/replicate/validateWan25T2V';
import { validateKlingT2V } from '../middlewares/validators/replicate/validateKlingT2V';
import { validateKlingI2V } from '../middlewares/validators/replicate/validateKlingI2V';
import { validateSeedanceT2V } from '../middlewares/validators/replicate/validateSeedanceT2V';
import { validateSeedanceI2V } from '../middlewares/validators/replicate/validateSeedanceI2V';
import { validatePixverseT2V } from '../middlewares/validators/replicate/validatePixverseT2V';
import { validatePixverseI2V } from '../middlewares/validators/replicate/validatePixverseI2V';

const router = Router();

// Background removal (Replicate)
router.post(
  '/remove-bg',
  requireAuth,
  validateRemoveBg,
  makeCreditCost('replicate', 'bg-remove', computeReplicateBgRemoveCost),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await replicateController.removeBackground(req, res, next);
      if ((res as any).locals?.success) {
        try {
          const ctx = (req as any).context || {};
          const uid = (req as any).uid;
          const idempotencyKey = ctx.idempotencyKey || `replicate-bg-${Date.now()}`;
          await creditsRepository.writeDebitIfAbsent(uid, idempotencyKey, ctx.creditCost, 'replicate.bg', { pricingVersion: ctx.pricingVersion, ...(ctx.meta || {}) });
        } catch {}
      }
      return result as any;
    } catch (e) {
      next(e);
    }
  }
);

// Upscale (Replicate)
router.post(
  '/upscale',
  requireAuth,
  validateUpscale,
  makeCreditCost('replicate', 'upscale', computeReplicateUpscaleCost),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await replicateController.upscale(req, res, next);
      if ((res as any).locals?.success) {
        try {
          const ctx = (req as any).context || {};
          const uid = (req as any).uid;
          const idempotencyKey = ctx.idempotencyKey || `replicate-up-${Date.now()}`;
          await creditsRepository.writeDebitIfAbsent(uid, idempotencyKey, ctx.creditCost, 'replicate.upscale', { pricingVersion: ctx.pricingVersion, ...(ctx.meta || {}) });
        } catch {}
      }
      return result as any;
    } catch (e) { next(e); }
  }
);

// ============ Queue-style endpoints for Replicate WAN 2.5 ============
// Pre-authorize credits at submit time; actual debit is performed in queue result handler
router.post(
  '/wan-2-5-t2v/submit',
  requireAuth,
  validateWan25T2V,
  makeCreditCost('replicate', 'wan-t2v', computeWanVideoCost),
  replicateController.wanT2vSubmit as any
);

// Explicit FAST alias for WAN 2.5 T2V
router.post(
  '/wan-2-5-t2v/fast/submit',
  requireAuth,
  validateWan25T2V,
  makeCreditCost('replicate', 'wan-t2v', computeWanVideoCost),
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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await replicateController.generateImage(req, res, next);
      if ((res as any).locals?.success) {
        try {
          const ctx = (req as any).context || {};
          const uid = (req as any).uid;
          const idempotencyKey = ctx.idempotencyKey || `replicate-gen-${Date.now()}`;
          await creditsRepository.writeDebitIfAbsent(uid, idempotencyKey, ctx.creditCost, 'replicate.generate', { pricingVersion: ctx.pricingVersion, ...(ctx.meta || {}) });
        } catch {}
      }
      return result as any;
    } catch (e) { next(e); }
  }
);

router.post(
  '/wan-2-5-i2v/submit',
  requireAuth,
  validateWan25I2V,
  makeCreditCost('replicate', 'wan-i2v', computeWanVideoCost),
  replicateController.wanI2vSubmit as any
);

// Explicit FAST alias for WAN 2.5 I2V
router.post(
  '/wan-2-5-i2v/fast/submit',
  requireAuth,
  validateWan25I2V,
  makeCreditCost('replicate', 'wan-i2v', computeWanVideoCost),
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
  (replicateController as any).klingT2vSubmit
);

router.post(
  '/kling-i2v/submit',
  requireAuth,
  validateKlingI2V,
  makeCreditCost('replicate', 'kling-i2v', computeKlingVideoCost),
  (replicateController as any).klingI2vSubmit
);

router.get('/queue/status', requireAuth, replicateController.queueStatus as any);
router.get('/queue/result', requireAuth, replicateController.queueResult as any);

// ============ Queue-style endpoints for Replicate Seedance ============
router.post(
  '/seedance-t2v/submit',
  requireAuth,
  validateSeedanceT2V,
  makeCreditCost('replicate', 'seedance-t2v', computeSeedanceVideoCost),
  (replicateController as any).seedanceT2vSubmit
);

router.post(
  '/seedance-i2v/submit',
  requireAuth,
  validateSeedanceI2V,
  makeCreditCost('replicate', 'seedance-i2v', computeSeedanceVideoCost),
  (replicateController as any).seedanceI2vSubmit
);

// ============ Queue-style endpoints for Replicate PixVerse v5 ============
router.post(
  '/pixverse-v5-t2v/submit',
  requireAuth,
  validatePixverseT2V,
  makeCreditCost('replicate', 'pixverse-t2v', computePixverseVideoCost),
  (replicateController as any).pixverseT2vSubmit
);

router.post(
  '/pixverse-v5-i2v/submit',
  requireAuth,
  validatePixverseI2V,
  makeCreditCost('replicate', 'pixverse-i2v', computePixverseVideoCost),
  (replicateController as any).pixverseI2vSubmit
);

export default router;

