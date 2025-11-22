/**
 * Script: Optimize Images in Public Feed
 * 
 * This script optimizes images in the public feed (generations collection) that don't have
 * optimized versions (AVIF, thumbnails, blur placeholders).
 * 
 * It:
 * - Only processes public items (isPublic === true)
 * - Skips deleted items (isDeleted !== true)
 * - Skips items that already have thumbnails
 * - Only processes images from Zata storage
 * - Updates both history and public feed mirror
 * 
 * Usage:
 *   npx ts-node scripts/optimizePublicFeedImages.ts
 * 
 * Options:
 *   --batch-size=10      Number of generations to process per batch
 *   --delay=2000         Delay between batches in milliseconds
 *   --dry-run            Preview what would be optimized without making changes
 * 
 * Examples:
 *   npx ts-node scripts/optimizePublicFeedImages.ts
 *   npx ts-node scripts/optimizePublicFeedImages.ts --batch-size=5 --delay=3000
 *   npx ts-node scripts/optimizePublicFeedImages.ts --dry-run
 */

import 'dotenv/config';

import { adminDb } from '../src/config/firebaseAdmin';
import { imageOptimizationService } from '../src/services/imageOptimizationService';
import { logger } from '../src/utils/logger';

interface OptimizationOptions {
  batchSize: number;
  delay: number;
  dryRun: boolean;
}

interface OptimizationStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: Array<{
    historyId: string;
    uid: string;
    error: string;
  }>;
}

/**
 * Parse command line arguments
 */
function parseArguments(): OptimizationOptions {
  const args = process.argv.slice(2);
  
  const options: OptimizationOptions = {
    batchSize: 10,
    delay: 2000,
    dryRun: false,
  };

  args.forEach((arg: string) => {
    if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--delay=')) {
      options.delay = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  });

  return options;
}

/**
 * Check if an image already has thumbnails/optimization
 */
function hasThumbnail(image: any): boolean {
  if (typeof image === 'string') {
    return false; // Legacy string format, needs optimization
  }
  
  if (typeof image === 'object' && image !== null) {
    // Check if it has thumbnailUrl (primary indicator)
    return Boolean(image.thumbnailUrl || image.avifUrl || image.optimized);
  }
  
  return false;
}

/**
 * Check if all images in a generation have thumbnails
 */
function allImagesHaveThumbnails(images: any[]): boolean {
  if (!images || images.length === 0) {
    return false;
  }
  
  return images.every(img => hasThumbnail(img));
}

/**
 * Optimize a single generation's images from public feed
 */
async function optimizePublicGeneration(
  historyId: string,
  data: any,
  dryRun: boolean
): Promise<{ success: boolean; imagesProcessed?: number; error?: string }> {
  try {
    // Skip if not public
    if (data.isPublic !== true) {
      return { success: false, error: 'Not public' };
    }

    // Skip if deleted
    if (data.isDeleted === true) {
      return { success: false, error: 'Deleted' };
    }

    // Validate images exist
    if (!data.images || data.images.length === 0) {
      return { success: false, error: 'No images found' };
    }

    // Skip if all images already have thumbnails
    if (allImagesHaveThumbnails(data.images)) {
      return { success: false, error: 'Already has thumbnails' };
    }

    // Check if images are from Zata storage (skip external URLs like fal.media)
    const firstImage = data.images[0];
    const imageUrl = typeof firstImage === 'string' ? firstImage : firstImage?.url;
    if (!imageUrl || !imageUrl.includes('zata.ai')) {
      return { success: false, error: 'Skipped - External URL (not from Zata storage)' };
    }

    // Get uid from data
    const uid = data.uid;
    if (!uid) {
      return { success: false, error: 'No uid found' };
    }

    // Dry run mode - just log what would be done
    if (dryRun) {
      logger.info(`[OptimizePublicFeed] [DRY RUN] Would optimize generation ${historyId} for uid ${uid}`);
      return { success: true, imagesProcessed: data.images.length };
    }

    // Optimize each image that doesn't have a thumbnail
    const imageCount = data.images.length;
    let optimizedCount = 0;
    
    for (let i = 0; i < imageCount; i++) {
      const image = data.images[i];
      
      // Skip if this image already has a thumbnail
      if (hasThumbnail(image)) {
        continue;
      }
      
      try {
        await imageOptimizationService.optimizeExistingImage(uid, historyId, i);
        optimizedCount++;
        logger.info(`[OptimizePublicFeed] Optimized image ${i + 1}/${imageCount} for ${historyId}`);
      } catch (error: any) {
        // Log but continue with other images
        logger.warn(`[OptimizePublicFeed] Failed to optimize image ${i + 1} for ${historyId}:`, error.message);
      }
    }

    if (optimizedCount === 0) {
      return { success: false, error: 'No images needed optimization' };
    }

    return { success: true, imagesProcessed: optimizedCount };
  } catch (error: any) {
    const errorMsg = error.message || '';
    
    // Check for specific error types that should be skipped
    if (errorMsg.includes('maxContentLength') || 
        errorMsg.includes('exceeded') ||
        errorMsg.includes('extract storage path') ||
        errorMsg.includes('Failed to download image') ||
        errorMsg.includes('404') ||
        errorMsg.includes('Request failed') ||
        errorMsg.includes('Already optimized')) {
      logger.warn(`[OptimizePublicFeed] Skipped generation ${historyId}: ${errorMsg}`);
      return { success: false, error: 'Skipped - ' + errorMsg };
    }
    
    logger.error(`[OptimizePublicFeed] Failed to optimize generation ${historyId}: ${errorMsg}`);
    
    return { success: false, error: error.message };
  }
}

