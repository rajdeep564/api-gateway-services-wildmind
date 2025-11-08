import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { mirrorQueueRepository } from "../repository/mirrorQueueRepository";
import { generationStatsRepository } from "../repository/generationStatsRepository";
import { imageOptimizationService } from "./imageOptimizationService";
import * as generationCache from "../utils/generationCache";
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
  // Try cache first
  const cached = await generationCache.getCachedItem(uid, historyId);
  if (cached) {
    return cached;
  }
  
  // Cache miss - fetch from Firestore
  const item = await generationHistoryRepository.get(uid, historyId);
  
  // Cache the result (even if null to prevent repeated DB hits)
  if (item) {
    await generationCache.setCachedItem(uid, historyId, item);
  }
  
  return item;
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
  // Try cache first (only for first page with standard params)
  const useCache = !params.cursor && !params.nextCursor && !params.sortBy && !params.sortOrder && !params.dateStart && !params.dateEnd;
  
  if (useCache) {
    const cached = await generationCache.getCachedList(uid, params);
    if (cached) {
      return cached;
    }
  }
  
  // Cache miss - fetch from Firestore
  const result = await generationHistoryRepository.list(uid, params as any);
  
  // Cache the result (only first page)
  if (useCache && result.items.length > 0) {
    await generationCache.setCachedList(uid, params, result);
    // Also cache individual items for faster single-item lookups
    await generationCache.setCachedItemsBatch(uid, result.items);
  }
  
  return result;
}

export async function softDelete(uid: string, historyId: string): Promise<void> {
  const existing = await generationHistoryRepository.get(uid, historyId);
  if (!existing) throw new ApiError('History item not found', 404);
  
  await generationHistoryRepository.update(uid, historyId, { isDeleted: true, isPublic: false } as any);
  
  // Invalidate cache
  await generationCache.invalidateItem(uid, historyId);
  
  // OPTIMIZATION: Enqueue mirror update instead of blocking
  try {
    await mirrorQueueRepository.enqueueUpdate({
      uid,
      historyId,
      updates: { isDeleted: true, isPublic: false } as any,
    });
  } catch (e) {
    console.warn('[softDelete] Failed to enqueue mirror update:', e);
  }
}

export async function update(uid: string, historyId: string, updates: Partial<GenerationHistoryItem>): Promise<void> {
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

  // Invalidate cache
  await generationCache.invalidateItem(uid, historyId);

  // OPTIMIZATION: Enqueue mirror update instead of blocking
  try {
    await mirrorQueueRepository.enqueueUpdate({ uid, historyId, updates: nextDoc });
  } catch (e) {
    console.warn('[update] Failed to enqueue mirror update:', e);
  }
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
