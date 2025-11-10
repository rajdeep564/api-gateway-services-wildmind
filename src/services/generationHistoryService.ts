import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { mirrorQueueRepository } from "../repository/mirrorQueueRepository";
import { generationStatsRepository } from "../repository/generationStatsRepository";
import { imageOptimizationService } from "./imageOptimizationService";
// CACHING REMOVED: Redis generationCache disabled due to stale list items not reflecting newly started generations promptly.
// If reintroducing, ensure immediate inclusion of generating items and robust invalidation on create/complete/fail/update.
import { deleteGenerationFiles } from "../utils/storage/zataDelete";
import {
  GenerationStatus,
  CreateGenerationPayload,
  CompleteGenerationPayload,
  FailGenerationPayload,
  GenerationHistoryItem,
} from "../types/generate";
import { authRepository } from "../repository/auth/authRepository";
import { ApiError } from "../utils/errorHandler";

export async function startGeneration(
  uid: string,
  payload: CreateGenerationPayload
): Promise<{ historyId: string } & { item: GenerationHistoryItem }> {
  const { historyId } = await generationHistoryRepository.create(uid, payload);
  const item = await generationHistoryRepository.get(uid, historyId);
  if (!item) throw new ApiError("Failed to read created history item", 500);
  
  // Cache invalidation removed (no cache layer active)
  
  // OPTIMIZATION: Update stats counter
  try {
    await generationStatsRepository.incrementOnCreate(uid, payload.generationType);
  } catch (e) {
    console.warn('[startGeneration] Failed to increment stats:', e);
  }
  
  // OPTIMIZATION: Enqueue mirror upsert instead of blocking request
  try {
    await mirrorQueueRepository.enqueueUpsert({ uid, historyId, itemSnapshot: item });
  } catch (e) {
    console.warn('[startGeneration] Failed to enqueue mirror upsert:', e);
  }
  
  return { historyId, item };
}

export async function markGenerationCompleted(
  uid: string,
  historyId: string,
  updates: Omit<CompleteGenerationPayload, "status"> & { status: "completed" }
): Promise<void> {
  const existing = await generationHistoryRepository.get(uid, historyId);
  if (!existing) throw new ApiError("History item not found", 404);
  if (existing.status !== GenerationStatus.Generating)
    throw new ApiError("Invalid status transition", 400);
  const next: Partial<GenerationHistoryItem> = {
    status: GenerationStatus.Completed,
    images: updates.images,
    videos: updates.videos,
    isPublic: updates.isPublic ?? existing.isPublic ?? false,
    tags: updates.tags ?? existing.tags,
    nsfw: updates.nsfw ?? existing.nsfw,
  };
  await generationHistoryRepository.update(uid, historyId, next);
  
  // Cache invalidation removed
  
  // OPTIMIZATION: Update stats counter
  try {
    await generationStatsRepository.updateOnStatusChange(uid, 'generating', 'completed');
  } catch (e) {
    console.warn('[markGenerationCompleted] Failed to update stats:', e);
  }
  
  // OPTIMIZATION: Trigger image optimization in background (non-blocking)
  if (updates.images && updates.images.length > 0) {
    setImmediate(async () => {
      try {
        console.log('[markGenerationCompleted] Starting image optimization:', { uid, historyId, imageCount: updates.images?.length });
        
        const images = updates.images || [];
        
        // Optimize each image in its original storage location
        const optimizedImages = await Promise.all(
          images.map(async (img: any, index: number) => {
            try {
              // Extract storage path from original URL
              const ZATA_PREFIX = 'https://idr01.zata.ai/devstoragev1/';
              let basePath = '';
              let filename = '';
              
              if (img.url && img.url.startsWith(ZATA_PREFIX)) {
                const fullPath = img.url.substring(ZATA_PREFIX.length);
                const lastSlashIndex = fullPath.lastIndexOf('/');
                if (lastSlashIndex > 0) {
                  basePath = fullPath.substring(0, lastSlashIndex);
                  const originalFilename = fullPath.substring(lastSlashIndex + 1);
                  // Remove extension(s) to get base filename
                  filename = originalFilename.replace(/\.[^.]+$/, '').replace(/\.[^.]+$/, '');
                }
              }
              
              // Skip if we couldn't extract valid paths
              if (!basePath || !filename) {
                console.warn('[markGenerationCompleted] Could not extract path from URL, skipping optimization:', img.url);
                return img;
              }
              
              console.log('[markGenerationCompleted] Optimizing image:', { index, basePath, filename, url: img.url });
              
              // Use AVIF-only optimization with high quality
              const optimized = await imageOptimizationService.optimizeImage(img.url, basePath, filename, {
                maxWidth: 2048,
                maxHeight: 2048,
                avifQuality: 90,      // High quality AVIF (only format)
                thumbnailQuality: 80, // Thumbnail quality
                thumbnailSize: 400,
              });
              
              return {
                ...img,
                avifUrl: optimized.avifUrl,        // Primary and only format
                thumbnailUrl: optimized.thumbnailUrl,
                blurDataUrl: optimized.blurDataUrl,
                optimized: true,
                optimizedAt: Date.now(),
              };
            } catch (error) {
              console.error(`[markGenerationCompleted] Failed to optimize image ${index}:`, error);
              return img; // Return original if optimization fails
            }
          })
        );
        
        await generationHistoryRepository.update(uid, historyId, { images: optimizedImages });
        console.log('[markGenerationCompleted] Image optimization complete:', { uid, historyId, optimizedCount: optimizedImages.length });
        
        // Re-enqueue mirror update with optimized images
        const fresh = await generationHistoryRepository.get(uid, historyId);
        if (fresh) {
          await mirrorQueueRepository.enqueueUpsert({ uid, historyId, itemSnapshot: fresh });
        }
      } catch (error) {
        console.error('[markGenerationCompleted] Image optimization failed (non-blocking):', error);
      }
    });
  }
  
  // OPTIMIZATION: Enqueue mirror update (initial, will be updated after optimization)
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) {
      await mirrorQueueRepository.enqueueUpsert({ uid, historyId, itemSnapshot: fresh });
    }
  } catch (e) {
    console.warn('[markGenerationCompleted] Failed to enqueue mirror upsert:', e);
  }
}

