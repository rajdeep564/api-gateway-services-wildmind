"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const creditCostFactory_1 = require("../middlewares/creditCostFactory");
const creditsRepository_1 = require("../repository/creditsRepository");
const replicateController_1 = require("../controllers/replicateController");
const replicatePricing_1 = require("../utils/pricing/replicatePricing");
const wanPricing_1 = require("../utils/pricing/wanPricing");
const klingPricing_1 = require("../utils/pricing/klingPricing");
const validateRemoveBg_1 = require("../middlewares/validators/replicate/validateRemoveBg");
const validateUpscale_1 = require("../middlewares/validators/replicate/validateUpscale");
const validateImageGenerate_1 = require("../middlewares/validators/replicate/validateImageGenerate");
const validateWan25I2V_1 = require("../middlewares/validators/replicate/validateWan25I2V");
const validateWan25T2V_1 = require("../middlewares/validators/replicate/validateWan25T2V");
const validateKlingT2V_1 = require("../middlewares/validators/replicate/validateKlingT2V");
const validateKlingI2V_1 = require("../middlewares/validators/replicate/validateKlingI2V");
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
// Upscale (Replicate)
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
// ============ Queue-style endpoints for Replicate WAN 2.5 ============
// Pre-authorize credits at submit time; actual debit is performed in queue result handler
router.post('/wan-2-5-t2v/submit', authMiddleware_1.requireAuth, validateWan25T2V_1.validateWan25T2V, (0, creditCostFactory_1.makeCreditCost)('replicate', 'wan-t2v', wanPricing_1.computeWanVideoCost), replicateController_1.replicateController.wanT2vSubmit);
// Explicit FAST alias for WAN 2.5 T2V
router.post('/wan-2-5-t2v/fast/submit', authMiddleware_1.requireAuth, validateWan25T2V_1.validateWan25T2V, (0, creditCostFactory_1.makeCreditCost)('replicate', 'wan-t2v', wanPricing_1.computeWanVideoCost), async (req, res, next) => {
    try {
        // Force fast mode; prefer explicit -fast slug if not provided
        req.body = {
            ...req.body,
            speed: 'fast',
            model: req.body?.model && String(req.body.model).toLowerCase().includes('fast')
                ? req.body.model
                : 'wan-video/wan-2.5-t2v-fast'
        };
        return replicateController_1.replicateController.wanT2vSubmit(req, res, next);
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
router.post('/wan-2-5-i2v/submit', authMiddleware_1.requireAuth, validateWan25I2V_1.validateWan25I2V, (0, creditCostFactory_1.makeCreditCost)('replicate', 'wan-i2v', wanPricing_1.computeWanVideoCost), replicateController_1.replicateController.wanI2vSubmit);
// Explicit FAST alias for WAN 2.5 I2V
router.post('/wan-2-5-i2v/fast/submit', authMiddleware_1.requireAuth, validateWan25I2V_1.validateWan25I2V, (0, creditCostFactory_1.makeCreditCost)('replicate', 'wan-i2v', wanPricing_1.computeWanVideoCost), async (req, res, next) => {
    try {
        // Force fast mode; prefer explicit -fast slug if not provided
        req.body = {
            ...req.body,
            speed: 'fast',
            model: req.body?.model && String(req.body.model).toLowerCase().includes('fast')
                ? req.body.model
                : 'wan-video/wan-2.5-i2v-fast'
        };
        return replicateController_1.replicateController.wanI2vSubmit(req, res, next);
    }
    catch (e) {
        next(e);
    }
});
// ============ Queue-style endpoints for Replicate Kling models ============
router.post('/kling-t2v/submit', authMiddleware_1.requireAuth, validateKlingT2V_1.validateKlingT2V, (0, creditCostFactory_1.makeCreditCost)('replicate', 'kling-t2v', klingPricing_1.computeKlingVideoCost), replicateController_1.replicateController.klingT2vSubmit);
router.post('/kling-i2v/submit', authMiddleware_1.requireAuth, validateKlingI2V_1.validateKlingI2V, (0, creditCostFactory_1.makeCreditCost)('replicate', 'kling-i2v', klingPricing_1.computeKlingVideoCost), replicateController_1.replicateController.klingI2vSubmit);
router.get('/queue/status', authMiddleware_1.requireAuth, replicateController_1.replicateController.queueStatus);
router.get('/queue/result', authMiddleware_1.requireAuth, replicateController_1.replicateController.queueResult);
exports.default = router;
