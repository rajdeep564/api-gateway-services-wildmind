"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const runwayController_1 = require("../controllers/runwayController");
const validateRunway_1 = require("../middlewares/validators/runway/validateRunway");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const creditCostFactory_1 = require("../middlewares/creditCostFactory");
const runwayPricing_1 = require("../utils/pricing/runwayPricing");
const router = (0, express_1.Router)();
router.post('/generate', authMiddleware_1.requireAuth, validateRunway_1.validateRunwayTextToImage, (0, creditCostFactory_1.makeCreditCost)('runway', 'generate', runwayPricing_1.computeRunwayImageCost), runwayController_1.runwayController.textToImage);
router.get('/status/:id', authMiddleware_1.requireAuth, validateRunway_1.validateRunwayStatus, runwayController_1.runwayController.getStatus);
router.post('/video', authMiddleware_1.requireAuth, (0, creditCostFactory_1.makeCreditCost)('runway', 'video', runwayPricing_1.computeRunwayVideoCost), runwayController_1.runwayController.videoGenerate);
// optional granular endpoints if needed later:
// router.post('/image_to_video', validateRunwayImageToVideo, runwayController.imageToVideo)
// router.post('/text_to_video', validateRunwayTextToVideo, runwayController.textToVideo)
// router.post('/video_to_video', validateRunwayVideoToVideo, runwayController.videoToVideo)
// router.post('/video_upscale', validateRunwayVideoUpscale, runwayController.videoUpscale)
exports.default = router;
