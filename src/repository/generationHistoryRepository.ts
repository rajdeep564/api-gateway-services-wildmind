import { adminDb, admin } from '../config/firebaseAdmin';
import { GenerationHistoryItem, GenerationStatus, Visibility, GenerationType } from '../types/generate';
import { logger } from '../utils/logger';
import { invalidateUserLists, invalidateItem } from '../utils/generationCache';
import { mirrorQueueRepository } from './mirrorQueueRepository';
import { getModeTypeSet, normalizeMode } from '../utils/modeTypeMap';

function toIso(value: any): any {
  try {
    if (value && typeof (value as any).toDate === 'function') {
      return (value as any).toDate().toISOString();
    }
    return value;
  } catch {
    return value;
  }
}

function normalizeItem(id: string, data: any): GenerationHistoryItem {
  const createdAt = toIso(data?.createdAt);
  const updatedAt = toIso(data?.updatedAt);
  return { id, ...data, ...(createdAt ? { createdAt } : {}), ...(updatedAt ? { updatedAt } : {}) } as GenerationHistoryItem;
}

const normalizeTypeValue = (value?: string): string => {
  if (!value) return '';
  return String(value).replace(/[_-]/g, '-').toLowerCase();
};

const filterItemsByMode = <T extends { generationType?: string }>(
  items: T[],
  mode?: 'video' | 'image' | 'music' | 'branding' | 'all'
): { filtered: T[]; removed: number } => {
  const normalizedMode = normalizeMode(mode);
  if (!normalizedMode || normalizedMode === 'all') {
    return { filtered: items, removed: 0 };
  }
  const allowedSet = getModeTypeSet(normalizedMode);
  if (!allowedSet || allowedSet.size === 0) {
    return { filtered: items, removed: 0 };
  }
  const filtered = items.filter((item) =>
    allowedSet.has(normalizeTypeValue(item?.generationType))
  );
  return { filtered, removed: items.length - filtered.length };
};

export async function create(uid: string, data: {
  prompt: string;
  userPrompt?: string;
  // Rich text fields for audio/music generations
  lyrics?: string;
  fileName?: string;
  model: string;
  generationType: GenerationType | string;
  visibility?: Visibility | string;
  tags?: string[];
  nsfw?: boolean;
  frameSize?: string;
  aspect_ratio?: string;
  isPublic?: boolean;
  characterName?: string;
  quality?: string;
  resolution?: string;
  duration?: number | string;
  createdBy?: { uid: string; username?: string; email?: string };
}): Promise<{ historyId: string }> {
  // Centralized isPublic validation and audit logging
  const hasIsPublicProp = Object.prototype.hasOwnProperty.call(data, 'isPublic');
  const rawIsPublic: unknown = (data as any).isPublic;
  const normalizedIsPublic = rawIsPublic === true; // strict policy: only boolean true is public

  try {
    if (!hasIsPublicProp) {
      logger.warn({ uid, generationType: data.generationType, model: data.model }, '[Visibility] isPublic missing on request; defaulting to false');
    } else if (typeof rawIsPublic !== 'boolean') {
      logger.warn({ uid, generationType: data.generationType, model: data.model, rawType: typeof rawIsPublic, rawValue: rawIsPublic }, '[Visibility] isPublic provided but not boolean; defaulting to false');
    } else {
      logger.info({ uid, generationType: data.generationType, model: data.model, isPublic: normalizedIsPublic }, '[Visibility] isPublic received');
    }
  } catch (_e) {
    // never block creation due to logging issues
  }

  const col = adminDb.collection('generationHistory').doc(uid).collection('items');
  const docRef = await col.add({
    uid,
    prompt: data.prompt,
    userPrompt: data.userPrompt || null,
    // Persist lyrics and fileName when provided so frontend can restore
    // the track title and lyrics even after a hard refresh.
    lyrics: data.lyrics || null,
    fileName: data.fileName || null,
    model: data.model,
    generationType: data.generationType,
    visibility: (data.visibility as Visibility) || Visibility.Private,
    tags: data.tags || [],
    nsfw: data.nsfw ?? false,
    frameSize: data.frameSize || null,
    aspect_ratio: data.aspect_ratio || data.frameSize || null,
    isPublic: normalizedIsPublic,
    // Store characterName only for text-to-character generation type
    ...(data.generationType === 'text-to-character' && data.characterName ? { characterName: data.characterName } : {}),
    // Video generation specific fields
    ...(data.quality ? { quality: data.quality } : {}),
    ...(data.resolution ? { resolution: data.resolution } : {}),
    ...(data.duration ? { duration: data.duration } : {}),
    createdBy: data.createdBy ? {
      uid: data.createdBy.uid,
      username: data.createdBy.username || null,
      email: data.createdBy.email || null,
    } : {
      uid,
      username: null,
      email: null,
    },
    status: GenerationStatus.Generating,
    isDeleted: false,
    images: [],
    videos: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  // Invalidate list caches for this user so list endpoints return fresh data
  try {
    await invalidateUserLists(uid);
  } catch (e) {
    // Non-blocking: logging only
    try { logger.warn({ uid, err: e }, '[generationHistoryRepository.create] Failed to invalidate cache'); } catch { }
  }
  return { historyId: docRef.id };
}

/**
 * Remove undefined values from an object recursively
 * Firestore doesn't allow undefined values
 */
function removeUndefinedValues(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => removeUndefinedValues(item));
  }

  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = removeUndefinedValues(value);
    }
  }
  return cleaned;
}

