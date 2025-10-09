"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const creditCostFactory_1 = require("../middlewares/creditCostFactory");
const creditsRepository_1 = require("../repository/creditsRepository");
const replicateController_1 = require("../controllers/replicateController");
const replicatePricing_1 = require("../utils/pricing/replicatePricing");
const validateRemoveBg_1 = require("../middlewares/validators/replicate/validateRemoveBg");
const validateUpscale_1 = require("../middlewares/validators/replicate/validateUpscale");
const validateImageGenerate_1 = require("../middlewares/validators/replicate/validateImageGenerate");
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
