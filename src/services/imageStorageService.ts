import { ZataService } from './zataService';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface ImageStorageResult {
  success: boolean;
  originalUrl: string;
  zataUrl?: string;
  zataKey?: string;
  error?: string;
}

export class ImageStorageService {
  /**
   * Downloads an image from a URL and uploads it to Zata AI storage
   */
  static async downloadAndUploadToZata(imageUrl: string, customKey?: string): Promise<ImageStorageResult> {
    try {
      logger.info({ imageUrl, customKey }, 'Downloading and uploading image to Zata');

      // Download the image from the original URL
      const response = await fetch(imageUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
      }

      // Get the image buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Determine content type from response headers or default to JPEG
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      
      // Generate a unique key if not provided
      const fileExtension = ZataService.getFileExtension(contentType) || '.jpg';
      const key = customKey || `generated-images/${uuidv4()}${fileExtension}`;

      // Upload to Zata
      const uploadResult = await ZataService.uploadFile(buffer, contentType, key);

      if (!uploadResult.success) {
        return {
          success: false,
          originalUrl: imageUrl,
          error: uploadResult.error
        };
      }

      logger.info({
        originalUrl: imageUrl,
        zataUrl: uploadResult.publicUrl,
        zataKey: uploadResult.key,
        size: buffer.length
      }, 'Successfully uploaded image to Zata');

      return {
        success: true,
        originalUrl: imageUrl,
        zataUrl: uploadResult.publicUrl,
        zataKey: uploadResult.key
      };
    } catch (error: any) {
      logger.error({
        error: error.message,
        imageUrl,
        customKey
      }, 'Failed to download and upload image to Zata');

      return {
        success: false,
        originalUrl: imageUrl,
        error: error.message
      };
    }
  }

  /**
   * Downloads multiple images and uploads them to Zata AI storage
   */
  static async downloadAndUploadMultipleToZata(
    imageUrls: string[],
    customKeys?: string[]
  ): Promise<ImageStorageResult[]> {
    logger.info({
      imageCount: imageUrls.length,
      imageUrls,
      customKeys
    }, 'Downloading and uploading multiple images to Zata');

    const uploadPromises = imageUrls.map((url, index) => {
      const customKey = customKeys?.[index];
      return this.downloadAndUploadToZata(url, customKey);
    });

    const results = await Promise.all(uploadPromises);
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    logger.info({
      total: imageUrls.length,
      successful,
      failed
    }, 'Completed multiple image uploads to Zata');

    return results;
  }

  /**
   * Utility method to extract filename from URL for better key generation
   */
  private static extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || 'image';
      return filename.includes('.') ? filename : `${filename}.jpg`;
    } catch {
      return `image-${Date.now()}.jpg`;
    }
  }

  /**
   * Generate a meaningful key for generated images
   */
  static generateImageKey(prompt?: string, model?: string, index?: number): string {
    const timestamp = Date.now();
    const uuid = uuidv4().split('-')[0]; // Short UUID
    
    let keyParts = ['generated-images'];
    
    if (model) {
      keyParts.push(model.toLowerCase().replace(/[^a-z0-9]/g, '-'));
    }
    
    if (prompt) {
      // Create a safe filename from prompt (first 30 chars)
      const safePrompt = prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 30)
        .replace(/-+$/, ''); // Remove trailing dashes
      
      if (safePrompt) {
        keyParts.push(safePrompt);
      }
    }
    
    keyParts.push(`${timestamp}-${uuid}`);
    
    if (typeof index === 'number') {
      keyParts.push(`img-${index + 1}`);
    }
    
    return `${keyParts.join('/')}.jpg`;
  }
}
