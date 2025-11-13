import { Request, Response } from 'express';
import { imageOptimizationService } from '../services/imageOptimizationService';
import { adminDb } from '../config/firebaseAdmin';
import { logger } from '../utils/logger';

/**
 * Admin Controller for Image Optimization
 * 
 * Provides endpoints to:
 * - Trigger bulk optimization of existing images
 * - Check optimization status
 * - Retry failed optimizations
 */

/**
 * Optimize existing images in batches
 * 
 * Query params:
 * - batchSize: Number of generations to process (default: 10)
 * - offset: Skip this many documents (default: 0)
 * - generationType: Filter by generation type (optional)
 * 
 * @example
 * POST /api/admin/optimize-images?batchSize=10&offset=0
 */
export async function optimizeExistingImages(req: Request, res: Response): Promise<void> {
  const { batchSize = 10, offset = 0, generationType } = req.query;
  
  try {
    logger.info('[Admin] Starting bulk image optimization');
    
    // Build query for generations without optimized images
    let query = adminDb
      .collectionGroup('generationHistory')
      .where('status', '==', 'completed')
      .orderBy('createdAt', 'desc')
      .offset(Number(offset))
      .limit(Number(batchSize));
    
    // Optional filter by generation type
    if (generationType) {
      query = query.where('generationType', '==', generationType);
    }
    
    const snapshot = await query.get();
    
    if (snapshot.empty) {
      res.json({
        success: true,
        processed: 0,
        hasMore: false,
        message: 'No more generations to optimize',
      });
      return;
    }
    
    const results: Array<{
      uid: string;
      historyId: string;
      status: 'success' | 'failed' | 'skipped';
      error?: string;
      imagesProcessed?: number;
    }> = [];
    
    // Process each generation
    for (const doc of snapshot.docs) {
      const data = doc.data();
      
      // Get parent document ID (uid) from path
      const pathParts = doc.ref.path.split('/');
      const uid = pathParts[pathParts.length - 3];
      const historyId = doc.id;
      
      // Skip if no images
      if (!data.images || data.images.length === 0) {
        results.push({
          uid,
          historyId,
          status: 'skipped',
          error: 'No images to optimize',
        });
        continue;
      }
      
      // Check if already optimized
      const firstImage = Array.isArray(data.images) 
        ? data.images[0] 
        : typeof data.images === 'object' && data.images.url 
          ? data.images 
          : null;
      
      if (firstImage && typeof firstImage === 'object' && firstImage.optimized) {
        results.push({
          uid,
          historyId,
          status: 'skipped',
          error: 'Already optimized',
        });
        continue;
      }
      
      try {
        // Optimize each image in the generation
        const imageCount = Array.isArray(data.images) ? data.images.length : 1;
        
        for (let i = 0; i < imageCount; i++) {
          await imageOptimizationService.optimizeExistingImage(
            uid,
            historyId,
            i
          );
        }
        
        results.push({
          uid,
          historyId,
          status: 'success',
          imagesProcessed: imageCount,
        });
        
        logger.info('[Admin] Generation optimized successfully');
      } catch (error: any) {
        results.push({
          uid,
          historyId,
          status: 'failed',
          error: error.message,
        });
        
        logger.error('[Admin] Generation optimization failed');
      }
    }
    
    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;
    
    res.json({
      success: true,
      processed: results.length,
      successCount,
      failedCount,
      skippedCount,
      hasMore: snapshot.size === Number(batchSize),
      nextOffset: Number(offset) + results.length,
      results,
    });
    
    logger.info('[Admin] Bulk optimization completed');
  } catch (error: any) {
    logger.error('[Admin] Bulk optimization error');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * Get optimization statistics
 * 
 * @example
 * GET /api/admin/optimization-stats
 */
export async function getOptimizationStats(req: Request, res: Response): Promise<void> {
  try {
    logger.info('[Admin] Fetching optimization stats');
    
    // Count total generations with images
    const totalWithImages = await adminDb
      .collectionGroup('generationHistory')
      .where('status', '==', 'completed')
      .where('images', '!=', null)
      .count()
      .get();
    
    // This is a simplified version - for accurate counts,
    // you'd need to query and check the optimized flag
    // But that would be expensive for large datasets
    
    res.json({
      success: true,
      stats: {
        totalGenerationsWithImages: totalWithImages.data().count,
        // Add more detailed stats as needed
      },
      message: 'Note: Detailed optimization status requires scanning all documents',
    });
  } catch (error: any) {
    logger.error('[Admin] Failed to fetch stats');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}

/**
 * Retry failed optimizations for a specific generation
 * 
 * @example
 * POST /api/admin/retry-optimization/:uid/:historyId
 */
export async function retryOptimization(req: Request, res: Response): Promise<void> {
  const { uid, historyId } = req.params;
  const { imageIndex } = req.query; // Optional: retry specific image
  
  try {
    logger.info('[Admin] Retrying optimization');
    
    // Get generation document
    const doc = await adminDb
      .collection('users')
      .doc(uid)
      .collection('generationHistory')
      .doc(historyId)
      .get();
    
    if (!doc.exists) {
      res.status(404).json({
        success: false,
        error: 'Generation not found',
      });
      return;
    }
    
    const data = doc.data()!;
    
    if (!data.images || data.images.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Generation has no images',
      });
      return;
    }
    
    // Retry specific image or all images
    if (imageIndex !== undefined) {
      const index = Number(imageIndex);
      await imageOptimizationService.optimizeExistingImage(uid, historyId, index);
      
      res.json({
        success: true,
        message: `Image ${index} optimization retry triggered`,
      });
    } else {
      // Retry all images
      const imageCount = data.images.length;
      
      for (let i = 0; i < imageCount; i++) {
        await imageOptimizationService.optimizeExistingImage(uid, historyId, i);
      }
      
      res.json({
        success: true,
        message: `All ${imageCount} images optimization retry triggered`,
      });
    }
    
    logger.info('[Admin] Optimization retry completed');
  } catch (error: any) {
    logger.error('[Admin] Retry optimization failed');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
