import { generationHistoryRepository } from "../repository/generationHistoryRepository";
import { generationsMirrorRepository } from "../repository/generationsMirrorRepository";
import { mirrorQueueRepository } from "../repository/mirrorQueueRepository";
import { generationStatsRepository } from "../repository/generationStatsRepository";
import { imageOptimizationService } from "./imageOptimizationService";
// CACHING REMOVED: Redis generationCache disabled due to stale list items not reflecting newly started generations promptly.
// If reintroducing, ensure immediate inclusion of generating items and robust invalidation on create/complete/fail/update.
import { deleteGenerationFiles, deleteFiles, extractKeyFromUrl } from "../utils/storage/zataDelete";
import { getCachedItem, setCachedItem, getCachedList, setCachedList, invalidateLibraryCache } from "../utils/generationCache";
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
import { mapModeToGenerationTypes, normalizeMode } from "../utils/modeTypeMap";

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
  // Note: do not enqueue mirror upsert here to avoid writing pre-optimized snapshots to the public mirror.
  // Mirror upserts will be enqueued once the generation is completed and optimized.
  
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
      
      // Invalidate library cache when generation is completed (new items may appear in library)
      try {
        await invalidateLibraryCache(uid);
      } catch (e) {
        console.warn('[markGenerationCompleted] Failed to invalidate library cache:', e);
      }
    } catch {}
  }

  // Enqueue mirror upsert with optimized fields
  try {
    const fresh = await generationHistoryRepository.get(uid, historyId);
    if (fresh) {
      // Immediately write to public mirror so feed reflects optimized fields without waiting
      try {
        const creator = await authRepository.getUserById(uid);
        await generationsMirrorRepository.upsertFromHistory(uid, historyId, fresh, {
          uid,
          username: creator?.username,
          displayName: (creator as any)?.displayName,
          photoURL: creator?.photoURL,
        });
        console.log('[markGenerationCompleted] Wrote optimized snapshot to mirror (sync)', { historyId, isPublic: (fresh as any)?.isPublic });
      } catch (e) {
        console.warn('[markGenerationCompleted] Immediate mirror upsert failed, falling back to queue:', e);
        // Fallback: enqueue for async processing
        try { await mirrorQueueRepository.enqueueUpsert({ uid, historyId, itemSnapshot: fresh }); } catch (ee) { console.warn('[markGenerationCompleted] enqueueUpsert fallback failed:', ee); }
      }
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
  
  // Backfill inputImages for older generations that don't have them
  if (item && (!(item as any).inputImages || !Array.isArray((item as any).inputImages) || (item as any).inputImages.length === 0)) {
    const model = (item as any).model || '';
    const generationType = (item as any).generationType || '';
    const isSeedream = model.includes('seedream') || model.includes('seedream-4') || model.includes('bytedance/seedream');
    const isReplaceEdit = generationType === 'image-edit' || model.includes('google-nano-banana') || model.includes('seedream-4');
    
    if (isSeedream || isReplaceEdit) {
      try {
        const creator = await authRepository.getUserById(uid);
        const username = creator?.username || uid;
        const { env } = await import('../config/env');
        const zataPrefix = env.zataPrefix ? (env.zataPrefix.replace(/\/$/, '') + '/') : '';
        
        // Try common input file patterns
        const commonInputPatterns: string[] = [];
        
        if (isReplaceEdit) {
          // Replace/edit feature patterns
          commonInputPatterns.push(
            `users/${username}/input/${historyId}/replace-input.jpg`,
            `users/${username}/input/${historyId}/replace-input.png`,
            `users/${username}/input/${historyId}/replace-input.jpeg`,
            `users/${username}/input/${historyId}/replace-input`, // Without extension
          );
        }
        
        if (isSeedream) {
          // Seedream-specific patterns
          commonInputPatterns.push(
            `users/${username}/input/${historyId}/seedream-ref-1.jpg`,
            `users/${username}/input/${historyId}/seedream-ref-1.png`,
            `users/${username}/input/${historyId}/seedream-ref-1.jpeg`,
            `users/${username}/input/${historyId}/seedream-ref-fixed-1.jpg`,
            `users/${username}/input/${historyId}/seedream-ref-fixed-1.png`,
            // Generic input patterns
            `users/${username}/input/${historyId}/input-1.jpg`,
            `users/${username}/input/${historyId}/input-1.png`,
            `users/${username}/input/${historyId}/input-1.jpeg`,
            // Try without extension (some uploads might not have extensions)
            `users/${username}/input/${historyId}/seedream-ref-1`,
            `users/${username}/input/${historyId}/input-1`,
          );
        }
        
        const foundInputImages: any[] = [];
        const featureType = isReplaceEdit ? 'Replace/Edit' : 'Seedream';
        console.log(`[getUserGeneration] Attempting to backfill inputImages for ${featureType} generation`, { historyId, username, patternsToCheck: commonInputPatterns.length });
        
        for (const pattern of commonInputPatterns) {
          const testUrl = `${zataPrefix}${pattern}`;
          try {
            // Try to fetch the file to see if it exists (with timeout)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);
            const response = await fetch(testUrl, { 
              method: 'HEAD', 
              signal: controller.signal,
              headers: {
                'Accept': 'image/*',
              }
            });
            clearTimeout(timeoutId);
            if (response.ok && response.status === 200) {
              foundInputImages.push({
                id: `in-${foundInputImages.length + 1}`,
                url: testUrl,
                storagePath: pattern,
                originalUrl: testUrl,
              });
              console.log(`[getUserGeneration] Found input image via backfill for ${featureType}`, { historyId, pattern, url: testUrl });
              break; // Found at least one, that's enough
            }
          } catch (err: any) {
            // File doesn't exist or not accessible, continue
            if (err.name !== 'AbortError') {
              // Only log non-timeout errors for debugging
              console.debug('[getUserGeneration] Input image check failed', { pattern, error: err.message });
            }
          }
        }
        
        // If we found input images, save them to the database
        if (foundInputImages.length > 0) {
          await generationHistoryRepository.update(uid, historyId, { inputImages: foundInputImages } as any);
          (item as any).inputImages = foundInputImages;
          console.log(`[getUserGeneration] Successfully backfilled inputImages for ${featureType} generation`, { historyId, count: foundInputImages.length });
        } else {
          console.log(`[getUserGeneration] No input images found for ${featureType} generation (may not have been uploaded to storage)`, { historyId });
        }
      } catch (e: any) {
        // Log error but don't block the request
        console.warn('[getUserGeneration] Failed to backfill inputImages:', { historyId, error: e?.message || e });
      }
    }
  }
  
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
    mode?: 'video' | 'image' | 'music' | 'branding' | 'all';
    debug?: string | boolean; // from query (?debug=1)
  }
): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string | number | null; hasMore?: boolean; totalCount?: number }> {
  // Normalize generation type; do NOT force status. We want generating + completed by default and exclude failed in post-filter.
  const debugFlag = params.debug === '1' || params.debug === 'true' || params.debug === true;
  const normalizedGenType = normalizeGenerationType(params.generationType as any);
  const normalizedMode = normalizeMode(params.mode);
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

  // If no explicit generationType filter provided, derive from mode
  if ((!generationTypeParam || (Array.isArray(generationTypeParam) && generationTypeParam.length === 0)) && normalizedMode && normalizedMode !== 'all') {
    const mapped = mapModeToGenerationTypes(normalizedMode);
    if (mapped && mapped.length > 0) {
      generationTypeParam = mapped;
    }
  }

  const effectiveParams = {
    ...params,
    mode: normalizedMode,
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

  // Post-filter: exclude failed items.
  // IMPORTANT: If we remove items (especially at page tail), we must recompute nextCursor
  // based on the last item we actually return; otherwise the client cursor can "jump".
  const parseItemCursorMs = (it: any): number | null => {
    try {
      const raw = it?.createdAt || it?.updatedAt;
      if (typeof raw === 'string') {
        const ms = Date.parse(raw);
        return Number.isNaN(ms) ? null : ms;
      }
      if (typeof raw === 'number') return raw;
      return null;
    } catch {
      return null;
    }
  };

  const isFailed = (it: any) => it?.status === GenerationStatus.Failed;
  const aggregated: GenerationHistoryItem[] = [];
  const seenIds = new Set<string>();

  const pushNonFailed = (items: any[]) => {
    for (const it of items || []) {
      if (!it || isFailed(it)) continue;
      const id = String((it as any).id || '');
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      aggregated.push(it as GenerationHistoryItem);
      if (aggregated.length >= params.limit) break;
    }
  };

  pushNonFailed(Array.isArray(result.items) ? result.items : []);

  // Top-up: if filters removed items and there are more pages, fetch subsequent pages until we fill `limit`
  // (bounded by a small safety cap to avoid runaway reads).
  let currentNextCursor: any = (result as any).nextCursor;
  let hasMore: boolean = Boolean((result as any).hasMore);
  let scans = 0;
  const maxScans = 6;
  while (aggregated.length < params.limit && hasMore && scans < maxScans) {
    scans += 1;
    const remaining = Math.max(1, params.limit - aggregated.length);
    const nextCursorStr = currentNextCursor === null || currentNextCursor === undefined ? undefined : String(currentNextCursor);
    if (!nextCursorStr) break;

    const page = await generationHistoryRepository.list(uid, {
      ...effectiveParams,
      limit: remaining,
      nextCursor: nextCursorStr,
      cursor: undefined,
    } as any);

    pushNonFailed(Array.isArray(page.items) ? page.items : []);
    hasMore = Boolean((page as any).hasMore);

    // Ensure cursor advances; otherwise break to avoid infinite loops.
    if ((page as any).nextCursor === currentNextCursor) break;
    currentNextCursor = (page as any).nextCursor;
  }

  // Final cursor must reflect the last item ACTUALLY returned to the client.
  // If we couldn't compute from items, fall back to repository cursor.
  let finalNextCursor: string | number | null | undefined = undefined;
  if (hasMore && aggregated.length > 0) {
    const ms = parseItemCursorMs(aggregated[aggregated.length - 1]);
    finalNextCursor = ms ?? (currentNextCursor ?? (result as any).nextCursor ?? null);
  } else {
    finalNextCursor = null;
  }

  const response = {
    ...result,
    items: aggregated,
    hasMore,
    nextCursor: finalNextCursor,
  } as any;

  if (debugFlag) {
    const rawLen = Array.isArray(result.items) ? result.items.length : 0;
    const failedInFirst = Array.isArray(result.items) ? result.items.filter(isFailed).length : 0;
    response.diagnostics = {
      ...(response as any).diagnostics,
      postFilterExcludedFirstPage: failedInFirst,
      returned: aggregated.length,
      requestedLimit: params.limit,
      topUpScans: scans,
      finalNextCursor,
      rawFirstPage: rawLen,
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

export async function softDelete(uid: string, historyId: string, imageId?: string): Promise<{ item: GenerationHistoryItem }> {
  console.log('[softDelete] ========== STARTING DELETION ==========');
  console.log('[softDelete] Request:', { uid, historyId, imageId, timestamp: new Date().toISOString() });
  
  // 1. Fetch existing item
  const existing = await generationHistoryRepository.get(uid, historyId);
  if (!existing) {
    console.error('[softDelete] ❌ History item not found:', { uid, historyId });
    throw new ApiError('History item not found', 404);
  }

  // === SINGLE IMAGE DELETION LOGIC ===
  if (imageId) {
    const images = Array.isArray(existing.images) ? existing.images : [];
    const imageIndex = images.findIndex((img: any) => img.id === imageId);

    if (imageIndex !== -1) {
      const imageToDelete = images[imageIndex];
      const newImages = images.filter((_, idx) => idx !== imageIndex);

      // Check if generation becomes empty (no images, no videos, no audios)
      const hasVideos = Array.isArray(existing.videos) && existing.videos.length > 0;
      const hasAudios = Array.isArray(existing.audios) && existing.audios.length > 0;

      if (newImages.length === 0 && !hasVideos && !hasAudios) {
        // Proceed to full delete
        console.log('[softDelete] Generation became empty after removing image, performing full delete');
      } else {
        // Update generation with removed image
        console.log('[softDelete] Removing single image:', imageId);

        // a. Delete files for this specific image (background)
        const keysToDelete: string[] = [];
        if (imageToDelete.url) { const k = extractKeyFromUrl(imageToDelete.url); if (k) keysToDelete.push(k); }
        if (imageToDelete.avifUrl) { const k = extractKeyFromUrl(imageToDelete.avifUrl); if (k) keysToDelete.push(k); }
        if ((imageToDelete as any).webpUrl) { const k = extractKeyFromUrl((imageToDelete as any).webpUrl); if (k) keysToDelete.push(k); }
        if (imageToDelete.thumbnailUrl) { const k = extractKeyFromUrl(imageToDelete.thumbnailUrl); if (k) keysToDelete.push(k); }
        if (imageToDelete.storagePath) { keysToDelete.push(imageToDelete.storagePath); }
        
        if (keysToDelete.length > 0) {
          console.log('[softDelete] Deleting files for single image:', keysToDelete.length);
          // Fire and forget deletion
          deleteFiles(keysToDelete).catch(err => console.error('[softDelete] Failed to delete single image files:', err));
        }

        // b. Update in DB (using update service to handle cache/mirror/normalization)
        // Pass images: newImages. The update service will handle isPublic logic.
        const updateResult = await update(uid, historyId, { images: newImages });
        
        console.log('[softDelete] Single image removed successfully');
        return updateResult;
      }
    } else {
      console.warn('[softDelete] Image ID not found in generation, treating as success (idempotent)', imageId);
      return { item: existing };
    }
  }

  // === FULL GENERATION DELETION LOGIC (Existing) ===
  
  const generationType = existing.generationType || 'unknown';
  const hasImages = Array.isArray(existing.images) && existing.images.length > 0;
  // ... (rest of function)
  const hasVideos = Array.isArray(existing.videos) && existing.videos.length > 0;
  const hasAudios = Array.isArray(existing.audios) && existing.audios.length > 0;
  const imageCount = hasImages ? existing.images!.length : 0;
  const videoCount = hasVideos ? existing.videos!.length : 0;
  const audioCount = hasAudios ? existing.audios!.length : 0;
  
  console.log('[softDelete] Item details:', {
    historyId,
    uid,
    generationType,
    isPublic: existing.isPublic,
    isDeleted: existing.isDeleted,
    hasImages,
    imageCount,
    hasVideos,
    videoCount,
    hasAudios,
    audioCount,
    status: existing.status,
  });
  
  // CRITICAL: Delete from public mirror FIRST and IMMEDIATELY (synchronous)
  // This ensures the item disappears from ArtStation instantly, before Zata deletion
  // We use Firebase Admin DB directly for instant deletion
  console.log('[softDelete] Step 1: INSTANTLY deleting from public mirror repository (Firebase Admin DB)...');
  let mirrorDeleteSuccess = false;
  try {
    // Delete directly from mirror using Firebase Admin DB - this is INSTANT and SYNCHRONOUS
    await generationsMirrorRepository.remove(historyId);
    mirrorDeleteSuccess = true;
    console.log('[softDelete] ✅ Step 1: Successfully deleted from public mirror repository (INSTANT)');
  } catch (e: any) {
    console.error('[softDelete] ❌ Step 1: Failed to delete from mirror:', {
      error: e?.message || e,
      stack: e?.stack,
    });
    // Continue even if mirror deletion fails - we'll try again below
  }
  
  // Also enqueue a remove task as backup to ensure it's removed even if there are pending updates
  try {
    const { mirrorQueueRepository } = await import('../repository/mirrorQueueRepository');
    await mirrorQueueRepository.enqueueRemove({ historyId });
    console.log('[softDelete] ✅ Step 1a: Enqueued remove task to mirror queue (backup)');
  } catch (queueErr: any) {
    console.warn('[softDelete] ⚠️ Step 1a: Failed to enqueue remove task (non-critical):', queueErr?.message || queueErr);
  }
  
  // 2. Invalidate cache immediately after mirror deletion
  console.log('[softDelete] Step 2: Invalidating cache...');
  try {
    const { invalidateItem, invalidateUserLists, invalidatePublicFeedCache, invalidateLibraryCache } = await import('../utils/generationCache');
    await invalidateItem(uid, historyId);
    await invalidateUserLists(uid);
    await invalidateLibraryCache(uid);
    // CRITICAL: Invalidate public feed cache so ArtStation reflects deletion immediately
    await invalidatePublicFeedCache();
    console.log('[softDelete] ✅ Step 2: Cache invalidated (including public feed)');
  } catch (e: any) {
    console.warn('[softDelete] ⚠️ Step 2: Cache invalidation failed (non-critical):', e?.message || e);
  }
  
  // 3. Mark as deleted in generationHistory (soft delete)
  // This happens AFTER mirror deletion to ensure ArtStation updates first
  console.log('[softDelete] Step 3: Marking as deleted in generationHistory...');
  try {
    await generationHistoryRepository.update(uid, historyId, { isDeleted: true, isPublic: false } as any);
    console.log('[softDelete] ✅ Step 3: Successfully marked as deleted in generationHistory');
  } catch (e: any) {
    console.error('[softDelete] ❌ Step 3: Failed to mark as deleted in generationHistory:', e?.message || e);
    throw new ApiError('Failed to mark item as deleted', 500);
  }
  
  // 5. Delete files from Zata storage (in background, non-blocking)
  console.log('[softDelete] Step 4: Queuing Zata file deletion (background)...');
  const fileDeletionPromise = (async () => {
    try {
      console.log('[softDelete][Zata] Starting file deletion...');
      const fileCounts = {
        images: imageCount,
        videos: videoCount,
        audios: audioCount,
        total: imageCount + videoCount + audioCount,
      };
      console.log('[softDelete][Zata] Files to delete:', fileCounts);
      
      await deleteGenerationFiles(existing);
      console.log('[softDelete][Zata] ✅ Successfully deleted all files from Zata storage');
      return { success: true, fileCounts };
    } catch (e: any) {
      console.error('[softDelete][Zata] ❌ Failed to delete files from Zata:', {
        error: e?.message || e,
        stack: e?.stack,
      });
      return { success: false, error: e?.message || 'Unknown error' };
    }
  })();
  
  // Start file deletion in background (don't await)
  setImmediate(() => {
    fileDeletionPromise.catch(err => {
      console.error('[softDelete][Zata] Unhandled error in background deletion:', err);
    });
  });
  
  console.log('[softDelete] ========== DELETION COMPLETED ==========');
  console.log('[softDelete] Summary:', {
    historyId,
    uid,
    generationType,
    mirrorDeleted: mirrorDeleteSuccess,
    filesQueuedForDeletion: imageCount + videoCount + audioCount,
    response: {
      isDeleted: true,
      isPublic: false,
    },
  });
  
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

  // Check if this update is marking the item as deleted
  const isBeingDeleted = (nextDoc.isDeleted === true) || (existing.isDeleted === true && nextDoc.isDeleted !== false);
  const willBeDeleted = nextDoc.isDeleted === true;
  
  console.log('[update] Step 1: Updating generationHistory repository...');
  await generationHistoryRepository.update(uid, historyId, nextDoc);
  console.log('[update] ✅ Step 1: Successfully updated generationHistory');

  // Invalidate cache
  console.log('[update] Step 2: Invalidating cache...');
  try {
    const { invalidateItem, invalidateUserLists, invalidateLibraryCache } = await import('../utils/generationCache');
    await invalidateItem(uid, historyId);
    await invalidateLibraryCache(uid);
    await invalidateUserLists(uid);
    console.log('[update] ✅ Step 2: Cache invalidated');
  } catch (e: any) {
    console.warn('[update] ⚠️ Step 2: Cache invalidation failed (non-critical):', e?.message || e);
  }

  // CRITICAL: If item is being deleted or is already deleted, remove from mirror instead of updating
  if (willBeDeleted || isBeingDeleted) {
    console.log('[update] Step 3: Item is deleted - removing from mirror instead of updating...');
    try {
      await generationsMirrorRepository.remove(historyId);
      // Also enqueue remove to ensure it's processed by queue workers
      try {
        const { mirrorQueueRepository } = await import('../repository/mirrorQueueRepository');
        await mirrorQueueRepository.enqueueRemove({ historyId });
        console.log('[update] ✅ Step 3: Removed from mirror and enqueued remove task');
      } catch (queueErr: any) {
        console.warn('[update] ⚠️ Step 3: Failed to enqueue remove (non-critical):', queueErr?.message || queueErr);
      }
    } catch (e: any) {
      console.error('[update] ❌ Step 3: Failed to remove from mirror:', e?.message || e);
    }
    console.log('[update] ========== UPDATE COMPLETED (DELETED) ==========');
  } else {
    // Only sync to mirror if item is NOT deleted
    const publicChanged = typeof nextDoc.isPublic === 'boolean' && nextDoc.isPublic !== (existing.isPublic === true);
    const wasPublic = existing.isPublic === true;
    const nowPublic = nextDoc.isPublic === true;

    console.log('[update] Visibility change:', {
      historyId,
      uid,
      generationType: existing.generationType,
      publicChanged,
      wasPublic,
      nowPublic,
      visibility: nextDoc.visibility,
      hasImages: !!nextDoc.images,
      hasVideos: !!nextDoc.videos,
      hasAudios: !!nextDoc.audios,
    });

    // OPTIMIZATION: Enqueue mirror update instead of blocking
    console.log('[update] Step 3: Enqueuing mirror update...');
    try {
      await mirrorQueueRepository.enqueueUpdate({ uid, historyId, updates: nextDoc });
      console.log('[update] ✅ Step 3: Successfully enqueued mirror update');
    } catch (e: any) {
      console.error('[update] ❌ Step 3: Failed to enqueue mirror update:', e?.message || e);
    }
    
    // Immediate mirror sync if public flag changed to ensure ArtStation reflects toggle quickly
    if (publicChanged) {
      console.log('[update] Step 4: Immediate mirror sync (public flag changed)...');
      try {
        await syncToMirror(uid, historyId);
        console.log('[update] ✅ Step 4: Successfully synced to mirror immediately');
      } catch (e: any) {
        console.warn('[update] ⚠️ Step 4: Immediate mirror sync failed (non-critical, will retry via queue):', e?.message || e);
      }
    } else {
      console.log('[update] Step 4: Skipping immediate mirror sync (public flag unchanged)');
    }
    console.log('[update] ========== UPDATE COMPLETED ==========');
  }
  
  console.log('[update] ========== UPDATE COMPLETED ==========');
  
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