export async function markGenerationFailed(
  uid: string,
  historyId: string,
  payload: Omit<FailGenerationPayload, "status"> & { status: "failed" }
): Promise<void> {
  const existing = await generationHistoryRepository.get(uid, historyId);
  if (!existing) throw new ApiError("History item not found", 404);
  if (existing.status !== GenerationStatus.Generating)
    throw new ApiError("Invalid status transition", 400);
  await generationHistoryRepository.update(uid, historyId, {
    status: GenerationStatus.Failed,
    error: payload.error,
  });
  
  // Cache invalidation removed
  
  // OPTIMIZATION: Update stats counter
  try {
    await generationStatsRepository.updateOnStatusChange(uid, 'generating', 'failed');
  } catch (e) {
    console.warn('[markGenerationFailed] Failed to update stats:', e);
  }
  
  // OPTIMIZATION: Enqueue mirror update instead of blocking
  try {
    await mirrorQueueRepository.enqueueUpdate({
      uid,
      historyId,
      updates: {
        status: GenerationStatus.Failed,
        error: payload.error,
      },
    });
  } catch (e) {
    console.warn('[markGenerationFailed] Failed to enqueue mirror update:', e);
  }
}

export async function getUserGeneration(
  uid: string,
  historyId: string
): Promise<GenerationHistoryItem | null> {
  // Direct fetch (no caching)
  return generationHistoryRepository.get(uid, historyId);
}

export async function listUserGenerations(
  uid: string,
  params: {
    limit: number;
    cursor?: string; // LEGACY: document ID cursor
    nextCursor?: string; // NEW: timestamp cursor for optimized pagination
    status?: "generating" | "completed" | "failed";
    generationType?: string | string[];
    sortBy?: 'createdAt' | 'updatedAt' | 'prompt'; // LEGACY: for backward compatibility
    sortOrder?: 'asc' | 'desc'; // LEGACY: for backward compatibility
    dateStart?: string; // LEGACY: ISO date string
    dateEnd?: string; // LEGACY: ISO date string
    search?: string;
  }
): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string | number | null; hasMore?: boolean; totalCount?: number }> {
  // Direct fetch from Firestore (caching disabled)
  return generationHistoryRepository.list(uid, params as any);
}

