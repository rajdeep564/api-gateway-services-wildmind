"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const creditCostFactory_1 = require("../middlewares/creditCostFactory");
const creditsRepository_1 = require("../repository/creditsRepository");
const replicateController_1 = require("../controllers/replicateController");
const replicatePricing_1 = require("../utils/pricing/replicatePricing");
const wanPricing_1 = require("../utils/pricing/wanPricing");
const validateRemoveBg_1 = require("../middlewares/validators/replicate/validateRemoveBg");
const validateUpscale_1 = require("../middlewares/validators/replicate/validateUpscale");
const validateImageGenerate_1 = require("../middlewares/validators/replicate/validateImageGenerate");
const validateWan25I2V_1 = require("../middlewares/validators/replicate/validateWan25I2V");
const validateWan25T2V_1 = require("../middlewares/validators/replicate/validateWan25T2V");
const router = (0, express_1.Router)();
// Background removal (Replicate)
router.post('/remove-bg', authMiddleware_1.requireAuth, validateRemoveBg_1.validateRemoveBg, (0, creditCostFactory_1.makeCreditCost)('replicate', 'bg-remove', replicatePricing_1.computeReplicateBgRemoveCost), async (req, res, next) => {
    try {
        const result = await replicateController_1.replicateController.removeBackground(req, res, next);
        if (res.locals?.success) {
            try {
                const ctx = req.context || {};
                const uid = req.uid;
                const idempotencyKey = ctx.idempotencyKey || `replicate-bg-${Date.now()}`;
                await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, idempotencyKey, ctx.creditCost, 'replicate.bg', { pricingVersion: ctx.pricingVersion, ...(ctx.meta || {}) });
            }
            catch { }
        }
        return result;
    }
    catch (e) {
        next(e);
    }
});
// Wan 2.5 Text-to-Video (Replicate)
router.post('/wan-2-5-t2v', authMiddleware_1.requireAuth, validateWan25T2V_1.validateWan25T2V, (0, creditCostFactory_1.makeCreditCost)('replicate', 'wan-t2v', wanPricing_1.computeWanVideoCost), async (req, res, next) => {
    try {
        const result = await replicateController_1.replicateController.wanT2V(req, res, next);
        if (res.locals?.success) {
            try {
                const ctx = req.context || {};
                const uid = req.uid;
                const idempotencyKey = ctx.idempotencyKey || `replicate-wan-t2v-${Date.now()}`;
                await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, idempotencyKey, ctx.creditCost, 'replicate.wan-t2v', { pricingVersion: ctx.pricingVersion, ...(ctx.meta || {}) });
            }
            catch { }
        }
        return result;
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
// Upscale
router.post('/upscale', authMiddleware_1.requireAuth, validateUpscale_1.validateUpscale, (0, creditCostFactory_1.makeCreditCost)('replicate', 'upscale', replicatePricing_1.computeReplicateUpscaleCost), async (req, res, next) => {
    try {
        const result = await replicateController_1.replicateController.upscale(req, res, next);
        if (res.locals?.success) {
            try {
                const ctx = req.context || {};
                const uid = req.uid;
                const idempotencyKey = ctx.idempotencyKey || `replicate-up-${Date.now()}`;
                await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, idempotencyKey, ctx.creditCost, 'replicate.upscale', { pricingVersion: ctx.pricingVersion, ...(ctx.meta || {}) });
            }
            catch { }
        }
        return result;
    }
    catch (e) {
        next(e);
    }
});
// Image generate (seedream/ideogram/magic-refiner)
router.post('/generate', authMiddleware_1.requireAuth, validateImageGenerate_1.validateReplicateGenerate, (0, creditCostFactory_1.makeCreditCost)('replicate', 'generate', replicatePricing_1.computeReplicateImageGenCost), async (req, res, next) => {
    try {
        const result = await replicateController_1.replicateController.generateImage(req, res, next);
        if (res.locals?.success) {
            try {
                const ctx = req.context || {};
                const uid = req.uid;
                const idempotencyKey = ctx.idempotencyKey || `replicate-gen-${Date.now()}`;
                await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, idempotencyKey, ctx.creditCost, 'replicate.generate', { pricingVersion: ctx.pricingVersion, ...(ctx.meta || {}) });
            }
            catch { }
        }
        return result;
    }
    catch (e) {
        next(e);
    }
});
// Wan 2.5 Image-to-Video (Replicate)
router.post('/wan-2-5-i2v', authMiddleware_1.requireAuth, validateWan25I2V_1.validateWan25I2V, (0, creditCostFactory_1.makeCreditCost)('replicate', 'wan-i2v', wanPricing_1.computeWanVideoCost), async (req, res, next) => {
    try {
        const result = await replicateController_1.replicateController.wanI2V(req, res, next);
        if (res.locals?.success) {
            try {
                const ctx = req.context || {};
                const uid = req.uid;
                const idempotencyKey = ctx.idempotencyKey || `replicate-wan-i2v-${Date.now()}`;
                await creditsRepository_1.creditsRepository.writeDebitIfAbsent(uid, idempotencyKey, ctx.creditCost, 'replicate.wan-i2v', { pricingVersion: ctx.pricingVersion, ...(ctx.meta || {}) });
            }
            catch { }
        }
        return result;
    }
    catch (e) {
        next(e);
    }
});
