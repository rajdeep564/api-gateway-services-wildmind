/**
 * Cleanup Script: Remove incorrectly stored thumbnails and optimized images
 * 
 * This script removes thumbnails and optimized images that were stored in the wrong path:
 * - REMOVES: users/{uid}/generations/{historyId}/*_optimized.webp
 * - REMOVES: users/{uid}/generations/{historyId}/*_thumb.webp
 * - KEEPS: Original generation images (e.g., users/rajdeop/image/*)
 * 
 * Usage:
 *   npx ts-node scripts/cleanupWrongThumbnails.ts
 * 
 * Options:
 *   --dry-run            Preview what would be deleted without actually deleting
 *   --batch-size=50      Number of files to delete per batch
 * 
 * Examples:
 *   npx ts-node scripts/cleanupWrongThumbnails.ts --dry-run
 *   npx ts-node scripts/cleanupWrongThumbnails.ts --batch-size=100
 */

import 'dotenv/config';
import { 
  ListObjectsV2Command, 
  DeleteObjectCommand,
  _Object 
} from '@aws-sdk/client-s3';
import { s3, ZATA_BUCKET } from '../src/utils/storage/zataClient';

interface CleanupOptions {
  dryRun: boolean;
  batchSize: number;
}

interface CleanupStats {
  scanned: number;
  markedForDeletion: number;
  deleted: number;
  skipped: number;
  errors: Array<{
    path: string;
    error: string;
  }>;
}

/**
 * Parse command line arguments
 */
function parseArguments(): CleanupOptions {
  const args = process.argv.slice(2);
  
  const options: CleanupOptions = {
    dryRun: false,
    batchSize: 50,
  };

  args.forEach((arg: string) => {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1], 10);
    }
  });

  return options;
}

/**
 * Check if a file path is a wrongly stored thumbnail/optimized image
 */
function shouldDelete(path: string): boolean {
  // Pattern: users/{uid}/generations/{historyId}/*
  // We want to delete files in this pattern that are thumbnails or optimized images
  
  // Must be in users/.../generations/... path
  if (!path.includes('/generations/')) {
    return false;
  }

  // Must be an optimized or thumbnail file
  if (path.endsWith('_optimized.webp') || 
      path.endsWith('_thumb.webp') || 
      path.endsWith('_optimized.avif')) {
    return true;
  }

  return false;
}

/**
 * Scan Zata Storage for wrongly stored files
 */
async function scanForWrongFiles(): Promise<string[]> {
  console.log('🔍 Scanning Zata Storage for incorrectly stored thumbnails...\n');
  
  try {
    // List all files in the users directory
    const prefix = 'users/';
    console.log(`Scanning prefix: ${prefix}`);
    
    const files = await listFilesInZata(prefix);
    
    console.log(`\n✅ Found ${files.length} total files\n`);
    
    // Filter for files that should be deleted
    const filesToDelete = files.filter(file => shouldDelete(file.path));
    
    console.log(`📋 Identified ${filesToDelete.length} files to delete:\n`);
    
    // Group by pattern for display
    const byPattern: Record<string, number> = {};
    filesToDelete.forEach(file => {
      if (file.path.endsWith('_optimized.webp')) {
        byPattern['_optimized.webp'] = (byPattern['_optimized.webp'] || 0) + 1;
      } else if (file.path.endsWith('_thumb.webp')) {
        byPattern['_thumb.webp'] = (byPattern['_thumb.webp'] || 0) + 1;
      } else if (file.path.endsWith('_optimized.avif')) {
        byPattern['_optimized.avif'] = (byPattern['_optimized.avif'] || 0) + 1;
      }
    });
    
    Object.entries(byPattern).forEach(([pattern, count]) => {
      console.log(`  ${pattern}: ${count} files`);
    });
    
    console.log('');
    
    return filesToDelete.map(f => f.path);
  } catch (error: any) {
    console.error('❌ Error scanning Zata Storage:', error.message);
    throw error;
  }
}

/**
 * Delete a batch of files
 */
async function deleteBatch(
  paths: string[],
  options: CleanupOptions,
  stats: CleanupStats
): Promise<void> {
  for (const path of paths) {
    stats.scanned++;
    
    try {
      if (options.dryRun) {
        console.log(`[DRY RUN] Would delete: ${path}`);
        stats.markedForDeletion++;
      } else {
        await deleteFileFromZata(path);
        console.log(`✅ Deleted: ${path}`);
        stats.deleted++;
      }
    } catch (error: any) {
      console.error(`❌ Failed to delete ${path}:`, error.message);
      stats.errors.push({
        path,
        error: error.message,
      });
    }
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/**
 * Main cleanup function
 */
async function cleanup() {
  const options = parseArguments();

  console.log('\n🧹 Starting Thumbnail Cleanup\n');
  console.log('Configuration:');
  console.log(`  - Dry Run: ${options.dryRun ? 'YES' : 'NO'}`);
  console.log(`  - Batch Size: ${options.batchSize}`);
  console.log('\n');

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No files will be deleted\n');
  } else {
    console.log('⚠️  WARNING: This will permanently delete files from Zata Storage!\n');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const stats: CleanupStats = {
    scanned: 0,
    markedForDeletion: 0,
    deleted: 0,
    skipped: 0,
    errors: [],
  };

  const startTime = Date.now();

  try {
    // Scan for files to delete
    const filesToDelete = await scanForWrongFiles();
    
    if (filesToDelete.length === 0) {
      console.log('✅ No files found to delete. Cleanup not needed.\n');
      process.exit(0);
    }

    console.log(`\nStarting deletion of ${filesToDelete.length} files...\n`);

    // Process in batches
    for (let i = 0; i < filesToDelete.length; i += options.batchSize) {
      const batch = filesToDelete.slice(i, i + options.batchSize);
      const batchNum = Math.floor(i / options.batchSize) + 1;
      const totalBatches = Math.ceil(filesToDelete.length / options.batchSize);
      
      console.log(`\n📦 Processing Batch ${batchNum}/${totalBatches} (${batch.length} files)...\n`);
      
      await deleteBatch(batch, options, stats);
      
      console.log(`\nBatch ${batchNum} complete. Progress: ${Math.min(i + options.batchSize, filesToDelete.length)}/${filesToDelete.length} files\n`);
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('\n✨ Cleanup Complete!\n');
    console.log('Final Statistics:');
    console.log(`  Total Scanned: ${stats.scanned}`);
    
    if (options.dryRun) {
      console.log(`  Marked for Deletion: ${stats.markedForDeletion}`);
    } else {
      console.log(`  Successfully Deleted: ${stats.deleted}`);
    }
    
    console.log(`  Errors: ${stats.errors.length}`);
    console.log(`  Duration: ${duration}s`);

    if (stats.errors.length > 0) {
      console.log('\n❌ Errors:');
      stats.errors.slice(0, 10).forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err.path}: ${err.error}`);
      });
      if (stats.errors.length > 10) {
        console.log(`  ... and ${stats.errors.length - 10} more errors`);
      }
    }

    console.log('\n');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Cleanup failed:', error.message);
    process.exit(1);
  }
}

// Run the cleanup
cleanup();
