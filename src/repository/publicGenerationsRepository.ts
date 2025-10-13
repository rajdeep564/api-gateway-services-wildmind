import { adminDb } from '../config/firebaseAdmin';
import { GenerationHistoryItem } from '../types/generate';

function normalizePublicItem(id: string, data: any): GenerationHistoryItem {
  const { uid, prompt, model, generationType, status, visibility, tags, nsfw, images, videos, createdBy, isPublic, createdAt, updatedAt, isDeleted, aspectRatio, frameSize, aspect_ratio } = data;
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
  generationType?: string;
  status?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'prompt';
  sortOrder?: 'asc' | 'desc';
  createdBy?: string; // uid of creator
}): Promise<{ items: GenerationHistoryItem[]; nextCursor?: string; totalCount?: number }> {
  const col = adminDb.collection('generations');
  
  // Default sorting
  const sortBy = params.sortBy || 'createdAt';
  const sortOrder = params.sortOrder || 'desc';
  
  let q: FirebaseFirestore.Query = col.orderBy(sortBy, sortOrder);
  
  // Only show public; we will exclude deleted after fetch so old docs without the flag still appear
  q = q.where('isPublic', '==', true);
  
  // Apply filters
  if (params.generationType) {
    q = q.where('generationType', '==', params.generationType);
  }
  
  if (params.status) {
    q = q.where('status', '==', params.status);
  }
  
  if (params.createdBy) {
    q = q.where('createdBy.uid', '==', params.createdBy);
  }
  
  // Handle cursor-based pagination (AFTER filters)
  if (params.cursor) {
    const cursorDoc = await col.doc(params.cursor).get();
    if (cursorDoc.exists) {
      q = q.startAfter(cursorDoc);
    }
  }
  
  // Get total count for pagination context
  let totalCount: number | undefined;
  if (params.generationType || params.status || params.createdBy) {
    const countQuery = await col.where('isPublic', '==', true).get();
    totalCount = countQuery.docs.length;
  }
  
  const fetchCount = Math.max(params.limit * 2, params.limit);
  const snap = await q.limit(fetchCount).get();
  
  let items: GenerationHistoryItem[] = snap.docs.map(d => normalizePublicItem(d.id, d.data() as any));
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