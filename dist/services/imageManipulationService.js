"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageManipulationService = exports.ImageManipulationService = void 0;
const sharp_1 = __importDefault(require("sharp"));
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const logger_1 = require("../utils/logger");
class ImageManipulationService {
    constructor() {
        this.maxFileSize = 50 * 1024 * 1024; // 50MB
        this.allowedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif'];
        this.maxDimensions = 8000; // Max width/height
        this.tempDir = path_1.default.join(process.cwd(), 'temp', 'images');
        this.outputDir = path_1.default.join(process.cwd(), 'temp', 'processed');
        this.ensureDirectories();
    }
    async ensureDirectories() {
        try {
            await promises_1.default.mkdir(this.tempDir, { recursive: true });
            await promises_1.default.mkdir(this.outputDir, { recursive: true });
        }
        catch (error) {
            logger_1.logger.error('Failed to create directories:', error);
        }
    }
    /**
     * Validate input file for security
     */
    async validateInput(inputPath) {
        try {
            // Check if file exists
            const stats = await promises_1.default.stat(inputPath);
            // Check file size
            if (stats.size > this.maxFileSize) {
                return { valid: false, error: 'File size exceeds maximum limit (50MB)' };
            }
            // Check file extension
            const ext = path_1.default.extname(inputPath).toLowerCase().slice(1);
            if (!this.allowedFormats.includes(ext)) {
                return { valid: false, error: 'Unsupported file format' };
            }
            // Validate image with Sharp
            const metadata = await (0, sharp_1.default)(inputPath).metadata();
            if (!metadata.width || !metadata.height) {
                return { valid: false, error: 'Invalid image file' };
            }
            // Check dimensions
            if (metadata.width > this.maxDimensions || metadata.height > this.maxDimensions) {
                return { valid: false, error: 'Image dimensions exceed maximum limit (8000px)' };
            }
            return { valid: true };
        }
        catch (error) {
            return { valid: false, error: 'Failed to validate image file' };
        }
    }
    /**
     * Get image metadata
     */
    async getMetadata(inputPath) {
        try {
            const validation = await this.validateInput(inputPath);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            const metadata = await (0, sharp_1.default)(inputPath).metadata();
            return { success: true, metadata };
        }
        catch (error) {
            logger_1.logger.error('Error getting metadata:', error);
            return { success: false, error: 'Failed to get image metadata' };
        }
    }
    /**
     * Compress image with various options
     */
    async compressImage(inputPath, options = {}) {
        try {
            const validation = await this.validateInput(inputPath);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            const outputPath = path_1.default.join(this.outputDir, `compressed_${(0, uuid_1.v4)()}.${options.format || 'jpeg'}`);
            const originalStats = await promises_1.default.stat(inputPath);
            let sharpInstance = (0, sharp_1.default)(inputPath);
            // Apply format and quality
            if (options.format === 'jpeg' || options.format === 'jpg') {
                sharpInstance = sharpInstance.jpeg({
                    quality: options.quality || 80,
                    progressive: true,
                    mozjpeg: true
                });
            }
            else if (options.format === 'png') {
                sharpInstance = sharpInstance.png({
                    quality: options.quality || 80,
                    compressionLevel: 9,
                    progressive: true
                });
            }
            else if (options.format === 'webp') {
                sharpInstance = sharpInstance.webp({
                    quality: options.quality || 80,
                    effort: 6
                });
            }
            else if (options.format === 'avif') {
                sharpInstance = sharpInstance.avif({
                    quality: options.quality || 80,
                    effort: 4
                });
            }
            else {
                // Default to JPEG
                sharpInstance = sharpInstance.jpeg({
                    quality: options.quality || 80,
                    progressive: true,
                    mozjpeg: true
                });
            }
            await sharpInstance.toFile(outputPath);
            const compressedStats = await promises_1.default.stat(outputPath);
            const metadata = await (0, sharp_1.default)(outputPath).metadata();
            return {
                success: true,
                outputPath,
                originalSize: originalStats.size,
                compressedSize: compressedStats.size,
                compressionRatio: Math.round(((originalStats.size - compressedStats.size) / originalStats.size) * 100),
                metadata: {
                    width: metadata.width || 0,
                    height: metadata.height || 0,
                    format: metadata.format || 'unknown',
                    size: compressedStats.size
                }
            };
        }
        catch (error) {
            logger_1.logger.error('Error compressing image:', error);
            return { success: false, error: 'Failed to compress image' };
        }
    }
    /**
     * Resize image
     */
    async resizeImage(inputPath, options) {
        try {
            const validation = await this.validateInput(inputPath);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            if (!options.width && !options.height) {
                return { success: false, error: 'Width or height must be specified for resize' };
            }
            const outputPath = path_1.default.join(this.outputDir, `resized_${(0, uuid_1.v4)()}.${options.format || 'jpeg'}`);
            const originalStats = await promises_1.default.stat(inputPath);
            let sharpInstance = (0, sharp_1.default)(inputPath)
                .resize(options.width, options.height, {
                fit: options.fit || 'cover',
                position: 'center',
                withoutEnlargement: false
            });
            // Apply format
            if (options.format === 'jpeg' || options.format === 'jpg') {
                sharpInstance = sharpInstance.jpeg({ quality: options.quality || 80 });
            }
            else if (options.format === 'png') {
                sharpInstance = sharpInstance.png({ quality: options.quality || 80 });
            }
            else if (options.format === 'webp') {
                sharpInstance = sharpInstance.webp({ quality: options.quality || 80 });
            }
            else if (options.format === 'avif') {
                sharpInstance = sharpInstance.avif({ quality: options.quality || 80 });
            }
            else {
                sharpInstance = sharpInstance.jpeg({ quality: options.quality || 80 });
            }
            await sharpInstance.toFile(outputPath);
            const resizedStats = await promises_1.default.stat(outputPath);
            const metadata = await (0, sharp_1.default)(outputPath).metadata();
            return {
                success: true,
                outputPath,
                originalSize: originalStats.size,
                compressedSize: resizedStats.size,
                compressionRatio: Math.round(((originalStats.size - resizedStats.size) / originalStats.size) * 100),
                metadata: {
                    width: metadata.width || 0,
                    height: metadata.height || 0,
                    format: metadata.format || 'unknown',
                    size: resizedStats.size
                }
            };
        }
        catch (error) {
            logger_1.logger.error('Error resizing image:', error);
            return { success: false, error: 'Failed to resize image' };
        }
    }
    /**
     * Crop image
     */
    async cropImage(inputPath, options) {
        try {
            const validation = await this.validateInput(inputPath);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            if (!options.crop) {
                return { success: false, error: 'Crop coordinates must be specified' };
            }
            const outputPath = path_1.default.join(this.outputDir, `cropped_${(0, uuid_1.v4)()}.${options.format || 'jpeg'}`);
            const originalStats = await promises_1.default.stat(inputPath);
            let sharpInstance = (0, sharp_1.default)(inputPath)
                .extract({
                left: options.crop.left,
                top: options.crop.top,
                width: options.crop.width,
                height: options.crop.height
            });
            // Apply format
            if (options.format === 'jpeg' || options.format === 'jpg') {
                sharpInstance = sharpInstance.jpeg({ quality: options.quality || 80 });
            }
            else if (options.format === 'png') {
                sharpInstance = sharpInstance.png({ quality: options.quality || 80 });
            }
            else if (options.format === 'webp') {
                sharpInstance = sharpInstance.webp({ quality: options.quality || 80 });
            }
            else if (options.format === 'avif') {
                sharpInstance = sharpInstance.avif({ quality: options.quality || 80 });
            }
            else {
                sharpInstance = sharpInstance.jpeg({ quality: options.quality || 80 });
            }
            await sharpInstance.toFile(outputPath);
            const croppedStats = await promises_1.default.stat(outputPath);
            const metadata = await (0, sharp_1.default)(outputPath).metadata();
            return {
                success: true,
                outputPath,
                originalSize: originalStats.size,
                compressedSize: croppedStats.size,
                compressionRatio: Math.round(((originalStats.size - croppedStats.size) / originalStats.size) * 100),
                metadata: {
                    width: metadata.width || 0,
                    height: metadata.height || 0,
                    format: metadata.format || 'unknown',
                    size: croppedStats.size
                }
            };
        }
        catch (error) {
            logger_1.logger.error('Error cropping image:', error);
            return { success: false, error: 'Failed to crop image' };
        }
    }
    /**
     * Apply comprehensive image manipulation
     */
    async manipulateImage(inputPath, options) {
        try {
            const validation = await this.validateInput(inputPath);
            if (!validation.valid) {
                return { success: false, error: validation.error };
            }
            const outputPath = path_1.default.join(this.outputDir, `manipulated_${(0, uuid_1.v4)()}.${options.format || 'jpeg'}`);
            const originalStats = await promises_1.default.stat(inputPath);
            let sharpInstance = (0, sharp_1.default)(inputPath);
            // Apply resize if specified
            if (options.width || options.height) {
                sharpInstance = sharpInstance.resize(options.width, options.height, {
                    fit: options.fit || 'cover',
                    position: 'center',
                    withoutEnlargement: false
                });
            }
            // Apply crop if specified
            if (options.crop) {
                sharpInstance = sharpInstance.extract({
                    left: options.crop.left,
                    top: options.crop.top,
                    width: options.crop.width,
                    height: options.crop.height
                });
            }
            // Apply rotation
            if (options.rotate) {
                sharpInstance = sharpInstance.rotate(options.rotate);
            }
            // Apply flip/flop
            if (options.flip) {
                sharpInstance = sharpInstance.flip();
            }
            if (options.flop) {
                sharpInstance = sharpInstance.flop();
            }
            // Apply blur
            if (options.blur) {
                sharpInstance = sharpInstance.blur(options.blur);
            }
            // Apply sharpen
            if (options.sharpen) {
                sharpInstance = sharpInstance.sharpen(options.sharpen.sigma, options.sharpen.flat, options.sharpen.jagged);
            }
            // Apply color adjustments
            if (options.brightness !== undefined || options.saturation !== undefined) {
                sharpInstance = sharpInstance.modulate({
                    brightness: options.brightness || 1,
                    saturation: options.saturation || 1
                });
            }
            // Apply contrast separately using linear
            if (options.contrast !== undefined && options.contrast !== 1) {
                sharpInstance = sharpInstance.linear(options.contrast, -(128 * options.contrast) + 128);
            }
            // Apply gamma correction
            if (options.gamma !== undefined && options.gamma !== 1) {
                sharpInstance = sharpInstance.gamma(options.gamma);
            }
            // Apply grayscale
            if (options.grayscale) {
                sharpInstance = sharpInstance.grayscale();
            }
            // Apply negate
            if (options.negate) {
                sharpInstance = sharpInstance.negate();
            }
            // Apply normalize
            if (options.normalize) {
                sharpInstance = sharpInstance.normalize();
            }
            // Apply threshold
            if (options.threshold !== undefined) {
                sharpInstance = sharpInstance.threshold(options.threshold);
            }
            // Apply final format
            if (options.format === 'jpeg' || options.format === 'jpg') {
                sharpInstance = sharpInstance.jpeg({
                    quality: options.quality || 80,
                    progressive: true,
                    mozjpeg: true
                });
            }
            else if (options.format === 'png') {
                sharpInstance = sharpInstance.png({
                    quality: options.quality || 80,
                    compressionLevel: 9,
                    progressive: true
                });
            }
            else if (options.format === 'webp') {
                sharpInstance = sharpInstance.webp({
                    quality: options.quality || 80,
                    effort: 6
                });
            }
            else if (options.format === 'avif') {
                sharpInstance = sharpInstance.avif({
                    quality: options.quality || 80,
                    effort: 4
                });
            }
            else {
                sharpInstance = sharpInstance.jpeg({
                    quality: options.quality || 80,
                    progressive: true,
                    mozjpeg: true
                });
            }
            await sharpInstance.toFile(outputPath);
            const processedStats = await promises_1.default.stat(outputPath);
            const metadata = await (0, sharp_1.default)(outputPath).metadata();
            return {
                success: true,
                outputPath,
                originalSize: originalStats.size,
                compressedSize: processedStats.size,
                compressionRatio: Math.round(((originalStats.size - processedStats.size) / originalStats.size) * 100),
                metadata: {
                    width: metadata.width || 0,
                    height: metadata.height || 0,
                    format: metadata.format || 'unknown',
                    size: processedStats.size
                }
            };
        }
        catch (error) {
            logger_1.logger.error('Error manipulating image:', error);
            return { success: false, error: 'Failed to manipulate image' };
        }
    }
    /**
     * Clean up temporary files
     */
    async cleanupFile(filePath) {
        try {
            await promises_1.default.unlink(filePath);
            logger_1.logger.info(`Cleaned up file: ${filePath}`);
        }
        catch (error) {
            logger_1.logger.error('Error cleaning up file:', error);
        }
    }
    /**
     * Clean up old files (older than 1 hour)
     */
    async cleanupOldFiles() {
        try {
            const files = await promises_1.default.readdir(this.outputDir);
            const now = Date.now();
            const oneHour = 60 * 60 * 1000;
            for (const file of files) {
                const filePath = path_1.default.join(this.outputDir, file);
                const stats = await promises_1.default.stat(filePath);
                if (now - stats.mtime.getTime() > oneHour) {
                    await promises_1.default.unlink(filePath);
                    logger_1.logger.info(`Cleaned up old file: ${filePath}`);
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Error cleaning up old files:', error);
        }
    }
}
exports.ImageManipulationService = ImageManipulationService;
exports.imageManipulationService = new ImageManipulationService();