/**
 * Process a batch of public feed generations
 */
async function processBatch(
  options: OptimizationOptions,
  lastDocSnapshot?: FirebaseFirestore.QueryDocumentSnapshot
): Promise<{
  stats: Partial<OptimizationStats>;
  hasMore: boolean;
  lastDocSnapshot?: FirebaseFirestore.QueryDocumentSnapshot;
}> {
  const stats: Partial<OptimizationStats> = {
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Query public feed (generations collection)
    // Note: Firestore doesn't support != queries well, so we filter isDeleted in memory
    let query = adminDb
      .collection('generations')
      .where('isPublic', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(options.batchSize * 2); // Fetch more to account for filtering

    // Pagination - start after last document snapshot
    if (lastDocSnapshot) {
      query = query.startAfter(lastDocSnapshot);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      return { stats, hasMore: false };
    }

    // Process each generation (filter deleted items)
    for (const doc of snapshot.docs) {
      try {
        const data = doc.data();
        
        // Skip deleted items
        if (data.isDeleted === true) {
          continue;
        }
        
        const historyId = doc.id;
        const uid = data.uid;

        stats.totalProcessed = (stats.totalProcessed || 0) + 1;

        const result = await optimizePublicGeneration(historyId, data, options.dryRun);

        // Check if should be skipped
        if (result.error && (
          result.error === 'Already has thumbnails' || 
          result.error === 'Not public' ||
          result.error === 'Deleted' ||
          result.error === 'No images found' ||
          result.error.startsWith('Skipped -') ||
          result.error === 'No images needed optimization'
        )) {
          stats.skipped = (stats.skipped || 0) + 1;
        } else if (result.success) {
          stats.successful = (stats.successful || 0) + 1;
        } else {
          stats.failed = (stats.failed || 0) + 1;
          stats.errors?.push({
            historyId,
            uid: uid || 'unknown',
            error: result.error || 'Unknown error',
          });
        }
      } catch (error: any) {
        // Handle unexpected errors at document level
        const data = doc.data();
        const historyId = doc.id;
        const uid = data.uid || 'unknown';
        
        stats.totalProcessed = (stats.totalProcessed || 0) + 1;
        stats.failed = (stats.failed || 0) + 1;
        
        const errorMsg = error?.message || error?.toString() || 'Unknown error';
        logger.error(`[OptimizePublicFeed] Unexpected error processing ${historyId}:`, errorMsg);
        
        stats.errors?.push({
          historyId,
          uid,
          error: `Unexpected error: ${errorMsg}`,
        });
      }
    }

    // Use the last processed doc for pagination (or last doc if none processed)
    const lastProcessedDoc = snapshot.docs[snapshot.docs.length - 1];
    
    return {
      stats,
      hasMore: snapshot.size >= options.batchSize, // Continue if we got a full batch
      lastDocSnapshot: lastProcessedDoc,
    };
  } catch (error: any) {
    const errorMsg = error?.message || error?.toString() || 'Unknown batch error';
    logger.error('[OptimizePublicFeed] Batch processing failed:', errorMsg);
    
    // Return partial stats instead of throwing
    return {
      stats: {
        ...stats,
        failed: (stats.failed || 0) + 1,
        errors: [
          ...(stats.errors || []),
          {
            historyId: 'batch',
            uid: 'batch',
            error: `Batch error: ${errorMsg}`,
          },
        ],
      },
      hasMore: false, // Stop processing on batch error
    };
  }
}

/**
 * Main optimization function
 */
async function optimizePublicFeed() {
  const options = parseArguments();

  console.log('\n🚀 Starting Public Feed Image Optimization\n');
  console.log('Configuration:');
  console.log(`  - Batch Size: ${options.batchSize}`);
  console.log(`  - Delay: ${options.delay}ms`);
  console.log(`  - Dry Run: ${options.dryRun ? 'YES' : 'NO'}`);
  console.log('\n');

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }

  const totalStats: OptimizationStats = {
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  let batchNumber = 0;
  let hasMore = true;
  let lastDocSnapshot: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  const startTime = Date.now();

  try {
    while (hasMore) {
      batchNumber++;
      console.log(`\n📦 Processing Batch #${batchNumber}...`);

      try {
        const { stats, hasMore: more, lastDocSnapshot: lastSnapshot } = await processBatch(
          options,
          lastDocSnapshot
        );

        // Update totals
        totalStats.totalProcessed += stats.totalProcessed || 0;
        totalStats.successful += stats.successful || 0;
        totalStats.failed += stats.failed || 0;
        totalStats.skipped += stats.skipped || 0;
        totalStats.errors.push(...(stats.errors || []));

        console.log(`  ✅ Successful: ${stats.successful}`);
        console.log(`  ⏭️  Skipped: ${stats.skipped}`);
        console.log(`  ❌ Failed: ${stats.failed}`);

        hasMore = more;
        lastDocSnapshot = lastSnapshot;

        if (hasMore) {
          console.log(`\n⏳ Waiting ${options.delay}ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, options.delay));
        }
      } catch (batchError: any) {
        const errorMsg = batchError?.message || batchError?.toString() || 'Unknown batch error';
        console.error(`  ❌ Batch #${batchNumber} failed: ${errorMsg}`);
        logger.error(`[OptimizePublicFeed] Batch #${batchNumber} error:`, errorMsg);
        
        totalStats.failed += 1;
        totalStats.errors.push({
          historyId: `batch-${batchNumber}`,
          uid: 'batch',
          error: `Batch processing error: ${errorMsg}`,
        });
        
        // Continue to next batch instead of stopping
        console.log('  ⏭️  Continuing to next batch...');
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n\n✨ Optimization Complete!\n');
    console.log('═══════════════════════════════════════');
    console.log(`Total Time: ${duration}s`);
    console.log(`Batches Processed: ${batchNumber}`);
    console.log(`Total Generations: ${totalStats.totalProcessed}`);
    console.log(`  ✅ Successful: ${totalStats.successful}`);
    console.log(`  ⏭️  Skipped: ${totalStats.skipped}`);
    console.log(`  ❌ Failed: ${totalStats.failed}`);
    console.log('═══════════════════════════════════════\n');

    if (totalStats.errors.length > 0) {
      console.log('⚠️  Errors encountered:\n');
      
      // Group errors by type
      const errorTypes: { [key: string]: number } = {};
      totalStats.errors.forEach(err => {
        const errorType = err.error.split(':')[0] || 'Unknown';
        errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
      });
      
      console.log('Error Summary:');
      Object.entries(errorTypes).forEach(([type, count]) => {
        console.log(`  - ${type}: ${count} occurrences`);
      });
      
      console.log('\nFirst 10 errors:');
      totalStats.errors.slice(0, 10).forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err.historyId} (${err.uid}):`);
        console.log(`     ${err.error}`);
      });
      
      if (totalStats.errors.length > 10) {
        console.log(`\n  ... and ${totalStats.errors.length - 10} more errors`);
      }
      console.log('\n');
    }

    if (options.dryRun) {
      console.log('ℹ️  This was a dry run. Run without --dry-run to apply changes.\n');
    } else {
      console.log('✅ All optimizations have been applied!\n');
    }

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Optimization failed:', error.message);
    logger.error('[OptimizePublicFeed] Fatal error');
    process.exit(1);
  }
}

// Run optimization if this file is executed directly
if (require.main === module) {
  optimizePublicFeed();
}

export { optimizePublicFeed, parseArguments, optimizePublicGeneration };

