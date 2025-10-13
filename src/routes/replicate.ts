import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { creditsRepository } from '../repository/creditsRepository';
import { replicateController } from '../controllers/replicateController';
import { computeReplicateBgRemoveCost, computeReplicateImageGenCost, computeReplicateUpscaleCost } from '../utils/pricing/replicatePricing';
import { computeWanVideoCost } from '../utils/pricing/wanPricing';
import { validateRemoveBg } from '../middlewares/validators/replicate/validateRemoveBg';
import { validateUpscale } from '../middlewares/validators/replicate/validateUpscale';
import { validateReplicateGenerate } from '../middlewares/validators/replicate/validateImageGenerate';
import { validateWan25I2V } from '../middlewares/validators/replicate/validateWan25I2V';
import { validateWan25T2V } from '../middlewares/validators/replicate/validateWan25T2V';

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

// Wan 2.5 Text-to-Video (Replicate)
router.post(
  '/wan-2-5-t2v',
  requireAuth,
  validateWan25T2V,
  makeCreditCost('replicate', 'wan-t2v', computeWanVideoCost),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await replicateController.wanT2V(req, res, next);
      if ((res as any).locals?.success) {
        try {
          const ctx = (req as any).context || {};
          const uid = (req as any).uid;
          const idempotencyKey = ctx.idempotencyKey || `replicate-wan-t2v-${Date.now()}`;
          await creditsRepository.writeDebitIfAbsent(uid, idempotencyKey, ctx.creditCost, 'replicate.wan-t2v', { pricingVersion: ctx.pricingVersion, ...(ctx.meta || {}) });
        } catch {}
      }
      return result as any;
    } catch (e) { next(e); }
  }
);

export default router;

// Upscale
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

// Wan 2.5 Image-to-Video (Replicate)
router.post(
  '/wan-2-5-i2v',
  requireAuth,
  validateWan25I2V,
  makeCreditCost('replicate', 'wan-i2v', computeWanVideoCost),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await replicateController.wanI2V(req, res, next);
      if ((res as any).locals?.success) {
        try {
          const ctx = (req as any).context || {};
          const uid = (req as any).uid;
          const idempotencyKey = ctx.idempotencyKey || `replicate-wan-i2v-${Date.now()}`;
          await creditsRepository.writeDebitIfAbsent(uid, idempotencyKey, ctx.creditCost, 'replicate.wan-i2v', { pricingVersion: ctx.pricingVersion, ...(ctx.meta || {}) });
        } catch {}
      }
      return result as any;
    } catch (e) { next(e); }
  }
);

// ============ Queue-style endpoints for Replicate WAN 2.5 ============
router.post('/wan-2-5-t2v/submit', requireAuth, validateWan25T2V, replicateController.wanT2vSubmit as any);

router.post('/wan-2-5-i2v/submit', requireAuth, validateWan25I2V, replicateController.wanI2vSubmit as any);

router.get('/queue/status', requireAuth, replicateController.queueStatus as any);

router.get('/queue/result', requireAuth, replicateController.queueResult as any);


