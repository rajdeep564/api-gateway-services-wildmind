import sharp from 'sharp';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { createWriteStream, createReadStream } from 'fs';
import { uploadBufferToZata, getZataSignedGetUrl } from '../utils/storage/zataUpload';
import { adminDb } from '../config/firebaseAdmin';
import { logger } from '../utils/logger';
import { generationsMirrorRepository } from '../repository/generationsMirrorRepository';
import { env } from '../config/env';

export interface OptimizedImageResult {
  originalUrl: string;
  avifUrl: string;        // Primary format (AVIF only)
  thumbnailUrl: string;   // Thumbnail (AVIF)
  blurDataUrl: string;
  width: number;
  height: number;
  size: number;
}

/**
 * Extract storage path and filename from Zata URL
 * @param imageUrl - Full Zata URL
 * @returns Object with basePath and filename
 */
function extractStoragePathFromUrl(imageUrl: string): { basePath: string; filename: string } {
  try {
    // Handle different URL formats
    const zataPrefix = env.zataPrefix;
    const zataBase = zataPrefix.replace('/devstoragev1/', '').replace(/\/$/, '');
    const ZATA_PREFIXES = [
      zataPrefix,
      `${zataBase}/`,
      zataPrefix.replace('https://', 'http://'),
      `${zataBase.replace('https://', 'http://')}/`
    ];
    
    let fullPath = '';
    
    // Try each prefix
    for (const prefix of ZATA_PREFIXES) {
      if (imageUrl.startsWith(prefix)) {
        fullPath = imageUrl.substring(prefix.length);
        break;
      }
    }
    
    // If no prefix matched, try to extract path from any URL
    if (!fullPath) {
      const urlMatch = imageUrl.match(/https?:\/\/[^\/]+\/(.+)/);
      if (urlMatch) {
        fullPath = urlMatch[1];
      }
    }
    
    if (fullPath) {
      // Decode URL-encoded characters
      fullPath = decodeURIComponent(fullPath);
      
      // Get directory and filename
      const lastSlashIndex = fullPath.lastIndexOf('/');
      if (lastSlashIndex > 0) {
        const basePath = fullPath.substring(0, lastSlashIndex);
        const originalFilename = fullPath.substring(lastSlashIndex + 1);
        
        // Remove extension(s) to get base filename
        const filename = originalFilename.replace(/\.[^.]+$/, '').replace(/\.[^.]+$/, '');
        
        if (basePath && filename) {
          return { basePath, filename };
        }
      }
    }
  } catch (error) {
    console.warn('[extractStoragePathFromUrl] Failed to extract path:', error);
  }
  
  // Return empty strings if extraction failed
  return { basePath: '', filename: '' };
}

/**
 * Download image from URL to a temporary file
 * Handles both public URLs and Zata storage URLs with signed URLs
 * @returns Path to temporary file
 */
async function downloadImageToTemp(url: string): Promise<string> {
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `opt-${Date.now()}-${Math.random().toString(36).substring(7)}`);

  try {
    // Check if this is a Zata storage URL
    const ZATA_PATTERN = /https?:\/\/[^\/]+\/(devstoragev1|prodstoragev1)\//;
    const match = url.match(ZATA_PATTERN);
    
    let isZataUrl = false;
    let storageKey = '';
    
    if (match) {
      isZataUrl = true;
      // Extract everything AFTER the bucket name
      const bucketName = match[1]; // 'devstoragev1' or 'prodstoragev1'
      const afterBucket = url.substring(url.indexOf(`/${bucketName}/`) + bucketName.length + 2);
      storageKey = afterBucket;
      
      console.log('[ImageOptimization] Extracted Zata key:', {
        originalUrl: url,
        bucketName,
        storageKey
      });
    }
    
    // If it's a Zata URL, get a signed URL for authenticated access
    let downloadUrl = url;
    if (isZataUrl && storageKey) {
      console.log('[ImageOptimization] Generating signed URL for key:', storageKey);
      try {
        downloadUrl = await getZataSignedGetUrl(storageKey, 600); // 10 minute expiry
        console.log('[ImageOptimization] Using signed URL for download');
      } catch (signError) {
        console.warn('[ImageOptimization] Failed to generate signed URL, trying direct access:', signError);
        // Fall back to direct URL
        downloadUrl = url;
      }
    }
    
    const response = await axios.get(downloadUrl, {
      responseType: 'stream',
      timeout: 60000, // Increased timeout for large files
    });

    const fileWriter = createWriteStream(tempFilePath);
    await pipeline(response.data, fileWriter);
    
    return tempFilePath;
  } catch (error) {
    // Clean up if file was created partially
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
    console.error('[ImageOptimization] Failed to download image to temp:', error);
    throw new Error('Failed to download image from URL');
  }
}

