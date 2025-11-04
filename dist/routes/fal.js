"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const falController_1 = require("../controllers/falController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const creditCostFactory_1 = require("../middlewares/creditCostFactory");
const falPricing_1 = require("../utils/pricing/falPricing");
const validateFalGenerate_1 = require("../middlewares/validators/fal/validateFalGenerate");
const router = (0, express_1.Router)();
router.post("/generate", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalGenerate, (0, creditCostFactory_1.makeCreditCost)("fal", "generate", falPricing_1.computeFalImageCost), falController_1.falController.generate);
// Image utilities
router.post("/image2svg", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalImage2Svg, (0, creditCostFactory_1.makeCreditCost)("fal", "image2svg", falPricing_1.computeFalImage2SvgCost), falController_1.falController.image2svg);
router.post("/recraft/vectorize", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalRecraftVectorize, (0, creditCostFactory_1.makeCreditCost)("fal", "recraft_vectorize", falPricing_1.computeFalRecraftVectorizeCost), falController_1.falController.recraftVectorize);
// Topaz Image Upscaler (per-megapixel dynamic pricing)
router.post("/topaz/upscale/image", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalTopazUpscaleImage, (0, creditCostFactory_1.makeCreditCost)("fal", "topaz_upscale_image", (req) => (0, falPricing_1.computeFalTopazUpscaleImageCost)(req)), falController_1.falController.topazUpscaleImage);
// SeedVR2 Video Upscaler
router.post("/seedvr/upscale/video", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalSeedvrUpscale, (0, creditCostFactory_1.makeCreditCost)("fal", "seedvr_upscale", (req) => (0, falPricing_1.computeFalSeedVrUpscaleCost)(req)), falController_1.falController.seedvrUpscale);
// Queue style endpoints
router.post("/veo3/text-to-video/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoTextToVideoSubmit, (0, creditCostFactory_1.makeCreditCost)("fal", "veo_t2v_submit", (req) => (0, falPricing_1.computeFalVeoTtvSubmitCost)(req, false)), falController_1.falController.veoTtvSubmit);
router.post("/veo3/text-to-video/fast/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoTextToVideoFastSubmit, (0, creditCostFactory_1.makeCreditCost)("fal", "veo_t2v_fast_submit", (req) => (0, falPricing_1.computeFalVeoTtvSubmitCost)(req, true)), falController_1.falController.veoTtvFastSubmit);
router.post("/veo3/image-to-video/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoImageToVideoSubmit, (0, creditCostFactory_1.makeCreditCost)("fal", "veo_i2v_submit", (req) => (0, falPricing_1.computeFalVeoI2vSubmitCost)(req, false)), falController_1.falController.veoI2vSubmit);
router.post("/veo3/image-to-video/fast/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoImageToVideoFastSubmit, (0, creditCostFactory_1.makeCreditCost)("fal", "veo_i2v_fast_submit", (req) => (0, falPricing_1.computeFalVeoI2vSubmitCost)(req, true)), falController_1.falController.veoI2vFastSubmit);
router.get("/queue/status", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalQueueStatus, falController_1.falController.queueStatus);
router.get("/queue/result", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalQueueStatus, falController_1.falController.queueResult);
// NanoBanana queue submit
// Note: NanoBanana uses the unified /fal/generate route; no separate routes needed
exports.default = router;
// Veo 3.1 endpoints
router.post("/veo3_1/text-to-video/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoTextToVideoSubmit, (0, creditCostFactory_1.makeCreditCost)("fal", "veo31_t2v_submit", (req) => (0, falPricing_1.computeFalVeo31TtvSubmitCost)(req, false)), falController_1.falController.veo31TtvSubmit);
router.post("/veo3_1/text-to-video/fast/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoTextToVideoFastSubmit, (0, creditCostFactory_1.makeCreditCost)("fal", "veo31_t2v_fast_submit", (req) => (0, falPricing_1.computeFalVeo31TtvSubmitCost)(req, true)), falController_1.falController.veo31TtvFastSubmit);
router.post("/veo3_1/image-to-video/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoImageToVideoSubmit, (0, creditCostFactory_1.makeCreditCost)("fal", "veo31_i2v_submit", (req) => (0, falPricing_1.computeFalVeo31I2vSubmitCost)(req, false)), falController_1.falController.veo31I2vSubmit);
router.post("/veo3_1/image-to-video/fast/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeoImageToVideoFastSubmit, (0, creditCostFactory_1.makeCreditCost)("fal", "veo31_i2v_fast_submit", (req) => (0, falPricing_1.computeFalVeo31I2vSubmitCost)(req, true)), falController_1.falController.veo31I2vFastSubmit);
// Veo 3.1 First/Last Frame to Video (Fast)
router.post("/veo3_1/first-last/fast/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeo31FirstLastFast, (0, creditCostFactory_1.makeCreditCost)("fal", "veo31_first_last_fast_submit", (req) => (0, falPricing_1.computeFalVeo31I2vSubmitCost)(req, true)), falController_1.falController.veo31FirstLastFastSubmit);
// Veo 3.1 First/Last Frame to Video (Standard)
router.post("/veo3_1/first-last/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeo31FirstLast, (0, creditCostFactory_1.makeCreditCost)("fal", "veo31_first_last_submit", (req) => (0, falPricing_1.computeFalVeo31I2vSubmitCost)(req, false)), falController_1.falController.veo31FirstLastSubmit);
// Veo 3.1 Reference-to-Video (Standard)
router.post("/veo3_1/reference-to-video/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalVeo31ReferenceToVideo, (0, creditCostFactory_1.makeCreditCost)("fal", "veo31_r2v_submit", (req) => (0, falPricing_1.computeFalVeo31I2vSubmitCost)(req, false)), falController_1.falController.veo31ReferenceToVideoSubmit);
// Sora 2 Image-to-Video (Standard)
router.post("/sora2/image-to-video/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalSora2I2v, (0, creditCostFactory_1.makeCreditCost)("fal", "sora2_i2v_submit", (req) => (0, falPricing_1.computeFalSora2I2vSubmitCost)(req)), falController_1.falController.sora2I2vSubmit);
// Sora 2 Image-to-Video (Pro)
router.post("/sora2/image-to-video/pro/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalSora2ProI2v, (0, creditCostFactory_1.makeCreditCost)("fal", "sora2_pro_i2v_submit", (req) => (0, falPricing_1.computeFalSora2ProI2vSubmitCost)(req)), falController_1.falController.sora2ProI2vSubmit);
// Sora 2 Text-to-Video (Standard)
router.post("/sora2/text-to-video/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalSora2T2v, (0, creditCostFactory_1.makeCreditCost)("fal", "sora2_t2v_submit", (req) => (0, falPricing_1.computeFalSora2T2vSubmitCost)(req)), falController_1.falController.sora2T2vSubmit);
// Sora 2 Text-to-Video (Pro)
router.post("/sora2/text-to-video/pro/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalSora2ProT2v, (0, creditCostFactory_1.makeCreditCost)("fal", "sora2_pro_t2v_submit", (req) => (0, falPricing_1.computeFalSora2ProT2vSubmitCost)(req)), falController_1.falController.sora2ProT2vSubmit);
// Sora 2 Video-to-Video Remix
router.post("/sora2/video-to-video/remix/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalSora2Remix, (0, creditCostFactory_1.makeCreditCost)("fal", "sora2_v2v_remix_submit", (req) => (0, falPricing_1.computeFalSora2RemixSubmitCost)(req)), falController_1.falController.sora2RemixV2vSubmit);
// Sora 2 Video-to-Video Remix (history-only convenience)
router.post("/sora2/video-to-video/remix/by-history/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalSora2RemixByHistory, (0, creditCostFactory_1.makeCreditCost)("fal", "sora2_v2v_remix_submit", (req) => (0, falPricing_1.computeFalSora2RemixSubmitCost)(req)), falController_1.falController.sora2RemixV2vSubmit);
// LTX V2 Image-to-Video (Pro)
router.post("/ltx2/image-to-video/pro/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalLtx2ProI2v, (0, creditCostFactory_1.makeCreditCost)("fal", "ltx2_pro_i2v_submit", (req) => (0, falPricing_1.computeFalLtxV2ProI2vSubmitCost)(req)), falController_1.falController.ltx2ProI2vSubmit);
// LTX V2 Image-to-Video (Fast)
router.post("/ltx2/image-to-video/fast/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalLtx2FastI2v, (0, creditCostFactory_1.makeCreditCost)("fal", "ltx2_fast_i2v_submit", (req) => (0, falPricing_1.computeFalLtxV2FastI2vSubmitCost)(req)), falController_1.falController.ltx2FastI2vSubmit);
// LTX V2 Text-to-Video (Pro)
router.post("/ltx2/text-to-video/pro/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalLtx2ProT2v, (0, creditCostFactory_1.makeCreditCost)("fal", "ltx2_pro_t2v_submit", (req) => (0, falPricing_1.computeFalLtxV2ProT2vSubmitCost)(req)), falController_1.falController.ltx2ProT2vSubmit);
// LTX V2 Text-to-Video (Fast)
router.post("/ltx2/text-to-video/fast/submit", authMiddleware_1.requireAuth, validateFalGenerate_1.validateFalLtx2FastT2v, (0, creditCostFactory_1.makeCreditCost)("fal", "ltx2_fast_t2v_submit", (req) => (0, falPricing_1.computeFalLtxV2FastT2vSubmitCost)(req)), falController_1.falController.ltx2FastT2vSubmit);
