/**
 * Media GC Worker - Garbage collects unreferenced Canvas media
 * 
 * This worker:
 * - Finds media with referencedByCount === 0
 * - Checks if media is older than TTL (default: 30 days)
 * - Deletes media from Zata storage
 * - Removes media records from Firestore
 * 
 * Can be run:
 * - As a scheduled Cloud Function (daily)
 * - As a manual API endpoint
 * - As a background job
 */

import { mediaRepository } from '../../repository/canvas/mediaRepository';
import { deleteFileFromZata } from '../../utils/storage/zataClient';
import { ApiError } from '../../utils/errorHandler';

interface GCConfig {
  ttlDays?: number; // Time to live in days (default: 30)
  batchSize?: number; // Number of media items to process per run (default: 100)
  dryRun?: boolean; // If true, only report what would be deleted (default: false)
}

const DEFAULT_CONFIG: Required<GCConfig> = {
  ttlDays: 30,
  batchSize: 100,
  dryRun: false,
};

/**
 * Garbage collect a single media item
 */
export async function gcMediaItem(
  mediaId: string,
  config: GCConfig = {}
): Promise<{ deleted: boolean; reason?: string; error?: string }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  try {
    const media = await mediaRepository.getMedia(mediaId);
    if (!media) {
      return { deleted: false, reason: 'Media not found' };
    }

    // Check if media is unreferenced
    if (media.referencedByCount > 0) {
      return { deleted: false, reason: `Still referenced (count: ${media.referencedByCount})` };
    }

    // Check if media is old enough
    const createdAt = media.createdAt?.toMillis?.() || 0;
    const now = Date.now();
    const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);

    if (ageDays < cfg.ttlDays) {
      return {
        deleted: false,
        reason: `Too new (${ageDays.toFixed(1)} days old, TTL: ${cfg.ttlDays} days)`,
      };
    }

    if (cfg.dryRun) {
      return {
        deleted: false,
        reason: `Would delete (dry run): ${media.storagePath}`,
      };
    }

    // Delete from Zata storage
    if (media.storagePath) {
      try {
        await deleteFileFromZata(media.storagePath);
      } catch (error: any) {
        // Log but continue - file might already be deleted
        console.warn(`Failed to delete file from Zata: ${media.storagePath}`, error.message);
      }
    }

    // Delete media record from Firestore
    await mediaRepository.deleteMedia(mediaId);

    return {
      deleted: true,
      reason: `Deleted media ${mediaId} (${ageDays.toFixed(1)} days old)`,
    };
  } catch (error: any) {
    console.error(`Failed to GC media ${mediaId}:`, error);
    return {
      deleted: false,
      error: error.message,
    };
  }
}

/**
 * Process multiple media items and garbage collect unreferenced ones
 */
export async function processMediaGC(
  config: GCConfig = {}
): Promise<{
  processed: number;
  deleted: number;
  skipped: number;
  errors: number;
  results: Array<{ mediaId: string; deleted: boolean; reason?: string; error?: string }>;
}> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const results: Array<{ mediaId: string; deleted: boolean; reason?: string; error?: string }> = [];

  try {
    // Get unreferenced media (older than TTL)
    const unreferencedMedia = await mediaRepository.getUnreferencedMedia(cfg.ttlDays);

    let deleted = 0;
    let skipped = 0;
    let errors = 0;

    for (const media of unreferencedMedia) {
      try {
        const result = await gcMediaItem(media.id, cfg);
        results.push({
          mediaId: media.id,
          deleted: result.deleted,
          reason: result.reason,
          error: result.error,
        });

        if (result.deleted) {
          deleted++;
        } else {
          skipped++;
        }
      } catch (error: any) {
        console.error(`Error processing media ${media.id}:`, error);
        results.push({
          mediaId: media.id,
          deleted: false,
          error: error.message,
        });
        errors++;
      }
    }

    return {
      processed: unreferencedMedia.length,
      deleted,
      skipped,
      errors,
      results,
    };
  } catch (error: any) {
    console.error('Failed to process media GC:', error);
    throw error;
  }
}

/**
 * Manual trigger endpoint (can be called via API)
 */
export async function triggerMediaGCWorker(
  mediaId?: string,
  config: GCConfig = {}
): Promise<any> {
  if (mediaId) {
    // GC specific media item
    return await gcMediaItem(mediaId, config);
  } else {
    // Process all unreferenced media
    return await processMediaGC(config);
  }
}