export async function update(uid: string, historyId: string, updates: Partial<GenerationHistoryItem>): Promise<void> {
  const ref = adminDb.collection('generationHistory').doc(uid).collection('items').doc(historyId);

  // Sanitize large / nested structures before saving to Firestore
  const safeUpdates: Partial<GenerationHistoryItem> = { ...updates };

  // 1) Guard against very large data URLs inside inputImages / images, which can
  //    trigger "Property array contains an invalid nested entity" when an element
  //    exceeds Firestore's per‑field size limit (~1 MiB).
  const sanitizeOriginalUrl = (value: any): string | undefined => {
    if (typeof value !== 'string') return undefined;
    // Strip huge base64 data URLs – we only need the storage URL we persist separately.
    if (value.startsWith('data:image') || value.startsWith('data:video')) {
      return undefined;
    }
    // Guard against accidentally passing extremely long strings.
    if (value.length > 5000) {
      return value.slice(0, 5000);
    }
    return value;
  };

  if (Array.isArray((safeUpdates as any).inputImages)) {
    (safeUpdates as any).inputImages = (safeUpdates as any).inputImages.map((img: any) => ({
      id: img?.id,
      url: img?.url,
      storagePath: img?.storagePath,
      // Drop or trim problematic originals; Firestore already has the binary file in storage.
      originalUrl: sanitizeOriginalUrl(img?.originalUrl),
    }));
  }

  if (Array.isArray((safeUpdates as any).images)) {
    (safeUpdates as any).images = (safeUpdates as any).images.map((img: any) => ({
      url: img?.url,
      storagePath: img?.storagePath,
      originalUrl: sanitizeOriginalUrl(img?.originalUrl),
      thumbUrl: img?.thumbUrl,
      avifUrl: img?.avifUrl,
    }));
  }

  // Remove undefined values before saving to Firestore
  const cleanedUpdates = removeUndefinedValues(safeUpdates);

  // Debug: Check for nested structures in images array
  if (cleanedUpdates.images && Array.isArray(cleanedUpdates.images)) {
    console.log('[generationHistoryRepository.update] Checking images array for nested structures:', {
      imagesCount: cleanedUpdates.images.length,
      firstImageKeys: cleanedUpdates.images[0] ? Object.keys(cleanedUpdates.images[0]) : [],
      firstImageTypes: cleanedUpdates.images[0] ? Object.entries(cleanedUpdates.images[0]).map(([k, v]) => ({
        key: k,
        type: typeof v,
        isArray: Array.isArray(v),
        isObject: typeof v === 'object' && v !== null && !Array.isArray(v) && v.constructor === Object,
        value: typeof v === 'string' ? v.substring(0, 50) + '...' : v,
      })) : [],
    });

    // Check each image for nested objects
    cleanedUpdates.images.forEach((img: any, index: number) => {
      if (img && typeof img === 'object') {
        Object.entries(img).forEach(([key, value]) => {
          if (value && typeof value === 'object' && !Array.isArray(value) && value.constructor === Object) {
            console.error(`[generationHistoryRepository.update] NESTED OBJECT FOUND in images[${index}].${key}:`, value);
          }
        });
      }
    });
  }

  try {
    await ref.update({
      ...cleanedUpdates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    } as any);
    console.log('[generationHistoryRepository.update] ✅ Successfully updated Firestore');
  } catch (error: any) {
    console.error('[generationHistoryRepository.update] ❌ Firestore update failed:', {
      message: error.message,
      code: error.code,
      updates: JSON.stringify(cleanedUpdates, null, 2).substring(0, 1000),
    });
    throw error;
  }
  // Invalidate cache for the single item and user lists
  try {
    await invalidateItem(uid, historyId);
  } catch (e) {
    try { logger.warn({ uid, historyId, err: e }, '[generationHistoryRepository.update] Failed to invalidate cache'); } catch { }
  }

  // Enqueue mirror update asynchronously so public mirror reflects repository changes.
  // Do not block caller on mirror queue failures.
  // CRITICAL: Do NOT enqueue mirror updates if item is being deleted - deletion is handled separately
  try {
    const isBeingDeleted = (updates as any)?.isDeleted === true;
    if (isBeingDeleted) {
      // Item is being deleted - don't enqueue mirror update (deletion is handled by softDelete/update service)
      try { logger.info({ uid, historyId }, '[generationHistoryRepository.update] Skipping mirror update - item is being deleted'); } catch { }
      return;
    }

    // Only enqueue if there are meaningful updates (avoid noise). For simplicity,
    // enqueue when updates contains images, videos, isPublic, visibility, status, or error fields.
    const interesting = ['images', 'videos', 'isPublic', 'visibility', 'status', 'error'];
    const hasInteresting = Object.keys(cleanedUpdates || {}).some(k => interesting.includes(k));
    if (hasInteresting) {
      // Fire-and-forget
      mirrorQueueRepository.enqueueUpdate({ uid, historyId, updates: cleanedUpdates });
    }
  } catch (e) {
    try { logger.warn({ uid, historyId, err: e }, '[generationHistoryRepository.update] Failed to enqueue mirror update'); } catch { }
  }
}

