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
}): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string; totalCount?: number }> {
  const col = adminDb.collection('generations');
  
  // Default sorting
  const sortBy = params.sortBy || 'createdAt';
  const sortOrder = params.sortOrder || 'desc';
  
  let q: FirebaseFirestore.Query = col.orderBy(sortBy, sortOrder);
  
  // Only show public; we will exclude deleted after fetch so old docs without the flag still appear
  q = q.where('isPublic', '==', true);
  
  // Apply filters
  // Prefer client-side filtering for generationType arrays to avoid Firestore 'in' index requirements
  let clientFilterTypes: string[] | undefined;
  if (params.generationType) {
    if (Array.isArray(params.generationType)) {
      clientFilterTypes = params.generationType as string[];
    } else {
      clientFilterTypes = [String(params.generationType)];
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
  
  // If we need to filter types client-side, fetch a larger page to fill results
  const fetchLimit = clientFilterTypes ? Math.min(Math.max(params.limit * 5, params.limit), 200) : params.limit;
  const snap = await q.limit(fetchLimit).get();
  
  let items: GenerationHistoryItem[] = snap.docs.map(d => normalizePublicItem(d.id, d.data() as any));
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
  // Exclude soft-deleted; treat missing as not deleted for old docs
  items = items.filter((it: any) => it.isDeleted !== true);
  const page = items.slice(0, params.limit);
  const nextCursor = page.length === params.limit ? page[page.length - 1].id : undefined;
  
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