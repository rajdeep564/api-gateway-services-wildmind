import sharp from 'sharp';
import axios from 'axios';
import { uploadBufferToZata, getZataSignedGetUrl } from '../utils/storage/zataUpload';
import { adminDb } from '../config/firebaseAdmin';
import { logger } from '../utils/logger';

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
    const ZATA_PREFIXES = [
      'https://idr01.zata.ai/devstoragev1/',
      'https://idr01.zata.ai/',
      'http://idr01.zata.ai/devstoragev1/',
      'http://idr01.zata.ai/'
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
 * Download image from URL and return buffer
 * Handles both public URLs and Zata storage URLs with signed URLs
 */
async function downloadImage(url: string): Promise<Buffer> {
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
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: 50 * 1024 * 1024, // 50MB max
    });
    return Buffer.from(response.data);
  } catch (error) {
    console.error('[ImageOptimization] Failed to download image:', error);
    throw new Error('Failed to download image from URL');
  }
}

/**
 * Generate blur placeholder (tiny base64 image)
 */
async function generateBlurPlaceholder(imageBuffer: Buffer): Promise<string> {
  try {
    const placeholder = await sharp(imageBuffer)
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
 * Upload buffer to Zata Storage
 */
async function uploadToStorage(
  buffer: Buffer,
  path: string,
  contentType: string,
  metadata?: Record<string, string>
): Promise<string> {
  try {
    const { publicUrl } = await uploadBufferToZata(path, buffer, contentType);
    logger.info(`[ImageOptimization] Uploaded to Zata: ${path}`);
    return publicUrl;
  } catch (error: any) {
    logger.error(`[ImageOptimization] Failed to upload to Zata: ${error.message}`);
    throw error;
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

  try {
    console.log('[ImageOptimization] Starting optimization (AVIF only):', { originalUrl, basePath, filename });

    // Download original image
    const imageBuffer = await downloadImage(originalUrl);

    // Get original metadata
    const metadata = await sharp(imageBuffer).metadata();
    const { width = 0, height = 0, size = 0 } = metadata;

    console.log('[ImageOptimization] Original image:', { width, height, size, format: metadata.format });

    // Prepare sharp pipeline with resize if needed
    let pipeline = sharp(imageBuffer);
    
    if (width > maxWidth || height > maxHeight) {
      pipeline = pipeline.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Generate AVIF version (ONLY FORMAT - best compression with high quality)
    const avifBuffer = await pipeline
      .clone()
      .avif({ 
        quality: avifQuality, 
        effort: 6,              // Higher effort = better compression (0-9)
        chromaSubsampling: '4:4:4'  // Best quality chroma subsampling
      })
      .toBuffer();

    const avifPath = `${basePath}/${filename}_optimized.avif`;
    const avifUrl = await uploadToStorage(avifBuffer, avifPath, 'image/avif', {
      originalUrl,
      variant: 'optimized_avif',
    });

    console.log('[ImageOptimization] AVIF created:', { 
      size: avifBuffer.length, 
      compressionRatio: ((1 - avifBuffer.length / size) * 100).toFixed(2) + '%',
      url: avifUrl 
    });

    // Generate thumbnail (small preview for grids) - using AVIF for best quality/size
    const thumbnailBuffer = await sharp(imageBuffer)
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
    const thumbnailUrl = await uploadToStorage(thumbnailBuffer, thumbnailPath, 'image/avif', {
      originalUrl,
      variant: 'thumbnail',
    });

    console.log('[ImageOptimization] Thumbnail created:', { size: thumbnailBuffer.length, url: thumbnailUrl });

    // Generate blur placeholder (tiny base64)
    const blurDataUrl = await generateBlurPlaceholder(imageBuffer);

    console.log('[ImageOptimization] Optimization complete (AVIF only)');

    return {
      originalUrl,
      avifUrl,      // Primary and only format
      thumbnailUrl,
      blurDataUrl,
      width,
      height,
      size,
    };
  } catch (error) {
    console.error('[ImageOptimization] Optimization failed:', error);
    throw error;
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

    // Update Firestore with optimized URLs (AVIF only)
    images[imageIndex] = {
      url: imageUrl,
      avifUrl: optimized.avifUrl,      // Primary and only format
      thumbnailUrl: optimized.thumbnailUrl,
      blurDataUrl: optimized.blurDataUrl,
      optimized: true,
      optimizedAt: Date.now(),
    };

    await docRef.update({ images });

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
