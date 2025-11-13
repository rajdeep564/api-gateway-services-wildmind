import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { mirrorQueueRepository } from "../repository/mirrorQueueRepository";
import { generationStatsRepository } from "../repository/generationStatsRepository";
import { imageOptimizationService } from "./imageOptimizationService";
// CACHING REMOVED: Redis generationCache disabled due to stale list items not reflecting newly started generations promptly.
// If reintroducing, ensure immediate inclusion of generating items and robust invalidation on create/complete/fail/update.
import { deleteGenerationFiles } from "../utils/storage/zataDelete";
import { getCachedItem, setCachedItem, getCachedList, setCachedList } from "../utils/generationCache";
import {
  GenerationStatus,
  CreateGenerationPayload,
  CompleteGenerationPayload,
  FailGenerationPayload,
  GenerationHistoryItem,
  Visibility,
} from "../types/generate";
import { authRepository } from "../repository/auth/authRepository";
import { syncToMirror } from "../utils/mirrorHelper";
import { ApiError } from "../utils/errorHandler";
import { normalizeGenerationType } from "../utils/normalizeGenerationType";

export async function startGeneration(
  uid: string,
  payload: CreateGenerationPayload
): Promise<{ historyId: string } & { item: GenerationHistoryItem }> {
  // Normalize generationType aliases (e.g., 'logo-generation' -> 'logo')
  const normalizedPayload: CreateGenerationPayload = {
    ...payload,
    generationType: (normalizeGenerationType(payload.generationType as any) as any) || payload.generationType,
  } as any;

  const { historyId } = await generationHistoryRepository.create(uid, normalizedPayload);
  const item = await generationHistoryRepository.get(uid, historyId);
  if (!item) throw new ApiError("Failed to read created history item", 500);
  
  // Cache invalidation removed (no cache layer active)
  
  // OPTIMIZATION: Update stats counter
  try {
    await generationStatsRepository.incrementOnCreate(uid, normalizedPayload.generationType);
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
  try {
    console.log('[markGenerationCompleted] Enter', {
      uid,
      historyId,
      hasImages: Array.isArray((updates as any)?.images) ? (updates as any).images.length : 0,
      hasVideos: Array.isArray((updates as any)?.videos) ? (updates as any).videos.length : 0,
      incomingIsPublic: (updates as any)?.isPublic,
    });
  } catch {}
  const existing = await generationHistoryRepository.get(uid, historyId);
  if (!existing) throw new ApiError("History item not found", 404);

  // Allow idempotent calls: if already completed just reuse existing flags/images
  const wasGenerating = existing.status === GenerationStatus.Generating;
  const finalIsPublic = updates.isPublic === true ? true : (updates.isPublic === false ? false : (existing.isPublic === true));

  // Merge / hydrate fields before optimization
  // Normalize legacy image entries (strings or objects without id/url)
  const rawImages = updates.images && updates.images.length > 0 ? updates.images : (existing.images || []);
  const baseImages = Array.isArray(rawImages) ? rawImages.map((im: any, index: number) => {
    // If string -> wrap
    if (typeof im === 'string') {
      return {
        id: `${historyId}-img-${index}`,
        url: im,
        originalUrl: im,
        optimized: false,
      };
    }
    if (im && typeof im === 'object') {
      const id = im.id || `${historyId}-img-${index}`;
      const url = im.url || im.originalUrl || (typeof im.storagePath === 'string' ? im.storagePath : undefined);
      // Build sanitized image object without undefined values (Firestore rejects undefined)
      const out: any = {
        id,
        url,
        originalUrl: im.originalUrl || url,
      };
      if (im.storagePath) out.storagePath = im.storagePath;
      if (im.avifUrl) out.avifUrl = im.avifUrl;
      if (im.thumbnailUrl) out.thumbnailUrl = im.thumbnailUrl;
      if (im.blurDataUrl) out.blurDataUrl = im.blurDataUrl;
      if (typeof im.optimized === 'boolean') out.optimized = im.optimized;
      if (im.optimizedAt) out.optimizedAt = im.optimizedAt;
      if (typeof im.aestheticScore === 'number') out.aestheticScore = im.aestheticScore;
      if (typeof im.width === 'number') out.width = im.width;
      if (typeof im.height === 'number') out.height = im.height;
      if (typeof im.size === 'number') out.size = im.size;
      return out;
    }
    return im;
  }) : [];
  const next: Partial<GenerationHistoryItem> = {
    status: GenerationStatus.Completed,
    videos: updates.videos ?? existing.videos,
    isPublic: finalIsPublic,
    visibility: finalIsPublic ? Visibility.Public : Visibility.Private,
    tags: updates.tags ?? existing.tags,
    nsfw: updates.nsfw ?? existing.nsfw,
  };
  // Only adjust stats if transitioning from generating -> completed
  if (wasGenerating) {
    try {
      await generationStatsRepository.updateOnStatusChange(uid, 'generating', 'completed');
    } catch (e) {
      console.warn('[markGenerationCompleted] Failed to update stats:', e);
    }
  }
  // Persist normalization early if anything changed shape (compare by presence of string entries)
  const hadLegacyStrings = rawImages.some((r: any) => typeof r === 'string');
  try {
    await generationHistoryRepository.update(uid, historyId, {
      ...next,
      // Only write images in the pre-optimization update if we actually transformed legacy strings
      ...(hadLegacyStrings ? { images: baseImages } : {}),
    });
  } catch (e) {
    console.warn('[markGenerationCompleted] Initial update (pre-optimization) failed:', e);
  }

  // Inline (synchronous) optimization so caller immediately sees avif/thumbnail in history & mirror
  let optimizedImages = baseImages;
  if (Array.isArray(baseImages) && baseImages.length > 0) {
    try {
      console.log('[markGenerationCompleted] Starting optimization pass', {
        historyId,
        count: baseImages.length,
      });
    } catch {}
    optimizedImages = await Promise.all(baseImages.map(async (img: any, index: number) => {
      try {
        // If already optimized (idempotent) keep
        if (img.optimized && img.avifUrl && img.thumbnailUrl) return img;
        const url: string | undefined = img.url || img.originalUrl;
        if (!url) return img;
        // Prefer reliable storagePath when present; fallback to URL parsing
        let basePath = '';
        let filename = '';
        if (typeof img.storagePath === 'string' && img.storagePath.includes('/')) {
          const sp: string = img.storagePath;
          const lastSlash = sp.lastIndexOf('/');
          basePath = sp.substring(0, lastSlash);
          const rawFile = sp.substring(lastSlash + 1);
          filename = rawFile.replace(/\.[^.]+$/, '').replace(/\.[^.]+$/, '');
        } else {
          // Try to derive basePath/filename from URL (handles various Zata URL shapes)
          const match = url.match(/https?:\/\/[^/]+\/(?:devstoragev1|prodstoragev1)\/(.+)/);
          let relative = match ? match[1] : '';
          if (!relative) {
            // Generic fallback: strip host leaving path
            const m2 = url.match(/https?:\/\/[^/]+\/(.+)/);
            relative = m2 ? m2[1] : '';
          }
          if (!relative) {
            console.warn('[markGenerationCompleted] Non-Zata URL or unrecognized path, skipping optimization:', url);
            return img;
          }
          const lastSlash = relative.lastIndexOf('/');
          if (lastSlash < 0) return img;
          basePath = relative.substring(0, lastSlash);
          const rawFile = relative.substring(lastSlash + 1);
          filename = rawFile.replace(/\.[^.]+$/, '').replace(/\.[^.]+$/, '');
        }
        if (!basePath || !filename) return img;
        const optimized = await imageOptimizationService.optimizeImage(url, basePath, filename, {
          maxWidth: 2048,
          maxHeight: 2048,
          avifQuality: 90,
          thumbnailQuality: 80,
          thumbnailSize: 400,
        });
        try {
          console.log('[markGenerationCompleted] Optimized image', {
            index,
            avifUrl: optimized.avifUrl,
            thumbnailUrl: optimized.thumbnailUrl,
          });
        } catch {}
        return {
          ...img,
          avifUrl: optimized.avifUrl,
            thumbnailUrl: optimized.thumbnailUrl,
            blurDataUrl: optimized.blurDataUrl,
            optimized: true,
            optimizedAt: Date.now(),
        };
      } catch (e) {
        console.error(`[markGenerationCompleted] Optimization failed for image ${index}:`, e);
        return img;
      }
    }));
    // Persist optimized images and refresh caches immediately
    try {
      await generationHistoryRepository.update(uid, historyId, { images: optimizedImages } as any);
      console.log('[markGenerationCompleted] Persisted optimized images to history', { historyId, optimizedCount: optimizedImages.filter((i: any) => i.optimized).length });
      try {
        const anyOpt = (optimizedImages as any[]).find((i: any) => i?.thumbnailUrl || i?.avifUrl);
        if (anyOpt) {
          console.log('[markGenerationCompleted] Verification: first optimized fields', {
            sampleThumb: (anyOpt as any)?.thumbnailUrl,
            sampleAvif: (anyOpt as any)?.avifUrl,
          });
        }
      } catch {}
      // Proactively refresh item cache with the up-to-date document to avoid stale GETs
      try {
        const freshItem = await generationHistoryRepository.get(uid, historyId);
        if (freshItem) {
          await setCachedItem(uid, historyId, freshItem);
        }
      } catch (e) {
        console.warn('[markGenerationCompleted] Failed to refresh cache for item:', e);
      }
    } catch {}
  }

  // Enqueue mirror upsert with optimized fields
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) {
      await mirrorQueueRepository.enqueueUpsert({ uid, historyId, itemSnapshot: fresh });
      console.log('[markGenerationCompleted] Enqueued mirror upsert with optimized fields', {
        historyId,
        isPublic: (fresh as any)?.isPublic,
        images: Array.isArray((fresh as any)?.images) ? (fresh as any)?.images.length : 0,
      });
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
    isPublic: false,
    visibility: Visibility.Private
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
  // Try cache first
  try {
    const cached = await getCachedItem(uid, historyId);
    if (cached) return cached;
  } catch (e) {
    console.warn('[getUserGeneration] Cache read failed, falling back to DB:', e);
  }
  const item = await generationHistoryRepository.get(uid, historyId);
  try {
    if (item) await setCachedItem(uid, historyId, item);
  } catch (e) {
    console.warn('[getUserGeneration] Failed to set cache:', e);
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
    debug?: string | boolean; // from query (?debug=1)
  }
): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string | number | null; hasMore?: boolean; totalCount?: number }> {
  // Normalize generation type; do NOT force status. We want generating + completed by default and exclude failed in post-filter.
  const debugFlag = params.debug === '1' || params.debug === 'true' || params.debug === true;
  const normalizedGenType = normalizeGenerationType(params.generationType as any);
  // Backward-compat: if requesting 'logo', include legacy 'logo-generation' too
  let generationTypeParam: any = normalizedGenType as any;
  if (typeof normalizedGenType === 'string' && normalizedGenType === 'logo') {
    generationTypeParam = ['logo', 'logo-generation'];
  } else if (Array.isArray(normalizedGenType)) {
    const set = new Set<string>(normalizedGenType as string[]);
    if (set.has('logo') || set.has('logo-generation')) {
      set.add('logo');
      set.add('logo-generation');
    }
    generationTypeParam = Array.from(set);
  }

  const effectiveParams = {
    ...params,
    generationType: generationTypeParam,
    debug: debugFlag,
    // status left as-is (undefined means no status filter at repository level)
  } as any;

  // Try cache for list results using effective params so key matches actual query semantics
  try {
    const cached = await getCachedList(uid, effectiveParams);
    if (cached) return cached;
  } catch (e) {
    console.warn('[listUserGenerations] Cache read failed, falling back to DB:', e);
  }

  const result = await generationHistoryRepository.list(uid, effectiveParams as any);

  // Post-filter: exclude failed items while preserving original hasMore/nextCursor semantics.
  // Note: If we filter out many failed items and end up with < limit while hasMore=true, we still return hasMore=true
  // so client can request the next page. For a perfect fill we could iteratively fetch more pages, but that is omitted
  // for performance simplicity.
  const filteredItems = Array.isArray(result.items) ? result.items.filter(it => it.status !== GenerationStatus.Failed) : [];
  const response = { ...result, items: filteredItems };
  if (debugFlag) {
    (response as any).diagnostics = {
      ...(response as any).diagnostics,
      postFilterReturned: filteredItems.length,
      postFilterExcluded: Array.isArray(result.items) ? (result.items.length - filteredItems.length) : 0,
      debug: true,
    };
  }
  try {
    await setCachedList(uid, effectiveParams, response);
  } catch (e) {
    console.warn('[listUserGenerations] Failed to set list cache:', e);
  }

  return response;
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
  const explicitIsPublicProvided = Object.prototype.hasOwnProperty.call(updates, 'isPublic') && typeof (updates as any).isPublic === 'boolean';
  const explicitIsPublicValue = explicitIsPublicProvided ? (updates as any).isPublic === true : undefined;

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

  // Recompute document-level isPublic considering explicit toggle precedence then media items
  if (nextDoc.images || nextDoc.videos || explicitIsPublicProvided) {
    const imgs = (nextDoc.images || existing.images || []) as any[];
    const vds = (nextDoc.videos || existing.videos || []) as any[];
    const anyMediaPublic = imgs.some((im: any) => im?.isPublic === true) || vds.some((vd: any) => vd?.isPublic === true);
    if (explicitIsPublicProvided) {
      // Explicit true forces public; explicit false only if no media marked public
      nextDoc.isPublic = explicitIsPublicValue ? true : (anyMediaPublic ? true : false);
    } else {
      nextDoc.isPublic = anyMediaPublic;
    }
  }
  // Align visibility with final isPublic state when changed or explicitly provided
  if (typeof nextDoc.isPublic === 'boolean') {
    nextDoc.visibility = nextDoc.isPublic ? Visibility.Public : Visibility.Private;
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
  // Immediate mirror sync if public flag changed to ensure ArtStation reflects toggle quickly
  try {
    const publicChanged = typeof nextDoc.isPublic === 'boolean' && nextDoc.isPublic !== (existing.isPublic === true);
    if (publicChanged) {
      await syncToMirror(uid, historyId);
    }
  } catch (e) {
    console.warn('[update] Immediate mirror sync failed:', e);
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