export async function get(uid: string, historyId: string): Promise<GenerationHistoryItem | null> {
  const ref = adminDb.collection('generationHistory').doc(uid).collection('items').doc(historyId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  return normalizeItem(snap.id, data);
}

export async function list(uid: string, params: {
  limit: number;
  cursor?: string; // LEGACY: document ID cursor (deprecated, use nextCursor instead)
  nextCursor?: string; // NEW: createdAt timestamp in milliseconds for optimized pagination
  status?: 'generating' | 'completed' | 'failed';
  generationType?: GenerationType | string | string[];
  sortBy?: 'createdAt' | 'updatedAt' | 'prompt'; // LEGACY: kept for backward compatibility
  sortOrder?: 'asc' | 'desc'; // LEGACY: kept for backward compatibility
  dateStart?: string; // LEGACY: ISO date string for range filtering
  dateEnd?: string; // LEGACY: ISO date string for range filtering
  search?: string;
  mode?: 'video' | 'image' | 'music' | 'branding' | 'all';
  debug?: boolean; // when true include diagnostics
}): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string | number | null; hasMore?: boolean; totalCount?: number; diagnostics?: any }> {
  const col = adminDb.collection('generationHistory').doc(uid).collection('items');
  const normalizedMode = normalizeMode(params.mode);
  const hasModeFilter = Boolean(normalizedMode && normalizedMode !== 'all');

  // Determine if we're using new optimized pagination or legacy mode
  // Allow explicit sortBy=createdAt without disabling optimized path. Optimized path triggers if:
  // - nextCursor provided OR
  // - (sortBy absent OR sortBy==='createdAt') and no legacy-only fields and no legacy cursor
  // IMPORTANT: Optimized path supports both 'asc' and 'desc' sortOrder
  // When sortOrder is explicitly provided (asc or desc), use optimized path if sortBy is createdAt or absent
  const useOptimizedPagination = params.nextCursor !== undefined || (
    (!params.cursor) && (!params.dateStart && !params.dateEnd) && (
      !params.sortBy || params.sortBy === 'createdAt'
    )
  );

  // NEW OPTIMIZED PATH: Use createdAt with proper sortOrder (asc/desc) and timestamp cursor
  if (useOptimizedPagination) {
    // IMPORTANT: Do NOT filter by isDeleted at query level.
    // Many older documents may not have the isDeleted field at all, and Firestore
    // equality filters exclude documents where the field is missing. That caused
    // pages to appear nearly empty when most docs lacked the field.
    // We now filter isDeleted in-memory after fetching, while keeping the query fully indexed.
    // Respect sortOrder parameter: 'asc' for oldest first, 'desc' for newest first
    const sortOrder = params.sortOrder || 'desc';
    let q: FirebaseFirestore.Query = col.orderBy('createdAt', sortOrder);

    // Apply filters with proper composite index support
    if (params.status) {
      q = q.where('status', '==', params.status);
    }

    if (params.generationType) {
      // Build a synonym set to capture legacy underscore vs hyphen variants and short forms
      const buildTypeSynonyms = (t: string): string[] => {
        const norm = t.trim();
        const out = new Set<string>();
        out.add(norm);
        // underscore / hyphen swap
        out.add(norm.replace(/-/g, '_'));
        out.add(norm.replace(/_/g, '-'));
        // short forms for certain generations
        if (norm === 'sticker-generation' || norm === 'sticker') { out.add('sticker'); out.add('sticker-generation'); }
        if (norm === 'product-generation' || norm === 'product') { out.add('product'); out.add('product-generation'); }
        if (norm === 'mockup-generation' || norm === 'mockup') { out.add('mockup'); out.add('mockup-generation'); }
        if (norm === 'ad-generation' || norm === 'ad') { out.add('ad'); out.add('ad-generation'); }
        if (norm === 'logo' || norm === 'logo-generation') { out.add('logo'); out.add('logo-generation'); }
        if (norm === 'text-to-image' || norm === 'text_to_image' || norm === 'image-to-image') { out.add('text-to-image'); out.add('text_to_image'); }
        if (norm === 'text-to-video' || norm === 'text_to_video') { out.add('text-to-video'); out.add('text_to_video'); }
        if (norm === 'image-to-video' || norm === 'image_to_video') { out.add('image-to-video'); out.add('image_to_video'); }
        if (norm === 'video-to-video' || norm === 'video_to_video') { out.add('video-to-video'); out.add('video_to_video'); }
        if (norm === 'text-to-music' || norm === 'text_to_music') { out.add('text-to-music'); out.add('text_to_music'); }
        return Array.from(out).slice(0, 10); // Firestore 'in' max 10
      };

      if (Array.isArray(params.generationType)) {
        const types = params.generationType.flatMap(t => buildTypeSynonyms(String(t))).filter(t => !!t);
        const unique = Array.from(new Set(types));
        if (unique.length === 1) {
          q = q.where('generationType', '==', unique[0]);
        } else if (unique.length > 1 && unique.length <= 10) {
          q = q.where('generationType', 'in', unique);
        }
      } else if (typeof params.generationType === 'string') {
        const syns = buildTypeSynonyms(params.generationType);
        if (syns.length === 1) {
          q = q.where('generationType', '==', syns[0]);
        } else if (syns.length > 1) {
          q = q.where('generationType', 'in', syns);
        }
      }
    }

    // Handle cursor-based pagination using createdAt timestamp
    if (params.nextCursor) {
      try {
        const cursorTimestamp = admin.firestore.Timestamp.fromMillis(parseInt(String(params.nextCursor)));
        q = q.startAfter(cursorTimestamp);
      } catch (e) {
        console.warn('[list] Invalid nextCursor, ignoring:', e);
      }
    }

    // Fetch more than requested to compensate for in-memory filters (e.g., isDeleted true)
    // and still return a full page. Cap to a safe value to avoid large reads.
    const modeMultiplier = hasModeFilter ? 6 : 3;
    const fetchLimit = Math.min(
      400,
      Math.max(params.limit * modeMultiplier, params.limit + (hasModeFilter ? 40 : 10))
    );

    // For mode-filtered VIDEO lists, avoid returning empty pages (items:[])
    // by scanning forward until we collect enough video items or exhaust the collection.
    // This avoids requiring composite indexes while keeping pagination stable.
    const wantsVideoScan = hasModeFilter && normalizedMode === 'video' && !params.generationType;

    const normalizeSearchTokens = (s: any): string[] => {
      try {
        const str = String(s || '').trim().toLowerCase();
        if (!str) return [];
        // Split on whitespace; keep a small cap to avoid pathological queries
        return str.split(/\s+/g).map(t => t.trim()).filter(Boolean).slice(0, 6);
      } catch {
        return [];
      }
    };

    const matchesSearch = (promptVal: any, tokens: string[]): boolean => {
      if (!tokens.length) return true;
      const hay = String(promptVal || '').toLowerCase();
      // Require ALL tokens to be present (e.g., "cat lion" matches prompts containing both).
      return tokens.every((t) => hay.includes(t));
    };

    const applyInMemoryFilters = (raw: GenerationHistoryItem[]) => {
      let items = raw;
      items = items.filter((it: any) => it.isDeleted !== true);
      const searchTokens = normalizeSearchTokens(params.search);
      if (searchTokens.length > 0) {
        items = items.filter((it: any) => matchesSearch((it as any).prompt, searchTokens));
      }
      const { filtered: modeFilteredItems, removed: removedByMode } = filterItemsByMode(items, normalizedMode as any);
      return { items: modeFilteredItems, removedByMode };
    };

    const getCreatedAtMillisFromDoc = (doc: FirebaseFirestore.QueryDocumentSnapshot): number | null => {
      try {
        const rawCreated = (doc?.data() as any)?.createdAt;
        if (rawCreated && typeof (rawCreated as any).toDate === 'function') {
          const ms = (rawCreated as any).toDate().getTime();
          return Number.isNaN(ms) ? null : ms;
        }
        if (typeof rawCreated === 'string') {
          const ms = new Date(rawCreated).getTime();
          return Number.isNaN(ms) ? null : ms;
        }
        return null;
      } catch {
        return null;
      }
    };

    const fetchOnce = async (cursorMs?: number) => {
      let qq: FirebaseFirestore.Query = col.orderBy('createdAt', sortOrder);
      if (params.status) qq = qq.where('status', '==', params.status);
      // generationType filters are handled above (and wantsVideoScan only when generationType is absent)
      if (cursorMs !== undefined) {
        try {
          const ts = admin.firestore.Timestamp.fromMillis(Number(cursorMs));
          qq = qq.startAfter(ts);
        } catch { }
      } else if (params.nextCursor) {
        try {
          const ts = admin.firestore.Timestamp.fromMillis(parseInt(String(params.nextCursor)));
          qq = qq.startAfter(ts);
        } catch { }
      }
      return await qq.limit(fetchLimit).get();
    };

    try {
      const wantsSearchScan = normalizeSearchTokens(params.search).length > 0;
      const wantsScan = wantsVideoScan || wantsSearchScan;

      if (!wantsScan) {
        const snap = await q.limit(fetchLimit).get();
        if (snap.empty) {
          return { items: [], nextCursor: null, hasMore: false, diagnostics: params.debug ? { path: 'optimized', empty: true } : undefined };
        }

        let items: GenerationHistoryItem[] = snap.docs.map(d => normalizeItem(d.id, d.data() as any));
        const beforeDeleteFilterCount = items.length;
        const { items: filteredItems, removedByMode } = applyInMemoryFilters(items);
        items = filteredItems;

        const rawCount = snap.docs.length;
        // Determine hasMore: if we fetched the full limit OR items were filtered out, there might be more
        // We should set hasMore=true if:
        // 1. We got the full fetchLimit from DB (more docs might exist)
        // 2. Items were removed by filters (we need to fetch more to fill the page)
        // 3. After filtering, we still have more than requested limit
        let hasMore = items.length > params.limit || rawCount >= fetchLimit || removedByMode > 0;
        const pageItems = items.slice(0, params.limit);

        // Special case: if we returned 0 items but had raw docs, don't set hasMore
        // This prevents infinite loops when all items are filtered out
        if (pageItems.length === 0 && items.length === 0) {
          hasMore = rawCount >= fetchLimit; // Only continue if we hit the fetch limit
        }

        // IMPORTANT: nextCursor must advance to the last RETURNED item, not the last
        // over-fetched raw doc. Otherwise pagination will skip large time ranges.
        let nextCursor: number | null = null;
        if (hasMore && snap.docs.length > 0 && pageItems.length > 0) {
          const lastReturnedId = (pageItems[pageItems.length - 1] as any)?.id;
          const cursorDoc = lastReturnedId ? snap.docs.find((d) => d.id === lastReturnedId) : undefined;
          nextCursor = cursorDoc ? getCreatedAtMillisFromDoc(cursorDoc) : getCreatedAtMillisFromDoc(snap.docs[snap.docs.length - 1]);
        }

        return {
          items: pageItems,
          nextCursor,
          hasMore,
          diagnostics: params.debug ? {
            path: 'optimized',
            requestedLimit: params.limit,
            fetchLimit,
            fetchedRaw: snap.docs.length,
            filteredAfterDelete: items.length,
            returned: pageItems.length,
            hasMore,
            appliedFilters: { status: params.status || null, generationType: params.generationType || null, mode: normalizedMode || null },
            generationTypeSynonymsUsed: params.generationType ? (Array.isArray(params.generationType) ? params.generationType : [params.generationType]) : [],
            removedByMode,
            beforeDeleteFilterCount,
          } : undefined
        };
      }

      // Scan path: keep fetching forward until we collect enough items (used for video mode and/or search).
      const target = params.limit + 1; // +1 to detect hasMore
      const maxScans = 8; // safety cap
      let cursorMs: number | undefined = params.nextCursor ? parseInt(String(params.nextCursor)) : undefined;
      let scanned = 0;
      let all: GenerationHistoryItem[] = [];
      let lastRawDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      let lastRemovedByMode = 0;
      let ended = false;

      while (all.length < target && scanned < maxScans) {
        scanned += 1;
        const snap = await fetchOnce(cursorMs);
        if (snap.empty) { ended = true; break; }
        lastRawDoc = snap.docs[snap.docs.length - 1];
        const newCursorMs = getCreatedAtMillisFromDoc(lastRawDoc);
        
        // Ensure cursor advances forward (not backward)
        if (newCursorMs && cursorMs !== undefined) {
          if (newCursorMs <= cursorMs) {
            // Cursor didn't advance or went backward - we've hit the end
            ended = true;
            break;
          }
        }
        cursorMs = newCursorMs || cursorMs;

        let batch: GenerationHistoryItem[] = snap.docs.map(d => normalizeItem(d.id, d.data() as any));
        const { items: filteredItems, removedByMode } = applyInMemoryFilters(batch);
        lastRemovedByMode += removedByMode;
        all.push(...filteredItems);

        // If we didn't even fill the fetchLimit, we've reached the end.
        if (snap.docs.length < fetchLimit) { ended = true; break; }
      }

      // If we scanned but found no items, there are no more matching items
      // Set hasMore to false to prevent infinite pagination
      // Also check if we actually reached the end vs just filtering everything out
      const hasMore = all.length > params.limit || (!ended && all.length > 0);
      const pageItems = all.slice(0, params.limit);
      // IMPORTANT: nextCursor must be based on the last RETURNED item.
      // Using the last scanned raw doc causes skipped results (especially when scanning/overfetching).
      let nextCursor: number | null = null;
      if (hasMore && pageItems.length > 0) {
        const last = pageItems[pageItems.length - 1] as any;
        const lastCreated = last?.createdAt || last?.updatedAt;
        const ms = typeof lastCreated === 'string' ? Date.parse(lastCreated) : NaN;
        nextCursor = Number.isNaN(ms) ? null : ms;
      }

      return {
        items: pageItems,
        nextCursor,
        hasMore,
        diagnostics: params.debug ? {
          path: wantsVideoScan ? 'optimized-video-scan' : 'optimized-scan',
          requestedLimit: params.limit,
          fetchLimit,
          scans: scanned,
          returned: pageItems.length,
          accumulated: all.length,
          nextCursor,
          removedByMode: lastRemovedByMode,
        } : undefined
      };
    } catch (e: any) {
      // If composite index is missing, fall back to legacy pagination
      const codeStr = String(e?.code || '').toLowerCase();
      const isMissingIndexError =
        codeStr === 'failed-precondition' ||
        e?.code === 9 ||
        /index|composite/i.test(String(e?.message || ''));

      if (isMissingIndexError) {
        console.warn(
          `[list] Missing Firestore composite index. Falling back to legacy pagination. ` +
          `Please create index for: generationHistory/{uid}/items with fields: ` +
          `${params.status ? 'status, ' : ''}${params.generationType ? 'generationType, ' : ''}createdAt DESC, isDeleted`
        );
        return listLegacy(uid, params);
      }
      throw e;
    }
  }

  // LEGACY PATH: Support old pagination with sortBy, sortOrder, dateStart, dateEnd
  const legacyResult = await listLegacy(uid, params);
  return { ...legacyResult, diagnostics: params.debug ? { path: 'legacy', requestedLimit: params.limit, returned: legacyResult.items.length } : undefined } as any;
}