/**
 * Generate blur placeholder (tiny base64 image)
 * Reads from temp file to keep memory usage low
 */
async function generateBlurPlaceholder(filePath: string): Promise<string> {
  try {
    const placeholder = await sharp(filePath)
      .resize(20, 20, { fit: 'inside' })
      .blur(5)
      .webp({ quality: 20 })
      .toBuffer();
    
    return `data:image/webp;base64,${placeholder.toString('base64')}`;
  } catch (error) {
    console.error('[ImageOptimization] Failed to generate blur placeholder:', error);
    return '';
  }
}

/**
 * Calculate file size
 */
async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Optimize a single image and generate all variants
 * @param originalUrl - URL of the original image
 * @param basePath - Base storage path (e.g., 'users/uid/generations/historyId')
 * @param filename - Filename without extension
 * @param options - Optimization options
 */
export async function optimizeImage(
  originalUrl: string,
  basePath: string,
  filename: string,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    avifQuality?: number;
    thumbnailSize?: number;
    thumbnailQuality?: number;
  } = {}
): Promise<OptimizedImageResult> {
  const {
    maxWidth = 2048,
    maxHeight = 2048,
    avifQuality = 90,       // AVIF quality (high quality, excellent compression)
    thumbnailSize = 400,
    thumbnailQuality = 80,  // Thumbnail quality
  } = options;

  let tempFilePath: string | null = null;

  try {
    console.log('[ImageOptimization] Starting streaming optimization (AVIF only):', { originalUrl, basePath, filename });

// Stream download to temp file
    tempFilePath = await downloadImageToTemp(originalUrl);
    const originalSize = await getFileSize(tempFilePath);

    // Get original metadata using sharp on file
    const metadata = await sharp(tempFilePath).metadata();
    const { width = 0, height = 0 } = metadata;

    console.log('[ImageOptimization] Original image:', { width, height, size: originalSize, format: metadata.format });

    // Prepare sharp pipeline with resize if needed
    // Note: We create new instances for each operation to avoid pipeline conflicts
    const resizeOptions = (width > maxWidth || height > maxHeight) 
      ? { width: maxWidth, height: maxHeight, fit: 'inside' as const, withoutEnlargement: true }
      : null;

    // --- Generate AVIF (Primary Format) ---
    const avifPipeline = sharp(tempFilePath);
    if (resizeOptions) {
      avifPipeline.resize(resizeOptions.width, resizeOptions.height, {
        fit: resizeOptions.fit,
        withoutEnlargement: resizeOptions.withoutEnlargement
      });
    }
    
    // Buffer the AVIF output instead of streaming to avoid missing Content-Length headers for AWS SDK
    const avifBuffer = await avifPipeline
      .avif({ 
        quality: avifQuality, 
        effort: 6,
        chromaSubsampling: '4:4:4'
      })
      .toBuffer();

    const avifPath = `${basePath}/${filename}_optimized.avif`;
    // Upload buffer directly to S3
    const { publicUrl: avifUrl } = await uploadBufferToZata(avifPath, avifBuffer, 'image/avif');

    console.log('[ImageOptimization] AVIF buffered upload to storage:', { url: avifUrl, size: avifBuffer.length });

    // --- Generate Thumbnail ---
    const thumbBuffer = await sharp(tempFilePath)
      .resize(thumbnailSize, thumbnailSize, {
        fit: 'cover',
        position: 'center',
      })
      .avif({ 
        quality: thumbnailQuality,
        effort: 5
      })
      .toBuffer();

    const thumbnailPath = `${basePath}/${filename}_thumb.avif`;
    const { publicUrl: thumbnailUrl } = await uploadBufferToZata(thumbnailPath, thumbBuffer, 'image/avif');

    console.log('[ImageOptimization] Thumbnail buffered upload to storage:', { url: thumbnailUrl, size: thumbBuffer.length });

    // --- Generate Blur Placeholder ---
    const blurDataUrl = await generateBlurPlaceholder(tempFilePath);

    console.log('[ImageOptimization] Optimization complete (Streamed)');

    return {
      originalUrl,
      avifUrl,      // Primary and only format
      thumbnailUrl,
      blurDataUrl,
      width,
      height,
      size: originalSize,
    };
  } catch (error) {
    console.error('[ImageOptimization] Optimization failed:', error);
    throw error;
  } finally {
    // Cleanup temp file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log('[ImageOptimization] Cleaned up temp file:', tempFilePath);
      } catch (err) {
        console.error('[ImageOptimization] Failed to cleanup temp file:', err);
      }
    }
  }
}

