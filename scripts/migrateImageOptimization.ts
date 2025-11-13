/**
 * Migration Script: Optimize Existing Generation Images
 * 
 * This script optimizes images from existing generations that were created
 * before the image optimization system was implemented.
 * 
 * Usage:
 *   npm run migrate:optimize-images
 * 
 * Options:
 *   --batch-size=10      Number of generations to process per batch
 *   --delay=2000         Delay between batches in milliseconds
 *   --dry-run            Preview what would be optimized without making changes
 *   --generation-type    Filter by generation type (e.g., text-to-image)
 *   --start-date         Process only generations after this date (YYYY-MM-DD)
 *   --end-date           Process only generations before this date (YYYY-MM-DD)
 * 
 * Examples:
 *   npm run migrate:optimize-images
 *   npm run migrate:optimize-images -- --batch-size=5 --delay=3000
 *   npm run migrate:optimize-images -- --dry-run
 *   npm run migrate:optimize-images -- --generation-type=text-to-image
 */

// Load environment variables first
import 'dotenv/config';

import { adminDb } from '../src/config/firebaseAdmin';
import { imageOptimizationService } from '../src/services/imageOptimizationService';
import { logger } from '../src/utils/logger';

interface MigrationOptions {
  batchSize: number;
  delay: number;
  dryRun: boolean;
  generationType?: string;
  startDate?: Date;
  endDate?: Date;
}

interface MigrationStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: Array<{
    uid: string;
    historyId: string;
    error: string;
  }>;
}

/**
 * Parse command line arguments
 */
function parseArguments(): MigrationOptions {
  const args = process.argv.slice(2);
  
  // Debug: log received arguments
  console.log('DEBUG: Received arguments:', args);
  
  const options: MigrationOptions = {
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
    } else if (arg.startsWith('--generation-type=')) {
      options.generationType = arg.split('=')[1];
    } else if (arg.startsWith('--start-date=')) {
      options.startDate = new Date(arg.split('=')[1]);
    } else if (arg.startsWith('--end-date=')) {
      options.endDate = new Date(arg.split('=')[1]);
    }
  });

  return options;
}

/**
 * Check if an image is already optimized
 */
function isImageOptimized(image: any): boolean {
  if (typeof image === 'string') {
    return false; // Legacy string format, needs optimization
  }
  
  if (typeof image === 'object' && image !== null) {
    // Check if it has optimized URLs or the optimized flag
    return Boolean(image.optimized || image.avifUrl || image.thumbnailUrl);
  }
  
  return false;
}

/**
 * Optimize a single generation's images
 */
async function optimizeGeneration(
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

    // Check if already optimized
    const firstImage = data.images[0];
    if (isImageOptimized(firstImage)) {
      return { success: false, error: 'Already optimized' };
    }

    // Check if image is from Zata storage (skip external URLs)
    const imageUrl = typeof firstImage === 'string' ? firstImage : firstImage?.url;
    if (!imageUrl || !imageUrl.includes('zata.ai')) {
      return { success: false, error: 'Skipped - External URL (not from Zata storage)' };
    }

    // Dry run mode - just log what would be done
    if (dryRun) {
      logger.info('[Migration] [DRY RUN] Would optimize generation');
      return { success: true, imagesProcessed: data.images.length };
    }

    // Optimize each image
    const imageCount = data.images.length;
    
    for (let i = 0; i < imageCount; i++) {
      await imageOptimizationService.optimizeExistingImage(uid, historyId, i);
      logger.info(`[Migration] Optimized image ${i + 1}/${imageCount}`);
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
        errorMsg.includes('Request failed') ||
        errorMsg.includes('Already optimized')) {
      logger.warn(`[Migration] Skipped generation ${historyId}: ${errorMsg}`);
      return { success: false, error: 'Skipped - ' + errorMsg };
    }
    
    logger.error(`[Migration] Failed to optimize generation ${historyId}: ${errorMsg}`);
    logger.error(`[Migration] Image URL: ${imageUrl}`);
    
    return { success: false, error: error.message };
  }
}