// Legacy pagination logic (kept for backward compatibility)
async function listLegacy(uid: string, params: {
  limit: number;
  cursor?: string;
  status?: 'generating' | 'completed' | 'failed';
  generationType?: GenerationType | string | string[];
  sortBy?: 'createdAt' | 'updatedAt' | 'prompt';
  sortOrder?: 'asc' | 'desc';
  dateStart?: string;
  dateEnd?: string;
  search?: string;
  mode?: 'video' | 'image' | 'music' | 'branding' | 'all';
}): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string; totalCount?: number }> {
  const col = adminDb.collection('generationHistory').doc(uid).collection('items');

  // Default sorting
  const sortBy = params.sortBy || 'createdAt';
  const sortOrder = params.sortOrder || 'desc';

  let q: FirebaseFirestore.Query = col.orderBy(sortBy, sortOrder);

  // Get total count for pagination context
  let totalCount: number | undefined;
  if (params.generationType || params.status) {
    const countQuery = await col.get();
    totalCount = countQuery.docs.length;
  }

  // Apply filters
  if (params.status) {
    q = q.where('status', '==', params.status);
  }

  if (params.generationType) {
    if (Array.isArray(params.generationType)) {
      const types = (params.generationType as string[]).filter(t => !!t);
      if (types.length > 0 && types.length <= 10) {
        q = q.where('generationType', 'in', types);
      } else if (types.length === 1) {
        q = q.where('generationType', '==', types[0]);
      }
    } else if (typeof params.generationType === 'string') {
      q = q.where('generationType', '==', params.generationType);
    }
  }

  // Optional date filtering
  const wantsDateFilter = typeof params.dateStart === 'string' && typeof params.dateEnd === 'string';
  if (wantsDateFilter) {
    try {
      const start = new Date(params.dateStart as string);
      const end = new Date(params.dateEnd as string);
      q = col.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start))
        .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(end))
        .orderBy('createdAt', sortOrder);
    } catch {
      // Ignore date filter if invalid
    }
  }

  // Handle cursor-based pagination (document ID)
  if (params.cursor) {
    const cursorDoc = await col.doc(params.cursor).get();
    if (cursorDoc.exists) {
      q = q.startAfter(cursorDoc);
    }
  }

  const legacyModeMultiplier = (params.mode && params.mode !== 'all') ? 6 : 1;
  const fetchCount = params.status || params.generationType ?
    Math.max(params.limit * 2 * legacyModeMultiplier, params.limit) :
    Math.max(params.limit * 4 * legacyModeMultiplier, params.limit);

  let snap: FirebaseFirestore.QuerySnapshot;
  try {
    snap = await q.limit(fetchCount).get();
  } catch (e: any) {
    // Fallback for missing composite index
    const codeStr = String(e?.code || '').toLowerCase();
    const isMissingIndexError =
      codeStr === 'failed-precondition' ||
      e?.code === 9 ||
      /index|composite/i.test(String(e?.message || ''));
    if (isMissingIndexError) {
      // Iteratively scan by createdAt
      const batchLimit = Math.max(params.limit * 10, 100);
      let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      let pooledDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (let i = 0; i < 10 && pooledDocs.length < (params.limit * 2); i++) {
        let fallbackQ: FirebaseFirestore.Query = col.orderBy(sortBy, sortOrder);
        if (lastDoc) fallbackQ = fallbackQ.startAfter(lastDoc);
        const batch = await fallbackQ.limit(batchLimit).get();
        if (batch.empty) break;
        pooledDocs.push(...batch.docs);
        lastDoc = batch.docs[batch.docs.length - 1];
      }
      snap = { docs: pooledDocs } as any;
    } else {
      throw e;
    }
  }

  let items: GenerationHistoryItem[] = snap.docs.map(d => normalizeItem(d.id, d.data() as any));
  items = items.filter((it: any) => it.isDeleted !== true);

  // Apply in-memory filters
  if (params.status) {
    const want = String(params.status).toLowerCase();
    items = items.filter((it) => String((it as any).status).toLowerCase() === want);
  }

  if (Array.isArray(params.generationType as any)) {
    const types = params.generationType as any as string[];
    const set = new Set(types);
    items = items.filter((it) => set.has((it as any).generationType));
  } else if (typeof params.generationType === 'string' && params.generationType.length > 0) {
    const want = String(params.generationType);
    items = items.filter((it) => String((it as any).generationType) === want);
  }

  if (typeof params.dateStart === 'string' && typeof params.dateEnd === 'string') {
    const startDate = new Date(params.dateStart);
    const endDate = new Date(params.dateEnd);
    items = items.filter((it) => {
      try {
        const created = new Date((it as any).createdAt || (it as any).updatedAt);
        return created >= startDate && created <= endDate;
      } catch {
        return true;
      }
    });
  }

  // Optional free-text search by prompt (multi-word; requires all tokens)
  if (params.search && String(params.search).trim().length > 0) {
    const tokens = String(params.search).trim().toLowerCase().split(/\s+/g).map(t => t.trim()).filter(Boolean).slice(0, 6);
    if (tokens.length > 0) {
      items = items.filter((it: any) => {
        const hay = String((it as any).prompt || '').toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
  }

  items = filterItemsByMode(items, params.mode).filtered;

  items.sort((a: any, b: any) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    const ax = typeof av === 'string' && /\d{4}-\d{2}-\d{2}T/.test(av) ? new Date(av).getTime() : av;
    const bx = typeof bv === 'string' && /\d{4}-\d{2}-\d{2}T/.test(bv) ? new Date(bv).getTime() : bv;
    const cmp = ax > bx ? 1 : ax < bx ? -1 : 0;
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  const page = items.slice(0, params.limit);
  const nextCursor = page.length === params.limit ? page[page.length - 1].id : undefined;

  return { items: page, nextCursor, totalCount };
}

export async function findByProviderTaskId(uid: string, provider: string, providerTaskId: string): Promise<{ id: string; item: GenerationHistoryItem } | null> {
  const col = adminDb.collection('generationHistory').doc(uid).collection('items');
  const snap = await col
    .where('provider', '==', provider)
    .where('providerTaskId', '==', providerTaskId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() as any;
  return { id: doc.id, item: normalizeItem(doc.id, data) };
}

export async function findBySoraVideoId(uid: string, soraVideoId: string): Promise<{ id: string; item: GenerationHistoryItem } | null> {
  const col = adminDb.collection('generationHistory').doc(uid).collection('items');
  const snap = await col
    .where('soraVideoId', '==', soraVideoId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() as any;
  return { id: doc.id, item: normalizeItem(doc.id, data) };
}

export const generationHistoryRepository = {
  create,
  update,
  get,
  list,
  findByProviderTaskId,
  findBySoraVideoId,
};


