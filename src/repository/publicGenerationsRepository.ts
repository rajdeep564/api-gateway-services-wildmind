import { adminDb, admin } from '../config/firebaseAdmin';
import { GenerationHistoryItem } from '../types/generate';

function normalizePublicItem(id: string, data: any): GenerationHistoryItem {
  const { uid, prompt, model, generationType, status, visibility, tags, nsfw, images, videos, audios, createdBy, isPublic, createdAt, updatedAt, isDeleted, aspectRatio, frameSize, aspect_ratio } = data;
  return {
    id,
    uid,
    prompt,
    model,
    generationType,
    status,
    visibility,
    tags,
    nsfw,
    images,
    videos,
    audios,
    createdBy,
    isPublic,
    isDeleted,
    createdAt,
    updatedAt: updatedAt || createdAt,
    aspectRatio: aspectRatio || frameSize || aspect_ratio,
    frameSize: frameSize || aspect_ratio || aspectRatio
  } as GenerationHistoryItem;
}

export async function listPublic(params: {
  limit: number;
  cursor?: string;
  generationType?: string | string[];
  status?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'prompt';
  sortOrder?: 'asc' | 'desc';
  createdBy?: string; // uid of creator
  dateStart?: string;
  dateEnd?: string;
  mode?: 'video' | 'image' | 'music' | 'all';
  search?: string; // free-text prompt search
}): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string; totalCount?: number }> {
  const col = adminDb.collection('generations');
  
  // Default sorting
  const sortBy = params.sortBy || 'createdAt';
  const sortOrder = params.sortOrder || 'desc';
  
  // Projection: fetch only the fields needed for the feed to reduce payload size
  const projectionFields: Array<keyof GenerationHistoryItem | string> = [
    'prompt', 'model', 'generationType', 'status', 'visibility', 'tags', 'nsfw',
    'images', 'videos', 'audios', 'createdBy', 'isPublic', 'isDeleted', 'createdAt', 'updatedAt',
    'aspectRatio', 'frameSize', 'aspect_ratio'
  ];
  let q: FirebaseFirestore.Query = col.select(...projectionFields as any).orderBy(sortBy, sortOrder);
  
  // Only show public; we will exclude deleted after fetch so old docs without the flag still appear
  q = q.where('isPublic', '==', true);
  
  // Apply filters
  // Try server-side filtering for generationType if possible (<=10 values for 'in')
  let clientFilterTypes: string[] | undefined;
  if (params.generationType) {
    if (Array.isArray(params.generationType)) {
      const arr = (params.generationType as string[]).map(s => String(s));
      if (arr.length > 0 && arr.length <= 10) {
        try {
          q = q.where('generationType', 'in', arr);
          clientFilterTypes = undefined;
        } catch {
          // fall back to client-side
          clientFilterTypes = arr;
        }
      } else {
        clientFilterTypes = arr;
      }
    } else {
      // Single value can be server-side filtered
      try {
        q = q.where('generationType', '==', String(params.generationType));
        clientFilterTypes = undefined;
      } catch {
        clientFilterTypes = [String(params.generationType)];
      }
    }
  }
  
  if (params.status) {
    q = q.where('status', '==', params.status);
  }
  
  if (params.createdBy) {
    q = q.where('createdBy.uid', '==', params.createdBy);
  }
  // Optional date filtering based on createdAt timestamp
  let filterByDateInMemory = false;
  if (params.dateStart && params.dateEnd) {
    try {
      const start = new Date(params.dateStart);
      const end = new Date(params.dateEnd);
      // Try server-side range filter; requires composite index for where + orderBy
      q = q.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start))
           .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(end));
    } catch {
      filterByDateInMemory = true;
    }
  }
  
  // Handle cursor-based pagination (AFTER filters)
  if (params.cursor) {
    const cursorDoc = await col.doc(params.cursor).get();
    if (cursorDoc.exists) {
      q = q.startAfter(cursorDoc);
    }
  }
  
  // Skip total count to reduce query cost/latency; Firestore count queries require aggregation indexes
  let totalCount: number | undefined = undefined;
  
  // If we need to filter in-memory (generationType arrays OR mode !== 'all'), fetch a larger page to increase chances of filling the page
  // When searching, fetch a very large batch to find all matching results
  const needsInMemoryFilter = Boolean(clientFilterTypes) || (params.mode && params.mode !== 'all') || Boolean(params.search);
  let fetchMultiplier: number;
  let maxFetchLimit: number;
  
  if (params.search && params.search.trim().length > 0) {
    // When searching, fetch a reasonable batch to find matches (same multiplier as normal browsing)
    // Don't overfetch too much to prevent loading everything at once
    fetchMultiplier = 3; // Fetch 3x the limit (60 items) when searching - same as clientFilterTypes
    maxFetchLimit = 150; // Same max limit as normal browsing
  } else {
    fetchMultiplier = clientFilterTypes ? 3 : 2;
    maxFetchLimit = 150;
  }
  
  const fetchLimit = needsInMemoryFilter ? Math.min(Math.max(params.limit * fetchMultiplier, params.limit), maxFetchLimit) : params.limit;
  const snap = await q.limit(fetchLimit).get();
  
  let items: GenerationHistoryItem[] = snap.docs.map(d => normalizePublicItem(d.id, d.data() as any));
  try {
    // Lightweight visibility log for optimized fields presence across page
    const imgCounts = items.map((it: any) => Array.isArray(it?.images) ? it.images.length : 0);
    const optCounts = items.map((it: any) => Array.isArray(it?.images) ? it.images.filter((im: any) => im?.thumbnailUrl || im?.avifUrl).length : 0);
    const totalImgs = imgCounts.reduce((a, b) => a + b, 0);
    const totalOpt = optCounts.reduce((a, b) => a + b, 0);
    if (items.length > 0) {
      console.log('[Feed][Repo][listPublic] page stats', {
        returnedItems: items.length,
        totalImages: totalImgs,
        imagesWithOptimized: totalOpt,
      });

      // Log per-item sample for debugging: first image's optimized fields (limit 10)
      try {
        const samples = items.slice(0, 10).map((it: any) => {
          const first = Array.isArray(it.images) && it.images.length > 0 ? it.images[0] : null;
          return {
            id: it.id,
            isPublic: it.isPublic,
            imagesCount: Array.isArray(it.images) ? it.images.length : 0,
            firstHasThumbnail: !!(first && first.thumbnailUrl),
            firstHasAvif: !!(first && first.avifUrl),
            firstThumbnail: first && typeof first.thumbnailUrl === 'string' ? first.thumbnailUrl : undefined,
            firstAvif: first && typeof first.avifUrl === 'string' ? first.avifUrl : undefined,
          };
        });
        console.log('[Feed][Repo][listPublic] item samples', samples);
      } catch (e) {
        // ignore
      }
    }
  } catch {}
  if (clientFilterTypes) {
    items = items.filter((it: any) => clientFilterTypes!.includes(String(it.generationType || '').toLowerCase()));
  }
  // Optional mode-based filtering by media presence (more robust than generationType)
  if (params.mode && params.mode !== 'all') {
    if (params.mode === 'video') {
      items = items.filter((it: any) => Array.isArray((it as any).videos) && (it as any).videos.length > 0);
    } else if (params.mode === 'image') {
      items = items.filter((it: any) => Array.isArray((it as any).images) && (it as any).images.length > 0);
    } else if (params.mode === 'music') {
      items = items.filter((it: any) => Array.isArray((it as any).audios) && (it as any).audios.length > 0 || String(it.generationType || '').toLowerCase() === 'text-to-music');
    }
  }
  // Optional in-memory date filter fallback
  if (filterByDateInMemory && params.dateStart && params.dateEnd) {
    const startMs = new Date(params.dateStart).getTime();
    const endMs = new Date(params.dateEnd).getTime();
    items = items.filter((it: any) => {
      const ts = (it.createdAt && (it.createdAt.seconds ? it.createdAt.seconds * 1000 : Date.parse(it.createdAt))) || 0;
      return ts >= startMs && ts <= endMs;
    });
  }
  
  // Optional free-text prompt search (case-insensitive substring)
  if (params.search && params.search.trim().length > 0) {
    const needle = params.search.toLowerCase();
    items = items.filter((it: any) => {
      const p = String((it as any).prompt || '').toLowerCase();
      return p.includes(needle);
    });
    // No in-memory sorting - keep original Firestore order (createdAt DESC)
  }
  
  // Exclude soft-deleted; treat missing as not deleted for old docs
  items = items.filter((it: any) => it.isDeleted !== true);
  
  // Return items up to limit (works for both search and normal browsing)
  const page = items.slice(0, params.limit);
  
  // Compute next cursor for pagination
  // Enable pagination for both search and normal browsing
  let nextCursor: string | undefined;
  if (page.length === params.limit) {
    // Full page returned - use last item's ID
    nextCursor = page[page.length - 1].id;
  } else if (snap.docs.length === fetchLimit) {
    // We fetched max items from Firestore but filtered results are fewer
    // Use last Firestore doc ID to continue from database position
    // This ensures we don't skip items when continuing pagination
    nextCursor = snap.docs[snap.docs.length - 1].id;
  } else if (page.length > 0 && snap.docs.length > 0) {
    // We have some filtered results but didn't hit fetch limit
    // Still use last Firestore doc to continue properly
    nextCursor = snap.docs[snap.docs.length - 1].id;
  } else {
    // No more items available
    nextCursor = undefined;
  }
  
  return { items: page, nextCursor, totalCount };
}

export async function getPublicById(generationId: string): Promise<GenerationHistoryItem | null> {
  const ref = adminDb.collection('generations').doc(generationId);
  const snap = await ref.get();
  
  if (!snap.exists) return null;
  
  const data = snap.data() as any;
  if (data.isPublic !== true) return null; // Only return if public
  
  return normalizePublicItem(snap.id, data);
}

export const publicGenerationsRepository = {
  listPublic,
  getPublicById,
};