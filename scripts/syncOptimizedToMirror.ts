/**
 * Sync Script: Sync Optimized Images to Mirror Collection
 * 
 * This script syncs the optimized image URLs from generationHistory/{uid}/items/{historyId}
 * to the generations (mirror) collection so they appear in the Art Station feed.
 * 
 * Usage:
 *   npx ts-node scripts/syncOptimizedToMirror.ts
 * 
 * Options:
 *   --batch-size=20      Number of generations to process per batch
 *   --delay=1000         Delay between batches in milliseconds
 *   --dry-run            Preview what would be synced without making changes
 * 
 * Examples:
 *   npx ts-node scripts/syncOptimizedToMirror.ts
 *   npx ts-node scripts/syncOptimizedToMirror.ts --batch-size=10 --dry-run
 */

import 'dotenv/config';
import { adminDb } from '../src/config/firebaseAdmin';

interface SyncOptions {
  batchSize: number;
  delay: number;
  dryRun: boolean;
}

interface SyncStats {
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
function parseArguments(): SyncOptions {
  const args = process.argv.slice(2);
  
  console.log('DEBUG: Received arguments:', args);
  
  const options: SyncOptions = {
    batchSize: 20,
    delay: 1000,
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
 * Check if item has optimized images
 */
function hasOptimizedImages(data: any): boolean {
  if (!data.images || !Array.isArray(data.images) || data.images.length === 0) {
    return false;
  }

  // Check if at least one image has optimization fields
  return data.images.some((img: any) => 
    img && typeof img === 'object' && (img.optimized || img.webpUrl || img.thumbnailUrl)
  );
}

/**
 * Sync a single generation to mirror
 */
async function syncToMirror(
  uid: string,
  historyId: string,
  data: any,
  dryRun: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if has optimized images
    if (!hasOptimizedImages(data)) {
      return { success: false, error: 'No optimized images' };
    }

    // Dry run mode - just log what would be done
    if (dryRun) {
      console.log('[Sync] [DRY RUN] Would sync to mirror', { historyId, uid, imageCount: data.images.length });
      return { success: true };
    }

    // Update the mirror collection with the optimized images
    const mirrorRef = adminDb.collection('generations').doc(historyId);
    
    // Check if mirror document exists
    const mirrorDoc = await mirrorRef.get();
    if (!mirrorDoc.exists) {
      return { success: false, error: 'Mirror document does not exist' };
    }

    // Check if mirror already has optimized images - skip if already optimized
    const mirrorData = mirrorDoc.data();
    if (mirrorData?.images && Array.isArray(mirrorData.images) && mirrorData.images.length > 0) {
      const firstMirrorImage = mirrorData.images[0];
      // Check if mirror already has optimized fields (thumbnailUrl, avifUrl, or optimized flag)
      if (firstMirrorImage && typeof firstMirrorImage === 'object' && 
          (firstMirrorImage.thumbnailUrl || firstMirrorImage.avifUrl || firstMirrorImage.optimized)) {
        return { success: false, error: 'Already optimized in mirror' };
      }
    }

    // Update only the images field with optimized URLs
    await mirrorRef.update({
      images: data.images,
      updatedAt: Date.now(),
    });

    console.log('[Sync] Successfully synced to mirror', { historyId, uid, imageCount: data.images.length });
    return { success: true };
  } catch (error: any) {
    console.error('[Sync] Failed to sync to mirror', { historyId, uid, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Process a batch of generations
 */
async function processBatch(
  options: SyncOptions,
  lastDocSnapshot?: FirebaseFirestore.QueryDocumentSnapshot
): Promise<{
  stats: Partial<SyncStats>;
  hasMore: boolean;
  lastDocSnapshot?: FirebaseFirestore.QueryDocumentSnapshot;
}> {
  const stats: Partial<SyncStats> = {
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Query the generationHistory collection group
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
      const data = doc.data();
      
      // Extract uid from document path
      const pathParts = doc.ref.path.split('/');
      const uid = pathParts[pathParts.length - 3];
      const historyId = doc.id;

      stats.totalProcessed = (stats.totalProcessed || 0) + 1;

      const result = await syncToMirror(uid, historyId, data, options.dryRun);

      if (result.success) {
        stats.successful = (stats.successful || 0) + 1;
      } else {
        if (result.error === 'No optimized images' || 
            result.error === 'Mirror document does not exist' ||
            result.error === 'Already optimized in mirror') {
          stats.skipped = (stats.skipped || 0) + 1;
        } else {
          stats.failed = (stats.failed || 0) + 1;
          stats.errors?.push({
            uid,
            historyId,
            error: result.error || 'Unknown error',
          });
        }
      }
    }

    return {
      stats,
      hasMore: snapshot.size === options.batchSize,
      lastDocSnapshot: snapshot.docs[snapshot.docs.length - 1],
    };
  } catch (error: any) {
    console.error('[Sync] Batch processing failed', { error: error.message });
    throw error;
  }
}

/**
 * Main sync function
 */
async function syncOptimized() {
  const options = parseArguments();

  console.log('\n🔄 Starting Optimized Images Sync to Mirror Collection\n');
  console.log('Configuration:');
  console.log(`  - Batch Size: ${options.batchSize}`);
  console.log(`  - Delay: ${options.delay}ms`);
  console.log(`  - Dry Run: ${options.dryRun ? 'YES' : 'NO'}`);
  console.log('\n');

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }

  const totalStats: SyncStats = {
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

      const { stats, hasMore: more, lastDocSnapshot: lastSnapshot } = await processBatch(
        options,
        lastDocSnapshot
      );

      // Update totals
      totalStats.totalProcessed += stats.totalProcessed || 0;
      totalStats.successful += stats.successful || 0;
      totalStats.failed += stats.failed || 0;
      totalStats.skipped += stats.skipped || 0;
      if (stats.errors) {
        totalStats.errors.push(...stats.errors);
      }

      console.log(`   Processed: ${stats.totalProcessed}`);
      console.log(`   Synced: ${stats.successful}`);
      console.log(`   Skipped: ${stats.skipped}`);
      console.log(`   Failed: ${stats.failed}`);

      hasMore = more;
      lastDocSnapshot = lastSnapshot;

      // Delay between batches to avoid rate limits
      if (hasMore && options.delay > 0) {
        console.log(`   Waiting ${options.delay}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, options.delay));
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('\n✨ Sync Complete!\n');
    console.log('Final Statistics:');
    console.log(`  Total Processed: ${totalStats.totalProcessed}`);
    console.log(`  Successfully Synced: ${totalStats.successful}`);
    console.log(`  Skipped: ${totalStats.skipped}`);
    console.log(`  Failed: ${totalStats.failed}`);
    console.log(`  Duration: ${duration}s`);

    if (totalStats.errors.length > 0) {
      console.log('\n❌ Errors:');
      totalStats.errors.slice(0, 10).forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err.historyId} (${err.uid}): ${err.error}`);
      });
      if (totalStats.errors.length > 10) {
        console.log(`  ... and ${totalStats.errors.length - 10} more errors`);
      }
    }

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Sync failed:', error.message);
    process.exit(1);
  }
}

// Run the sync
syncOptimized();