/**
 * Process a batch of generations
 */
async function processBatch(
  options: MigrationOptions,
  lastDocSnapshot?: FirebaseFirestore.QueryDocumentSnapshot
): Promise<{
  stats: Partial<MigrationStats>;
  hasMore: boolean;
  lastDocSnapshot?: FirebaseFirestore.QueryDocumentSnapshot;
}> {
  const stats: Partial<MigrationStats> = {
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Build query - using 'items' collection group which is the actual subcollection
    // Structure: generationHistory/{uid}/items/{historyId}
    let query = adminDb
      .collectionGroup('items')
      .where('status', '==', 'completed')
      .orderBy('createdAt', 'desc')
      .limit(options.batchSize);

    // Filter by generation type
    if (options.generationType) {
      query = query.where('generationType', '==', options.generationType);
    }

    // Filter by date range
    if (options.startDate) {
      query = query.where('createdAt', '>=', options.startDate.getTime());
    }
    if (options.endDate) {
      query = query.where('createdAt', '<=', options.endDate.getTime());
    }

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
        const uid = pathParts[pathParts.length - 3];
        const historyId = doc.id;

        stats.totalProcessed = (stats.totalProcessed || 0) + 1;

        const result = await optimizeGeneration(uid, historyId, data, options.dryRun);

        // Check if already optimized or should be skipped
        if (result.error && (result.error === 'Already optimized' || result.error.startsWith('Skipped -'))) {
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
        const uid = pathParts[pathParts.length - 3];
        const historyId = doc.id;
        
        stats.totalProcessed = (stats.totalProcessed || 0) + 1;
        stats.failed = (stats.failed || 0) + 1;
        
        const errorMsg = error?.message || error?.toString() || 'Unknown error';
        logger.error(`[Migration] Unexpected error processing ${historyId}:`, errorMsg);
        
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
    logger.error('[Migration] Batch processing failed:', errorMsg);
    
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
      hasMore: false, // Stop processing on batch error
    };
  }
}

/**
 * Main migration function
 */
async function migrate() {
  const options = parseArguments();

  console.log('\n🚀 Starting Image Optimization Migration\n');
  console.log('Configuration:');
  console.log(`  - Batch Size: ${options.batchSize}`);
  console.log(`  - Delay: ${options.delay}ms`);
  console.log(`  - Dry Run: ${options.dryRun ? 'YES' : 'NO'}`);
  if (options.generationType) {
    console.log(`  - Generation Type: ${options.generationType}`);
  }
  if (options.startDate) {
    console.log(`  - Start Date: ${options.startDate.toISOString()}`);
  }
  if (options.endDate) {
    console.log(`  - End Date: ${options.endDate.toISOString()}`);
  }
  console.log('\n');

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }

  const totalStats: MigrationStats = {
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
        logger.error(`[Migration] Batch #${batchNumber} error:`, errorMsg);
        
        totalStats.failed += 1;
        totalStats.errors.push({
          uid: 'batch',
          historyId: `batch-${batchNumber}`,
          error: `Batch processing error: ${errorMsg}`,
        });
        
        // Continue to next batch instead of stopping
        console.log('  ⏭️  Continuing to next batch...');
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n\n✨ Migration Complete!\n');
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
      console.log('✅ All optimizations have been applied!\n');
    }

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('Project Id')) {
      console.log('\n💡 Firebase Authentication Issue:');
      console.log('  1. Make sure your .env file has Firebase credentials set');
      console.log('  2. Check FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_B64');
      console.log('  3. Or set GOOGLE_APPLICATION_CREDENTIALS environment variable\n');
      console.log('  Example .env:');
      console.log('    FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}');
      console.log('    FIREBASE_STORAGE_BUCKET=your-project.appspot.com\n');
    }
    
    logger.error('[Migration] Fatal error');
    process.exit(1);
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrate();
}

export { migrate, parseArguments, optimizeGeneration };
