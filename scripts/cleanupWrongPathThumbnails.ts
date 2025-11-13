/**
 * Cleanup Script: Delete thumbnails and optimized images from wrong storage paths
 * 
 * This script ONLY deletes files matching these patterns in users/{uid}/generations/ path:
 * - *_thumb.avif (thumbnails in AVIF format)
 * - *_optimized.avif (optimized AVIF images)
 * 
 * ⚠️ WARNING: This will NOT delete original generation images
 * 
 * Usage:
 *   npx ts-node scripts/cleanupWrongPathThumbnails.ts
 * 
 * Options:
 *   --dry-run            Preview what would be deleted without actually deleting
 *   --batch-size=100     Number of items to process per batch
 * 
 * Examples:
 *   npx ts-node scripts/cleanupWrongPathThumbnails.ts --dry-run
 *   npx ts-node scripts/cleanupWrongPathThumbnails.ts --batch-size=50
 */

import 'dotenv/config';
import { ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3, ZATA_BUCKET } from '../src/utils/storage/zataClient';

interface CleanupOptions {
  dryRun: boolean;
  batchSize: number;
}

interface CleanupStats {
  totalScanned: number;
  thumbnailsDeleted: number;
  optimizedDeleted: number;
  errors: number;
  skipped: number;
}

/**
 * Parse command line arguments
 */
function parseArguments(): CleanupOptions {
  const args = process.argv.slice(2);
  
  console.log('DEBUG: Received arguments:', args);
  
  const options: CleanupOptions = {
    dryRun: false,
    batchSize: 100,
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
 * Check if file should be deleted (only thumbnails and optimized images)
 */
function shouldDelete(filePath: string): boolean {
  // Only delete files in users/{uid}/generations/ path
  if (!filePath.includes('/generations/')) {
    return false;
  }

  // Only delete AVIF thumbnail and optimized variants
  const fileName = filePath.split('/').pop() || '';
  
  return (
    fileName.endsWith('_thumb.avif') ||
    fileName.endsWith('_optimized.avif')
  );
}

/**
 * List files from Zata Storage with given prefix
 */
async function listFilesFromZata(prefix: string): Promise<string[]> {
  const files: string[] = [];
  let continuationToken: string | undefined = undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: ZATA_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });

    const response = await s3.send(command) as any;

    if (response.Contents) {
      for (const item of response.Contents) {
        if (item.Key) {
          files.push(item.Key);
        }
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return files;
}

/**
 * Delete a file from Zata Storage
 */
async function deleteFileFromZata(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: ZATA_BUCKET,
    Key: key,
  });

  await s3.send(command);
}

/**
 * Get deletion type for statistics
 */
function getDeletionType(filePath: string): 'thumbnail' | 'optimized' | 'skip' {
  if (filePath.endsWith('_thumb.avif')) return 'thumbnail';
  if (filePath.endsWith('_optimized.avif')) return 'optimized';
  return 'skip';
}

/**
 * Cleanup thumbnails from wrong paths
 */
async function cleanup() {
  const options = parseArguments();

  console.log('\n🧹 Starting Thumbnail Cleanup from Wrong Paths\n');
  console.log('Configuration:');
  console.log(`  - Batch Size: ${options.batchSize}`);
  console.log(`  - Dry Run: ${options.dryRun ? 'YES' : 'NO'}`);
  console.log('\n');

  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No files will be deleted\n');
  } else {
    console.log('⚠️  DANGER: Files will be PERMANENTLY DELETED!\n');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const stats: CleanupStats = {
    totalScanned: 0,
    thumbnailsDeleted: 0,
    optimizedDeleted: 0,
    errors: 0,
    skipped: 0,
  };

  const startTime = Date.now();

  try {
    console.log('📂 Scanning Zata Storage for files in users/*/generations/ path...\n');

    // List all files with the wrong path pattern
    const prefix = 'users/';
    let files: string[] = [];
    
    try {
      files = await listFilesFromZata(prefix);
      console.log(`✅ Found ${files.length} total files under "${prefix}"\n`);
    } catch (error: any) {
      console.error('❌ Failed to list files from Zata Storage:', error.message);
      process.exit(1);
    }

    // Filter files that match our criteria
    const filesToDelete = files.filter(shouldDelete);
    
    console.log(`🎯 Found ${filesToDelete.length} files to delete (thumbnails and optimized images)\n`);
    
    if (filesToDelete.length === 0) {
      console.log('✅ No files to delete. Cleanup complete!\n');
      process.exit(0);
    }

    // Group by type for better visibility
    const thumbnails = filesToDelete.filter(f => f.endsWith('_thumb.avif'));
    const optimizedAvif = filesToDelete.filter(f => f.endsWith('_optimized.avif'));

    console.log('File breakdown:');
    console.log(`  - Thumbnails (AVIF): ${thumbnails.length}`);
    console.log(`  - Optimized AVIF: ${optimizedAvif.length}`);
    console.log('\n');

    if (options.dryRun) {
      console.log('Sample files that would be deleted:\n');
      filesToDelete.slice(0, 10).forEach((file, idx) => {
        console.log(`  ${idx + 1}. ${file}`);
      });
      if (filesToDelete.length > 10) {
        console.log(`  ... and ${filesToDelete.length - 10} more files\n`);
      }
      console.log('\n✅ Dry run complete. No files were deleted.\n');
      process.exit(0);
    }

    // Delete files in batches
    console.log('🗑️  Deleting files...\n');
    
    let batchNumber = 0;
    for (let i = 0; i < filesToDelete.length; i += options.batchSize) {
      batchNumber++;
      const batch = filesToDelete.slice(i, i + options.batchSize);
      
      console.log(`📦 Processing Batch #${batchNumber} (${batch.length} files)...`);

      for (const filePath of batch) {
        stats.totalScanned++;
        
        try {
          await deleteFileFromZata(filePath);
          
          const type = getDeletionType(filePath);
          if (type === 'thumbnail') stats.thumbnailsDeleted++;
          else if (type === 'optimized') stats.optimizedDeleted++;
          
          if (stats.totalScanned % 10 === 0) {
            process.stdout.write(`   Deleted ${stats.totalScanned}/${filesToDelete.length} files...\r`);
          }
        } catch (error: any) {
          console.error(`\n   ❌ Failed to delete ${filePath}: ${error.message}`);
          stats.errors++;
        }
      }

      console.log(`\n   ✅ Batch #${batchNumber} complete`);
      
      // Small delay between batches to avoid rate limits
      if (i + options.batchSize < filesToDelete.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log('\n✨ Cleanup Complete!\n');
    console.log('Final Statistics:');
    console.log(`  Total Files Scanned: ${stats.totalScanned}`);
    console.log(`  Thumbnails Deleted: ${stats.thumbnailsDeleted}`);
    console.log(`  Optimized AVIF Deleted: ${stats.optimizedDeleted}`);
    console.log(`  Errors: ${stats.errors}`);
    console.log(`  Duration: ${duration}s`);
    console.log('\n');

    if (stats.errors > 0) {
      console.log('⚠️  Some files failed to delete. Check the errors above.\n');
      process.exit(1);
    }

    console.log('✅ All wrong-path thumbnails have been successfully deleted!\n');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Cleanup failed:', error.message);
    process.exit(1);
  }
}

// Run the cleanup
cleanup();