/**
 * Optimize multiple images in batch
 */
export async function optimizeImages(
  images: Array<{ url: string; id: string }>,
  basePath: string,
  options?: Parameters<typeof optimizeImage>[3]
): Promise<Array<OptimizedImageResult & { id: string }>> {
  const results: Array<OptimizedImageResult & { id: string }> = [];

  for (const image of images) {
    try {
      const optimized = await optimizeImage(
        image.url,
        basePath,
        image.id,
        options
      );
      results.push({ ...optimized, id: image.id });
    } catch (error) {
      console.error(`[ImageOptimization] Failed to optimize image ${image.id}:`, error);
      // Continue with other images even if one fails
    }
  }

  return results;
}

/**
 * Background job to optimize existing images
 * This can be triggered manually or via cron for existing generations
 */
export async function optimizeExistingImage(
  uid: string,
  historyId: string,
  imageIndex: number
): Promise<void> {
  try {
    // Correct path: generationHistory/{uid}/items/{historyId}
    const docRef = adminDb
      .collection('generationHistory')
      .doc(uid)
      .collection('items')
      .doc(historyId);

    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error('History item not found');
    }

    const data = doc.data();
    const images = data?.images || [];
    
    if (imageIndex >= images.length) {
      throw new Error('Image index out of bounds');
    }

    const image = images[imageIndex];
    
    // Handle both old format (string) and new format (object)
    const imageUrl = typeof image === 'string' ? image : image?.url;
    if (!imageUrl) {
      throw new Error('Image URL not found');
    }

    // Skip if already optimized (new format only)
    if (typeof image === 'object' && (image.avifUrl || image.optimized)) {
      logger.info('[ImageOptimization] Image already optimized, skipping');
      return;
    }

    logger.info('[ImageOptimization] Optimizing existing image');

    // Extract storage path from original URL
    const { basePath, filename } = extractStoragePathFromUrl(imageUrl);
    
    if (!basePath || !filename) {
      const errorMsg = `Failed to extract storage path from image URL: ${imageUrl}`;
      console.error('[ImageOptimization]', errorMsg);
      throw new Error(errorMsg);
    }
    
    console.log('[ImageOptimization] Extracted paths:', { basePath, filename, originalUrl: imageUrl });

    const optimized = await optimizeImage(imageUrl, basePath, filename);

    // Update Firestore with optimized URLs while preserving all existing fields
    // This ensures we don't lose id, originalUrl, storagePath, aestheticScore, etc.
    const existingImage = typeof image === 'object' && image !== null ? image : {};
    
    // For legacy string format, create a proper object structure
    // Ensure id exists (required by ArtStation and other consumers)
    const imageId = existingImage.id || `img-${historyId}-${imageIndex}-${Date.now()}`;
    
    images[imageIndex] = {
      ...existingImage, // Preserve all existing fields
      id: imageId, // Ensure id is always present
      url: imageUrl, // Ensure url is set
      originalUrl: existingImage.originalUrl || imageUrl,
      avifUrl: optimized.avifUrl,
      thumbnailUrl: optimized.thumbnailUrl,
      blurDataUrl: optimized.blurDataUrl,
      optimized: true,
      optimizedAt: Date.now(),
      // Preserve width/height if they exist, or add from optimization
      width: existingImage.width || optimized.width,
      height: existingImage.height || optimized.height,
      size: existingImage.size || optimized.size,
    };

    await docRef.update({ images });

    // If this item is public, also update the public feed mirror
    if (data?.isPublic === true) {
      try {
        await generationsMirrorRepository.updateFromHistory(uid, historyId, { images });
        console.log('[ImageOptimization] Successfully updated public feed mirror');
      } catch (mirrorError: any) {
        // Log but don't fail - mirror update is non-critical
        console.warn('[ImageOptimization] Failed to update public feed mirror (non-critical):', mirrorError?.message || mirrorError);
      }
    }

    console.log('[ImageOptimization] Successfully optimized and updated image');
  } catch (error) {
    console.error('[ImageOptimization] Failed to optimize existing image:', error);
    throw error;
  }
}

export const imageOptimizationService = {
  optimizeImage,
  optimizeImages,
  optimizeExistingImage,
};