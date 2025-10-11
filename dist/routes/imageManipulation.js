"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const imageManipulationController_1 = require("../controllers/imageManipulationController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const express_rate_limit_1 = require("express-rate-limit");
const router = (0, express_1.Router)();
// Rate limiting for image manipulation endpoints
const imageManipulationLimiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 requests per windowMs
    message: {
        success: false,
        message: 'Too many image manipulation requests, please try again later.',
        data: null
    },
    standardHeaders: true,
    legacyHeaders: false,
});
// Apply rate limiting and authentication to all routes
router.use(imageManipulationLimiter);
router.use(authMiddleware_1.requireAuth);
/**
 * @route POST /api/image-manipulation/metadata
 * @desc Get image metadata
 * @access Private
 */
router.post('/metadata', imageManipulationController_1.imageManipulationController.getMetadata);
/**
 * @route POST /api/image-manipulation/compress
 * @desc Compress image
 * @access Private
 */
router.post('/compress', imageManipulationController_1.upload.single('image'), imageManipulationController_1.imageManipulationController.compressImage);
/**
 * @route POST /api/image-manipulation/resize
 * @desc Resize image
 * @access Private
 */
router.post('/resize', imageManipulationController_1.upload.single('image'), imageManipulationController_1.imageManipulationController.resizeImage);
/**
 * @route POST /api/image-manipulation/crop
 * @desc Crop image
 * @access Private
 */
router.post('/crop', imageManipulationController_1.upload.single('image'), imageManipulationController_1.imageManipulationController.cropImage);
/**
 * @route POST /api/image-manipulation/manipulate
 * @desc Comprehensive image manipulation
 * @access Private
 */
router.post('/manipulate', imageManipulationController_1.upload.single('image'), imageManipulationController_1.imageManipulationController.manipulateImage);
/**
 * @route GET /api/image-manipulation/download/:filePath
 * @desc Download processed image
 * @access Private
 */
router.get('/download/:filePath(*)', imageManipulationController_1.imageManipulationController.downloadImage);
/**
 * @route POST /api/image-manipulation/cleanup
 * @desc Clean up old files
 * @access Private
 */
router.post('/cleanup', imageManipulationController_1.imageManipulationController.cleanupOldFiles);
exports.default = router;
