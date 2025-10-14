"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const falController_1 = require("../controllers/falController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const creditCostFactory_1 = require("../middlewares/creditCostFactory");
const falPricing_1 = require("../utils/pricing/falPricing");
const validateFalGenerate_1 = require("../middlewares/validators/fal/validateFalGenerate");
const router = (0, express_1.Router)();
router.post('/generate', authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalGenerate, (0, creditCostFactory_1.makeCreditCost)('fal', 'generate', falPricing_1.computeFalImageCost), falController_1.falController.generate);
// Queue style endpoints
router.post('/veo3/text-to-video/submit', authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoTextToVideoSubmit, (0, creditCostFactory_1.makeCreditCost)('fal', 'veo_t2v_submit', (req) => (0, falPricing_1.computeFalVeoTtvSubmitCost)(req, false)), falController_1.falController.veoTtvSubmit);
router.post('/veo3/text-to-video/fast/submit', authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoTextToVideoFastSubmit, (0, creditCostFactory_1.makeCreditCost)('fal', 'veo_t2v_fast_submit', (req) => (0, falPricing_1.computeFalVeoTtvSubmitCost)(req, true)), falController_1.falController.veoTtvFastSubmit);
router.post('/veo3/image-to-video/submit', authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoImageToVideoSubmit, (0, creditCostFactory_1.makeCreditCost)('fal', 'veo_i2v_submit', (req) => (0, falPricing_1.computeFalVeoI2vSubmitCost)(req, false)), falController_1.falController.veoI2vSubmit);
router.post('/veo3/image-to-video/fast/submit', authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoImageToVideoFastSubmit, (0, creditCostFactory_1.makeCreditCost)('fal', 'veo_i2v_fast_submit', (req) => (0, falPricing_1.computeFalVeoI2vSubmitCost)(req, true)), falController_1.falController.veoI2vFastSubmit);
router.get('/queue/status', authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalQueueStatus, falController_1.falController.queueStatus);
router.get('/queue/result', authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalQueueStatus, falController_1.falController.queueResult);
// NanoBanana queue submit
// Note: NanoBanana uses the unified /fal/generate route; no separate routes needed
exports.default = router;
