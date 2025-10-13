"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = exports.imageManipulationController = exports.ImageManipulationController = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const uuid_1 = require("uuid");
const imageManipulationService_1 = require("../services/imageManipulationService");
const logger_1 = require("../utils/logger");
const formatApiResponse_1 = require("../utils/formatApiResponse");
// Configure multer for file uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const tempDir = path_1.default.join(process.cwd(), 'temp', 'uploads');
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${(0, uuid_1.v4)()}_${file.originalname}`;
        cb(null, uniqueName);
    }
});
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 1 // Only one file at a time
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|bmp|tiff|webp|avif/;
        const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        else {
            cb(new Error('Only image files are allowed'));
        }
    }
});
exports.upload = upload;
class ImageManipulationController {
    /**
     * Get image metadata
     */
    async getMetadata(req, res) {
        try {
            const { imageUrl } = req.body;
            if (!imageUrl) {
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'Image URL is required', null));
                return;
            }
            // For now, we'll handle local files. In production, you might want to download from URL first
            const result = await imageManipulationService_1.imageManipulationService.getMetadata(imageUrl);
            if (result.success) {
                res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Metadata retrieved successfully', result.metadata));
            }
            else {
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', result.error || 'Failed to get metadata', null));
            }
        }
        catch (error) {
            logger_1.logger.error('Error getting metadata:', error);
            res.status(500).json((0, formatApiResponse_1.formatApiResponse)('error', 'Internal server error', null));
        }
    }
    /**
     * Compress image
     */
    async compressImage(req, res) {
        try {
            const { quality = 80, format = 'jpeg' } = req.body;
            const file = req.file;
            if (!file) {
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'Image file is required', null));
                return;
            }
            const options = {
                quality: Math.max(1, Math.min(100, quality)),
                format: format
            };
            const result = await imageManipulationService_1.imageManipulationService.compressImage(file.path, options);
            if (result.success) {
                // Clean up uploaded file
                await imageManipulationService_1.imageManipulationService.cleanupFile(file.path);
                res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Image compressed successfully', {
                    outputPath: result.outputPath,
                    originalSize: result.originalSize,
                    compressedSize: result.compressedSize,
                    compressionRatio: result.compressionRatio,
                    metadata: result.metadata
                }));
            }
            else {
                // Clean up uploaded file
                await imageManipulationService_1.imageManipulationService.cleanupFile(file.path);
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', result.error || 'Failed to compress image', null));
            }
        }
        catch (error) {
            logger_1.logger.error('Error compressing image:', error);
            res.status(500).json((0, formatApiResponse_1.formatApiResponse)('error', 'Internal server error', null));
        }
    }
    /**
     * Resize image
     */
    async resizeImage(req, res) {
        try {
            const { width, height, fit = 'cover', quality = 80, format = 'jpeg' } = req.body;
            const file = req.file;
            if (!file) {
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'Image file is required', null));
                return;
            }
            if (!width && !height) {
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'Width or height is required', null));
                return;
            }
            const options = {
                width: width ? parseInt(width) : undefined,
                height: height ? parseInt(height) : undefined,
                fit: fit,
                quality: Math.max(1, Math.min(100, quality)),
                format: format
            };
            const result = await imageManipulationService_1.imageManipulationService.resizeImage(file.path, options);
            if (result.success) {
                // Clean up uploaded file
                await imageManipulationService_1.imageManipulationService.cleanupFile(file.path);
                res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Image resized successfully', {
                    outputPath: result.outputPath,
                    originalSize: result.originalSize,
                    compressedSize: result.compressedSize,
                    compressionRatio: result.compressionRatio,
                    metadata: result.metadata
                }));
            }
            else {
                // Clean up uploaded file
                await imageManipulationService_1.imageManipulationService.cleanupFile(file.path);
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', result.error || 'Failed to resize image', null));
            }
        }
        catch (error) {
            logger_1.logger.error('Error resizing image:', error);
            res.status(500).json((0, formatApiResponse_1.formatApiResponse)('error', 'Internal server error', null));
        }
    }
    /**
     * Crop image
     */
    async cropImage(req, res) {
        try {
            const { crop, quality = 80, format = 'jpeg' } = req.body;
            const file = req.file;
            if (!file) {
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'Image file is required', null));
                return;
            }
            if (!crop || !crop.left || !crop.top || !crop.width || !crop.height) {
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'Crop coordinates are required (left, top, width, height)', null));
                return;
            }
            const options = {
                crop: {
                    left: parseInt(crop.left),
                    top: parseInt(crop.top),
                    width: parseInt(crop.width),
                    height: parseInt(crop.height)
                },
                quality: Math.max(1, Math.min(100, quality)),
                format: format
            };
            const result = await imageManipulationService_1.imageManipulationService.cropImage(file.path, options);
            if (result.success) {
                // Clean up uploaded file
                await imageManipulationService_1.imageManipulationService.cleanupFile(file.path);
                res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Image cropped successfully', {
                    outputPath: result.outputPath,
                    originalSize: result.originalSize,
                    compressedSize: result.compressedSize,
                    compressionRatio: result.compressionRatio,
                    metadata: result.metadata
                }));
            }
            else {
                // Clean up uploaded file
                await imageManipulationService_1.imageManipulationService.cleanupFile(file.path);
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', result.error || 'Failed to crop image', null));
            }
        }
        catch (error) {
            logger_1.logger.error('Error cropping image:', error);
            res.status(500).json((0, formatApiResponse_1.formatApiResponse)('error', 'Internal server error', null));
        }
    }
    /**
     * Comprehensive image manipulation
     */
    async manipulateImage(req, res) {
        try {
            const { quality = 80, format = 'jpeg', width, height, fit = 'cover', crop, rotate, flip, flop, blur, sharpen, brightness, contrast, saturation, gamma, grayscale, negate, normalize, threshold } = req.body;
            const file = req.file;
            if (!file) {
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', 'Image file is required', null));
                return;
            }
            const options = {
                quality: Math.max(1, Math.min(100, quality)),
                format: format,
                width: width ? parseInt(width) : undefined,
                height: height ? parseInt(height) : undefined,
                fit: fit,
                crop: crop ? {
                    left: parseInt(crop.left),
                    top: parseInt(crop.top),
                    width: parseInt(crop.width),
                    height: parseInt(crop.height)
                } : undefined,
                rotate: rotate ? parseInt(rotate) : undefined,
                flip: Boolean(flip),
                flop: Boolean(flop),
                blur: blur ? parseFloat(blur) : undefined,
                sharpen: sharpen ? {
                    sigma: parseFloat(sharpen.sigma || 1),
                    flat: parseFloat(sharpen.flat || 1),
                    jagged: parseFloat(sharpen.jagged || 2)
                } : undefined,
                brightness: brightness ? parseFloat(brightness) : undefined,
                contrast: contrast ? parseFloat(contrast) : undefined,
                saturation: saturation ? parseFloat(saturation) : undefined,
                gamma: gamma ? parseFloat(gamma) : undefined,
                grayscale: Boolean(grayscale),
                negate: Boolean(negate),
                normalize: Boolean(normalize),
                threshold: threshold ? parseInt(threshold) : undefined
            };
            const result = await imageManipulationService_1.imageManipulationService.manipulateImage(file.path, options);
            if (result.success) {
                // Clean up uploaded file
                await imageManipulationService_1.imageManipulationService.cleanupFile(file.path);
                res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Image manipulated successfully', {
                    outputPath: result.outputPath,
                    originalSize: result.originalSize,
                    compressedSize: result.compressedSize,
                    compressionRatio: result.compressionRatio,
                    metadata: result.metadata
                }));
            }
            else {
                // Clean up uploaded file
                await imageManipulationService_1.imageManipulationService.cleanupFile(file.path);
                res.status(400).json((0, formatApiResponse_1.formatApiResponse)('error', result.error || 'Failed to manipulate image', null));
            }
        }
        catch (error) {
            logger_1.logger.error('Error manipulating image:', error);
            res.status(500).json((0, formatApiResponse_1.formatApiResponse)('error', 'Internal server error', null));
        }
    }
    /**
     * Download processed image
     */
    async downloadImage(req, res) {
        try {
            const { filePath } = req.params;
            const decodedPath = decodeURIComponent(filePath);
            // Security check - ensure the path is within our output directory
            const outputDir = path_1.default.join(process.cwd(), 'temp', 'processed');
            const fullPath = path_1.default.resolve(decodedPath);
            if (!fullPath.startsWith(outputDir)) {
                res.status(403).json((0, formatApiResponse_1.formatApiResponse)('error', 'Access denied', null));
                return;
            }
            // Check if file exists
            try {
                await promises_1.default.access(fullPath);
            }
            catch {
                res.status(404).json((0, formatApiResponse_1.formatApiResponse)('error', 'File not found', null));
                return;
            }
            // Set appropriate headers
            const ext = path_1.default.extname(fullPath).toLowerCase();
            const mimeTypes = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.webp': 'image/webp',
                '.avif': 'image/avif',
                '.gif': 'image/gif'
            };
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${path_1.default.basename(fullPath)}"`);
            // Stream the file
            const fileStream = require('fs').createReadStream(fullPath);
            fileStream.pipe(res);
            // Clean up file after download
            fileStream.on('end', async () => {
                try {
                    await imageManipulationService_1.imageManipulationService.cleanupFile(fullPath);
                }
                catch (error) {
                    logger_1.logger.error('Error cleaning up file after download:', error);
                }
            });
        }
        catch (error) {
            logger_1.logger.error('Error downloading image:', error);
            res.status(500).json((0, formatApiResponse_1.formatApiResponse)('error', 'Internal server error', null));
        }
    }
    /**
     * Clean up old files
     */
    async cleanupOldFiles(req, res) {
        try {
            await imageManipulationService_1.imageManipulationService.cleanupOldFiles();
            res.json((0, formatApiResponse_1.formatApiResponse)('success', 'Old files cleaned up successfully', null));
        }
        catch (error) {
            logger_1.logger.error('Error cleaning up old files:', error);
            res.status(500).json((0, formatApiResponse_1.formatApiResponse)('error', 'Internal server error', null));
        }
    }
}
exports.ImageManipulationController = ImageManipulationController;
exports.imageManipulationController = new ImageManipulationController();
