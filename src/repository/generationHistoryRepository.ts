import { adminDb, admin } from '../config/firebaseAdmin';
import { GenerationHistoryItem, GenerationStatus, Visibility, GenerationType } from '../types/generate';
import { logger } from '../utils/logger';
import { invalidateUserLists, invalidateItem } from '../utils/generationCache';
import { mirrorQueueRepository } from './mirrorQueueRepository';

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

export async function create(uid: string, data: {
  prompt: string;
  userPrompt?: string;
  model: string;
  generationType: GenerationType | string;
  visibility?: Visibility | string;
  tags?: string[];
  nsfw?: boolean;
  frameSize?: string;
  aspect_ratio?: string;
  isPublic?: boolean;
  characterName?: string;
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
    try { logger.warn({ uid, err: e }, '[generationHistoryRepository.create] Failed to invalidate cache'); } catch {}
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
  
  // Remove undefined values before saving to Firestore
  const cleanedUpdates = removeUndefinedValues(updates);
  
  await ref.update({
    ...cleanedUpdates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  } as any);
  // Invalidate cache for the single item and user lists
  try {
    await invalidateItem(uid, historyId);
  } catch (e) {
    try { logger.warn({ uid, historyId, err: e }, '[generationHistoryRepository.update] Failed to invalidate cache'); } catch {}
  }

  // Enqueue mirror update asynchronously so public mirror reflects repository changes.
  // Do not block caller on mirror queue failures.
  // CRITICAL: Do NOT enqueue mirror updates if item is being deleted - deletion is handled separately
  try {
    const isBeingDeleted = (updates as any)?.isDeleted === true;
    if (isBeingDeleted) {
      // Item is being deleted - don't enqueue mirror update (deletion is handled by softDelete/update service)
      try { logger.info({ uid, historyId }, '[generationHistoryRepository.update] Skipping mirror update - item is being deleted'); } catch {}
      return;
    }
    
    // Only enqueue if there are meaningful updates (avoid noise). For simplicity,
    // enqueue when updates contains images, videos, isPublic, visibility, status, or error fields.
    const interesting = ['images', 'videos', 'isPublic', 'visibility', 'status', 'error'];
    const hasInteresting = Object.keys(updates || {}).some(k => interesting.includes(k));
    if (hasInteresting) {
      // Fire-and-forget
      mirrorQueueRepository.enqueueUpdate({ uid, historyId, updates });
    }
  } catch (e) {
    try { logger.warn({ uid, historyId, err: e }, '[generationHistoryRepository.update] Failed to enqueue mirror update'); } catch {}
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
  debug?: boolean; // when true include diagnostics
}): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string | number | null; hasMore?: boolean; totalCount?: number; diagnostics?: any }> {
  const col = adminDb.collection('generationHistory').doc(uid).collection('items');
  
  // Determine if we're using new optimized pagination or legacy mode
  // Allow explicit sortBy=createdAt without disabling optimized path. Optimized path triggers if:
  // - nextCursor provided OR
  // - (sortBy absent OR sortBy==='createdAt') and no legacy-only fields and no legacy cursor
  const useOptimizedPagination = params.nextCursor !== undefined || (
    (!params.cursor) && (!params.dateStart && !params.dateEnd) && (
      !params.sortBy || params.sortBy === 'createdAt'
    )
  );
  
  // NEW OPTIMIZED PATH: Use createdAt DESC with timestamp cursor
  if (useOptimizedPagination) {
    // IMPORTANT: Do NOT filter by isDeleted at query level.
    // Many older documents may not have the isDeleted field at all, and Firestore
    // equality filters exclude documents where the field is missing. That caused
    // pages to appear nearly empty when most docs lacked the field.
    // We now filter isDeleted in-memory after fetching, while keeping the query fully indexed.
    let q: FirebaseFirestore.Query = col.orderBy('createdAt', 'desc');
    
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
    const fetchLimit = Math.min(200, Math.max(params.limit * 3, params.limit + 10));
    
    let snap: FirebaseFirestore.QuerySnapshot;
    try {
      snap = await q.limit(fetchLimit).get();
    } catch (e: any) {
      // If composite index is missing, provide clear error message
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
        // Fall back to legacy mode
        return listLegacy(uid, params);
      }
      throw e;
    }
    
    if (snap.empty) {
      return { items: [], nextCursor: null, hasMore: false, diagnostics: params.debug ? { path: 'optimized', empty: true } : undefined };
    }

    // Normalize documents
    let items: GenerationHistoryItem[] = snap.docs.map(d => normalizeItem(d.id, d.data() as any));

    // Filter out soft-deleted items in-memory. Documents without the field are treated as NOT deleted.
    const beforeDeleteFilterCount = items.length;
    items = items.filter((it: any) => it.isDeleted !== true);

    // Optional free-text search by prompt (case-insensitive) - done in-memory for simplicity
    if (params.search && params.search.trim().length > 0) {
      const needle = params.search.toLowerCase();
      items = items.filter((it: any) => String((it as any).prompt || '').toLowerCase().includes(needle));
    }

    // Detect if there are more items AFTER in-memory filtering
    // Prefer optimistic hasMore when raw fetch hit the cap, to avoid early stop when
    // filtering trims results to exactly the page size.
    const rawCount = snap.docs.length;
    let hasMore = items.length > params.limit;
    if (!hasMore && rawCount >= fetchLimit) {
      hasMore = true;
    }
    const pageItems = items.slice(0, params.limit);

    // Next cursor strategy:
    // - Prefer the createdAt of the last page item when available
    // - If the page is empty but we still haveMore due to raw fetch hitting the cap,
    //   advance the cursor using the last RAW document's createdAt to prevent stalling.
    let nextCursor: number | null = null;
    if (hasMore) {
      try {
        let createdAtStr: string | undefined;
        if (pageItems.length > 0) {
          createdAtStr = (pageItems[pageItems.length - 1] as any)?.createdAt;
        } else {
          const lastRawDoc = snap.docs[snap.docs.length - 1];
          const rawCreated = (lastRawDoc?.data() as any)?.createdAt;
          if (rawCreated && typeof (rawCreated as any).toDate === 'function') {
            createdAtStr = (rawCreated as any).toDate().toISOString();
          } else if (typeof rawCreated === 'string') {
            createdAtStr = rawCreated;
          }
        }
        if (createdAtStr) {
          const ms = new Date(createdAtStr).getTime();
          if (!Number.isNaN(ms)) nextCursor = ms;
        }
      } catch (e) {
        console.warn('[list] Failed to compute nextCursor:', e);
      }
    }

    return { items: pageItems, nextCursor, hasMore, diagnostics: params.debug ? {
      path: 'optimized',
  requestedLimit: params.limit,
  fetchLimit,
  fetchedRaw: snap.docs.length,
      filteredAfterDelete: items.length,
      returned: pageItems.length,
      hasMore,
      appliedFilters: {
        status: params.status || null,
        generationType: params.generationType || null,
      },
      generationTypeSynonymsUsed: params.generationType ? (Array.isArray(params.generationType) ? params.generationType : [params.generationType]) : [],
    } : undefined };
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
  
  const fetchCount = params.status || params.generationType ? 
    Math.max(params.limit * 2, params.limit) : 
    Math.max(params.limit * 4, params.limit);
  
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

  // Optional free-text search by prompt
  if (params.search && params.search.trim().length > 0) {
    const needle = params.search.toLowerCase();
    items = items.filter((it: any) => String((it as any).prompt || '').toLowerCase().includes(needle));
  }

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