export async function softDelete(uid: string, historyId: string): Promise<{ item: GenerationHistoryItem }> {
  const existing = await generationHistoryRepository.get(uid, historyId);
  if (!existing) throw new ApiError('History item not found', 404);
  
  console.log('[softDelete] Starting deletion:', { uid, historyId, isPublic: existing.isPublic });
  
  // 1. Mark as deleted in generationHistory
  await generationHistoryRepository.update(uid, historyId, { isDeleted: true, isPublic: false } as any);
  console.log('[softDelete] Marked as deleted in generationHistory');
  
  // 2. Cache invalidation removed
  
  // 3. Delete from publicGenerations mirror (generations collection)
  try {
    await generationsMirrorRepository.remove(historyId);
    console.log('[softDelete] Deleted from publicGenerations mirror');
  } catch (e) {
    console.warn('[softDelete] Failed to delete from mirror:', e);
  }
  
  // 4. Delete files from Zata storage (in background, non-blocking)
  setImmediate(async () => {
    try {
      console.log('[softDelete] Starting Zata file deletion...');
      await deleteGenerationFiles(existing);
      console.log('[softDelete] Successfully deleted files from Zata storage');
    } catch (e) {
      console.error('[softDelete] Failed to delete files from Zata:', e);
    }
  });
  
  console.log('[softDelete] Deletion completed');
  
  // Return the item with isDeleted flag
  return { 
    item: { 
      ...existing, 
      isDeleted: true, 
      isPublic: false 
    } 
  };
}

export async function update(uid: string, historyId: string, updates: Partial<GenerationHistoryItem>): Promise<{ item: GenerationHistoryItem }> {
  const existing = await generationHistoryRepository.get(uid, historyId);
  if (!existing) throw new ApiError('History item not found', 404);

  // Support per-media privacy updates
  let nextDoc: Partial<GenerationHistoryItem> = { ...updates };

  // If client sends { image: { id, isPublic } } then update matching image in arrays
  const anyImageUpdate = (updates as any)?.image;
  if (anyImageUpdate && typeof anyImageUpdate === 'object') {
    const imgUpd = anyImageUpdate as any;
    const images = Array.isArray(existing.images) ? [...(existing.images as any[])] : [];
    const idx = images.findIndex((im: any) => (imgUpd.id && im.id === imgUpd.id) || (imgUpd.url && im.url === imgUpd.url) || (imgUpd.storagePath && im.storagePath === imgUpd.storagePath));
    if (idx >= 0) {
      images[idx] = { ...images[idx], ...imgUpd };
      nextDoc.images = images as any;
    }
  }

  // If client sends { video: { id, isPublic } } then update matching video in arrays
  const anyVideoUpdate = (updates as any)?.video;
  if (anyVideoUpdate && typeof anyVideoUpdate === 'object') {
    const vdUpd = anyVideoUpdate as any;
    const videos = Array.isArray(existing.videos) ? [...(existing.videos as any[])] : [];
    const idx = videos.findIndex((vd: any) => (vdUpd.id && vd.id === vdUpd.id) || (vdUpd.url && vd.url === vdUpd.url) || (vdUpd.storagePath && vd.storagePath === vdUpd.storagePath));
    if (idx >= 0) {
      videos[idx] = { ...videos[idx], ...vdUpd };
      nextDoc.videos = videos as any;
    }
  }

  // Recompute document-level isPublic as true if any media item is explicitly public
  if (nextDoc.images || nextDoc.videos || typeof (updates as any)?.isPublic === 'boolean') {
    const imgs = (nextDoc.images || existing.images || []) as any[];
    const vds = (nextDoc.videos || existing.videos || []) as any[];
    const anyPublic = imgs.some((im: any) => im?.isPublic === true) || vds.some((vd: any) => vd?.isPublic === true);
    nextDoc.isPublic = anyPublic;
  }

  await generationHistoryRepository.update(uid, historyId, nextDoc);

  // Cache invalidation removed

  console.log('[update] Updated generation:', { historyId, isPublic: nextDoc.isPublic, hasImages: !!nextDoc.images, hasVideos: !!nextDoc.videos });

  // OPTIMIZATION: Enqueue mirror update instead of blocking
  try {
    await mirrorQueueRepository.enqueueUpdate({ uid, historyId, updates: nextDoc });
  } catch (e) {
    console.warn('[update] Failed to enqueue mirror update:', e);
  }
  
  // Fetch and return the updated item
  const updatedItem = await generationHistoryRepository.get(uid, historyId);
  if (!updatedItem) throw new ApiError('Failed to fetch updated item', 500);
  
  return { item: updatedItem };
}

export const generationHistoryService = {
  startGeneration,
  markGenerationCompleted,
  markGenerationFailed,
  getUserGeneration,
  listUserGenerations,
  softDelete,
  update,
};
