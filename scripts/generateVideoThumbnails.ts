/**
 * Script to generate thumbnails for ALL existing videos that don't have thumbnails
 * 
 * Usage:
 *   ts-node scripts/generateVideoThumbnails.ts [options]
 * 
 * Options:
 *   --batch-size N   Process N documents per batch (default: 100)
 *   --dry-run        Don't actually update the database, just show what would be done
 *   --generationType TYPE  Only process videos of this generation type (e.g., 'text-to-video')
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as admin from 'firebase-admin';
import { adminDb } from '../src/config/firebaseAdmin';
import { generationHistoryRepository } from '../src/repository/generationHistoryRepository';
import { generateAndAttachThumbnail } from '../src/services/videoThumbnailService';
import { authRepository } from '../src/repository/auth/authRepository';
import { generationsMirrorRepository } from '../src/repository/generationsMirrorRepository';

interface ScriptOptions {
  batchSize: number;
  dryRun: boolean;
  generationType?: string;
}

async function main() {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {
    batchSize: 100,
    dryRun: false,
  };

  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size' && i + 1 < args.length) {
      options.batchSize = parseInt(args[i + 1], 10) || 100;
      i++;
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--generationType' && i + 1 < args.length) {
      options.generationType = args[i + 1];
      i++;
    }
  }

  console.log('[generateVideoThumbnails] Starting with options:', options);
  console.log('[generateVideoThumbnails] Processing ALL videos from database...\n');

  try {
    const generationsRef = adminDb.collection('generations');

    // Build query - use simpler query to avoid index requirement
    // Process all completed generations, filtering in memory for deleted items
    let query: admin.firestore.Query = generationsRef
      .where('status', '==', 'completed');

    // Filter by generation type if specified
    if (options.generationType) {
      query = query.where('generationType', '==', options.generationType);
    }

    let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let totalNoVideos = 0;
    let totalDeleted = 0;
    let batchNumber = 0;

    // Process in batches until no more documents
    while (true) {
      batchNumber++;
      console.log(`\n[generateVideoThumbnails] === Batch ${batchNumber} ===`);

      let batchQuery: admin.firestore.Query = query.limit(options.batchSize);
      
      // Use cursor for pagination (by document ID)
      if (lastDoc) {
        batchQuery = batchQuery.startAfter(lastDoc);
      }

      const snapshot = await batchQuery.get();

      if (snapshot.empty) {
        console.log('[generateVideoThumbnails] No more documents to process');
        break;
      }

      console.log(`[generateVideoThumbnails] Fetched ${snapshot.size} documents in this batch`);
      
      // Quick scan to see how many have videos
      let docsWithVideos = 0;
      let docsWithVideosNeedingThumbnails = 0;
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.isDeleted === true) continue;
        const videos = data.videos;
        if (Array.isArray(videos) && videos.length > 0) {
          docsWithVideos++;
          const needsThumbnail = videos.some((v: any) => !v.thumbnailUrl && v.url);
          if (needsThumbnail) {
            docsWithVideosNeedingThumbnails++;
          }
        }
      }
      console.log(`[generateVideoThumbnails] Quick scan: ${docsWithVideos} docs have videos, ${docsWithVideosNeedingThumbnails} need thumbnails`);

      // Reset batch counters
      let batchProcessed = 0;
      let batchUpdated = 0;
      let batchSkipped = 0;
      let batchErrors = 0;
      let batchNoVideos = 0;
      let batchDeleted = 0;
      let batchAlreadyHasThumbnails = 0;

      for (const doc of snapshot.docs) {
        const data = doc.data();
        
        // Skip if deleted
        if (data.isDeleted === true) {
          batchDeleted++;
          totalDeleted++;
          continue;
        }
        
        const videos = data.videos;

        // Skip if no videos
        if (!Array.isArray(videos) || videos.length === 0) {
          batchNoVideos++;
          totalNoVideos++;
          continue;
        }

        batchProcessed++;
        totalProcessed++;

        // Debug: Log video details
        const videosNeedingThumbnails = videos.filter((v: any) => !v.thumbnailUrl && v.url);
        const videosWithThumbnails = videos.filter((v: any) => v.thumbnailUrl);
        const videosWithoutUrl = videos.filter((v: any) => !v.url);

        console.log(`[generateVideoThumbnails] [DEBUG] Doc ${doc.id}: ${videos.length} videos total`);
        console.log(`[generateVideoThumbnails] [DEBUG]   - Need thumbnails: ${videosNeedingThumbnails.length}`);
        console.log(`[generateVideoThumbnails] [DEBUG]   - Already have thumbnails: ${videosWithThumbnails.length}`);
        console.log(`[generateVideoThumbnails] [DEBUG]   - No URL: ${videosWithoutUrl.length}`);
        
        if (videosNeedingThumbnails.length > 0) {
          console.log(`[generateVideoThumbnails] [DEBUG]   - Sample video needing thumbnail:`, {
            id: videosNeedingThumbnails[0].id,
            url: videosNeedingThumbnails[0].url?.substring(0, 100),
            hasThumbnailUrl: !!videosNeedingThumbnails[0].thumbnailUrl,
            thumbnailUrl: videosNeedingThumbnails[0].thumbnailUrl,
          });
        }

        // Check if any video needs thumbnail
        const needsThumbnail = videosNeedingThumbnails.length > 0;
        if (!needsThumbnail) {
          batchSkipped++;
          batchAlreadyHasThumbnails++;
          totalSkipped++;
          console.log(`[generateVideoThumbnails] [DEBUG] Skipping ${doc.id}: All videos already have thumbnails`);
          continue;
        }

        try {
          const uid = data.createdBy?.uid || data.uid;
          if (!uid) {
            console.warn(`[generateVideoThumbnails] Skipping ${doc.id}: no uid`);
            batchSkipped++;
            totalSkipped++;
            continue;
          }

          // Get user info for key prefix
          const user = await authRepository.getUserById(uid);
          const username = user?.username || uid;
          const historyId = doc.id;

          // Generate thumbnails for videos that need them
          const updatedVideos = await Promise.all(
            videos.map(async (video: any) => {
              if (video.thumbnailUrl || !video.url) {
                return video;
              }

              const keyPrefix = video.storagePath
                ? video.storagePath.substring(0, video.storagePath.lastIndexOf('/'))
                : `users/${username}/video/${historyId}`;

              console.log(`[generateVideoThumbnails] Generating thumbnail for video ${video.id || 'unknown'} in ${doc.id}`);

              if (options.dryRun) {
                console.log(`[generateVideoThumbnails] [DRY RUN] Would generate thumbnail for: ${video.url}`);
                return { ...video, thumbnailUrl: '[DRY RUN]' };
              }

              return await generateAndAttachThumbnail(video, keyPrefix);
            })
          );

          // Update the generation document
          if (!options.dryRun) {
            await generationHistoryRepository.update(uid, historyId, {
              videos: updatedVideos,
            } as any);

            // Also update the mirror if it exists (for public generations)
            try {
              if (data.isPublic === true && data.isDeleted !== true) {
                await generationsMirrorRepository.updateFromHistory(uid, historyId, {
                  videos: updatedVideos,
                } as any);
              }
            } catch (mirrorErr) {
              console.warn(`[generateVideoThumbnails] Failed to update mirror for ${historyId}:`, mirrorErr);
            }
          }

          batchUpdated++;
          totalUpdated++;
          console.log(`[generateVideoThumbnails] ✓ Updated ${doc.id} with ${updatedVideos.filter((v: any) => v.thumbnailUrl && v.thumbnailUrl !== '[DRY RUN]').length} thumbnails`);
        } catch (error: any) {
          batchErrors++;
          totalErrors++;
          console.error(`[generateVideoThumbnails] ✗ Error processing ${doc.id}:`, error?.message || error);
        }

        // Update lastDoc for pagination
        lastDoc = doc;
      }

      console.log(`[generateVideoThumbnails] Batch ${batchNumber} complete:`);
      console.log(`  - Documents with videos processed: ${batchProcessed}`);
      console.log(`  - Documents updated: ${batchUpdated}`);
      console.log(`  - Documents skipped (already have thumbnails): ${batchSkipped}`);
      console.log(`  - Documents with no videos: ${batchNoVideos}`);
      console.log(`  - Documents deleted: ${batchDeleted}`);
      console.log(`  - Errors: ${batchErrors}`);

      // If we got fewer documents than the batch size, we're done
      if (snapshot.size < options.batchSize) {
        break;
      }
    }

    console.log('\n[generateVideoThumbnails] ========== FINAL SUMMARY ==========');
    console.log(`  Total Batches: ${batchNumber}`);
    console.log(`  Documents with videos processed: ${totalProcessed}`);
    console.log(`  Documents updated with thumbnails: ${totalUpdated}`);
    console.log(`  Documents skipped (already have thumbnails): ${totalSkipped}`);
    console.log(`  Documents with no videos: ${totalNoVideos}`);
    console.log(`  Documents deleted: ${totalDeleted}`);
    console.log(`  Total Errors: ${totalErrors}`);

    if (options.dryRun) {
      console.log('\n[generateVideoThumbnails] DRY RUN - No changes were made to the database');
    }
  } catch (error: any) {
    console.error('[generateVideoThumbnails] Fatal error:', error);
    process.exit(1);
  }
}

main().then(() => {
  console.log('[generateVideoThumbnails] Script completed');
  process.exit(0);
}).catch((error) => {
  console.error('[generateVideoThumbnails] Unhandled error:', error);
  process.exit(1);
});

