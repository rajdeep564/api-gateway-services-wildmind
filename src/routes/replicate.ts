import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { creditsRepository } from '../repository/creditsRepository';
import { replicateController } from '../controllers/replicateController';
import { computeReplicateBgRemoveCost, computeReplicateImageGenCost, computeReplicateUpscaleCost } from '../utils/pricing/replicatePricing';
import { computeWanVideoCost } from '../utils/pricing/wanPricing';
import { computeKlingVideoCost } from '../utils/pricing/klingPricing';
import { validateRemoveBg } from '../middlewares/validators/replicate/validateRemoveBg';
import { validateUpscale } from '../middlewares/validators/replicate/validateUpscale';
import { validateReplicateGenerate } from '../middlewares/validators/replicate/validateImageGenerate';
import { validateWan25I2V } from '../middlewares/validators/replicate/validateWan25I2V';
import { validateWan25T2V } from '../middlewares/validators/replicate/validateWan25T2V';
import { validateKlingT2V } from '../middlewares/validators/replicate/validateKlingT2V';
import { validateKlingI2V } from '../middlewares/validators/replicate/validateKlingI2V';

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

export default router;

