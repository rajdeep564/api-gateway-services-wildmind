import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { makeCreditCost } from '../middlewares/creditCostFactory';
import { creditsRepository } from '../repository/creditsRepository';
import { replicateController } from '../controllers/replicateController';
import { computeReplicateBgRemoveCost, computeReplicateImageGenCost, computeReplicateUpscaleCost } from '../utils/pricing/replicatePricing';
import { validateRemoveBg, validateReplicateGenerate, validateUpscale } from '../middlewares/validators/replicate/validateRemoveBg';

const router = Router();

// Background removal (Replicate)
router.post(
  '/remove-bg',
  requireAuth,
  validateRemoveBg,
  makeCreditCost('replicate', 'bg-remove', computeReplicateBgRemoveCost),
  async (req, res, next) => {
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

export default router;

// Upscale
router.post(
  '/upscale',
  requireAuth,
  validateUpscale,
  makeCreditCost('replicate', 'upscale', computeReplicateUpscaleCost),
  async (req, res, next) => {
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
  async (req, res, next) => {
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


