/**
 * Fix Wrong Path Optimizations Script
 * 
 * This script re-optimizes images that were optimized with wrong paths
 * (e.g., users/{uid}/generations/{historyId} instead of users/{username}/image/{historyId})
 * 
 * Usage:
 *   npx ts-node scripts/fixWrongPathOptimizations.ts
 * 
 * Options:
 *   --batch-size=10      Number of generations to process per batch
 *   --delay=2000         Delay between batches in milliseconds
 *   --dry-run            Preview what would be fixed without making changes
 */

// Load environment variables first
import 'dotenv/config';

import { adminDb } from '../src/config/firebaseAdmin';
import { imageOptimizationService } from '../src/services/imageOptimizationService';
import { logger } from '../src/utils/logger';

interface FixOptions {
  batchSize: number;
  delay: number;
  dryRun: boolean;
}

interface FixStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: Array<{ uid: string; historyId: string; error: string }>;
}

/**
 * Parse command line arguments
 */
function parseArguments(): FixOptions {
  const args = process.argv.slice(2);
  const options: FixOptions = {
    batchSize: 10,
    delay: 2000,
    dryRun: false,
  };

  args.forEach(arg => {
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
 * Check if image has wrong path optimization
 */
function hasWrongPathOptimization(image: any): boolean {
  if (typeof image !== 'object' || !image.optimized) {
    return false;
  }

  // Check if avifUrl or webpUrl or thumbnailUrl contains wrong path pattern
  const avifUrl = image.avifUrl || '';
  const webpUrl = image.webpUrl || '';
  const thumbnailUrl = image.thumbnailUrl || '';

  // Wrong pattern: users/{uid}/generations/{historyId}
  // Correct pattern: users/{username}/image/{historyId}
  const hasWrongPattern = 
    avifUrl.includes('/generations/') ||
    webpUrl.includes('/generations/') ||
    thumbnailUrl.includes('/generations/');

  return hasWrongPattern;
}

/**
 * Fix a single generation's images
 */
async function fixGeneration(
  uid: string,
  historyId: string,
  data: any,
  dryRun: boolean
): Promise<{ success: boolean; imagesProcessed?: number; error?: string }> {
  try {
    // Validate images exist
    if (!data.images || data.images.length === 0) {
      return { success: false, error: 'No images found' };
    }

    // Check if any image has wrong path optimization
    const firstImage = data.images[0];
    if (!hasWrongPathOptimization(firstImage)) {
      return { success: false, error: 'Correct path (no fix needed)' };
    }

    // Check if image is from Zata storage (skip external URLs)
    const imageUrl = typeof firstImage === 'string' ? firstImage : firstImage?.url;
    if (!imageUrl || !imageUrl.includes('zata.ai')) {
      return { success: false, error: 'Skipped - External URL (not from Zata storage)' };
    }

    // Dry run mode - just log what would be done
    if (dryRun) {
      logger.info('[Fix] [DRY RUN] Would re-optimize generation with correct paths');
      return { success: true, imagesProcessed: data.images.length };
    }

    // Re-optimize each image
    const imageCount = data.images.length;
    
    for (let i = 0; i < imageCount; i++) {
      // Force re-optimization by temporarily marking as not optimized
      const image = data.images[i];
      if (typeof image === 'object') {
        // Remove old optimization data
        delete image.avifUrl;
        delete image.webpUrl;
        delete image.thumbnailUrl;
        delete image.blurDataUrl;
        delete image.optimized;
        delete image.optimizedAt;
        
        // Update Firestore
        await adminDb
          .collection('generationHistory')
          .doc(uid)
          .collection('items')
          .doc(historyId)
          .update({ images: data.images });
      }
      
      // Now re-optimize with correct paths
      await imageOptimizationService.optimizeExistingImage(uid, historyId, i);
      logger.info(`[Fix] Re-optimized image ${i + 1}/${imageCount} with correct paths`);
    }

    return { success: true, imagesProcessed: imageCount };
  } catch (error: any) {
    const errorMsg = error.message || '';
    
    // Get image URL for better error reporting
    const imageUrl = typeof data.images[0] === 'string' 
      ? data.images[0] 
      : data.images[0]?.url || 'unknown';
    
    // Check for specific error types that should be skipped
    if (errorMsg.includes('maxContentLength') || 
        errorMsg.includes('exceeded') ||
        errorMsg.includes('extract storage path') ||
        errorMsg.includes('Failed to download image') ||
        errorMsg.includes('404') ||
        errorMsg.includes('Request failed')) {
      logger.warn(`[Fix] Skipped generation ${historyId}: ${errorMsg}`);
      return { success: false, error: 'Skipped - ' + errorMsg };
    }
    
    logger.error(`[Fix] Failed to fix generation ${historyId}: ${errorMsg}`);
    logger.error(`[Fix] Image URL: ${imageUrl}`);
    
    return { success: false, error: error.message };
  }
}

/**
 * Process a batch of generations
 */
async function processBatch(
  options: FixOptions,
  lastDocSnapshot?: FirebaseFirestore.QueryDocumentSnapshot
): Promise<{
  stats: Partial<FixStats>;
  hasMore: boolean;
  lastDocSnapshot?: FirebaseFirestore.QueryDocumentSnapshot;
}> {
  const stats: Partial<FixStats> = {
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Build query - using 'items' collection group
    let query = adminDb
      .collectionGroup('items')
      .where('status', '==', 'completed')
      .orderBy('createdAt', 'desc')
      .limit(options.batchSize);

    // Pagination - start after last document snapshot
    if (lastDocSnapshot) {
      query = query.startAfter(lastDocSnapshot);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      return { stats, hasMore: false };
    }

    // Process each generation
    for (const doc of snapshot.docs) {
      try {
        const data = doc.data();
        
        // Extract uid from document path
        const pathParts = doc.ref.path.split('/');
        const uid = pathParts[1];
        const historyId = doc.id;

        stats.totalProcessed = (stats.totalProcessed || 0) + 1;

        const result = await fixGeneration(uid, historyId, data, options.dryRun);

        // Check result
        if (result.error && result.error === 'Correct path (no fix needed)') {
          stats.skipped = (stats.skipped || 0) + 1;
        } else if (result.error && result.error.startsWith('Skipped -')) {
          stats.skipped = (stats.skipped || 0) + 1;
        } else if (result.success) {
          stats.successful = (stats.successful || 0) + 1;
        } else {
          stats.failed = (stats.failed || 0) + 1;
          stats.errors?.push({
            uid,
            historyId,
            error: result.error || 'Unknown error',
          });
        }
      } catch (error: any) {
        // Handle unexpected errors at document level
        const pathParts = doc.ref.path.split('/');
        const uid = pathParts[1];
        const historyId = doc.id;
        
        stats.totalProcessed = (stats.totalProcessed || 0) + 1;
        stats.failed = (stats.failed || 0) + 1;
        
        const errorMsg = error?.message || error?.toString() || 'Unknown error';
        logger.error(`[Fix] Unexpected error processing ${historyId}:`, errorMsg);
        
        stats.errors?.push({
          uid,
          historyId,
          error: `Unexpected error: ${errorMsg}`,
        });
      }
    }

    return {
      stats,
      hasMore: snapshot.size === options.batchSize,
      lastDocSnapshot: snapshot.docs[snapshot.docs.length - 1],
    };
  } catch (error: any) {
    const errorMsg = error?.message || error?.toString() || 'Unknown batch error';
    logger.error('[Fix] Batch processing failed:', errorMsg);
    
    // Return partial stats instead of throwing
    return {
      stats: {
        ...stats,
        failed: (stats.failed || 0) + 1,
        errors: [
          ...(stats.errors || []),
          {
            uid: 'batch',
            historyId: 'batch',
            error: `Batch error: ${errorMsg}`,
          },
        ],
      },
      hasMore: false,
    };
  }
}

/**
 * Main fix function
 */
async function fix() {
  const options = parseArguments();

  console.log('\n🔧 Starting Wrong Path Optimization Fix\n');
  console.log('Configuration:');
  console.log(`  - Batch Size: ${options.batchSize}`);
  console.log(`  - Delay: ${options.delay}ms`);

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }

  const totalStats: FixStats = {
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

        console.log(`  ✅ Fixed: ${stats.successful}`);
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
        logger.error(`[Fix] Batch #${batchNumber} error:`, errorMsg);
        
        totalStats.failed += 1;
        totalStats.errors.push({
          uid: 'batch',
          historyId: `batch-${batchNumber}`,
          error: `Batch processing error: ${errorMsg}`,
        });
        
        console.log('  ⏭️  Continuing to next batch...');
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n\n✨ Fix Complete!\n');
    console.log('═══════════════════════════════════════');
    console.log(`Total Time: ${duration}s`);
    console.log(`Batches Processed: ${batchNumber}`);
    console.log(`Total Generations: ${totalStats.totalProcessed}`);
    console.log(`  ✅ Fixed: ${totalStats.successful}`);
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
        console.log(`  ${idx + 1}. ${err.uid}/${err.historyId}:`);
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
      console.log('✅ All wrong paths have been fixed!\n');
    }

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Fix failed:', error.message);
    logger.error('[Fix] Fatal error');
    process.exit(1);
  }
}

// Run the fix
fix();
