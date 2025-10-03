import { adminDb } from '../config/firebaseAdmin';
import { GenerationHistoryItem } from '../types/generate';

function normalizePublicItem(id: string, data: any): GenerationHistoryItem {
  const { uid, prompt, model, generationType, status, visibility, tags, nsfw, images, videos, audios, createdBy, isPublic, createdAt, updatedAt, frameSize, style } = data;
  return {
    id, uid, prompt, model, generationType, status, visibility, tags, nsfw, images, videos, audios, createdBy, isPublic, createdAt, updatedAt: updatedAt || createdAt, frameSize, style
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
  
  // Only show public items
  q = q.where('isPublic', '==', true);
  
  // Only show completed generations (filter out generating/failed)
  q = q.where('status', '==', params.status || 'completed');
  
  // Apply filters
  if (params.generationType) {
    q = q.where('generationType', '==', params.generationType);
  }
  
  if (params.createdBy) {
    q = q.where('createdBy.uid', '==', params.createdBy);
  }
  
  // Handle cursor-based pagination (AFTER filters)
  if (params.cursor) {
    try {
      const cursorDoc = await col.doc(params.cursor).get();
      if (cursorDoc.exists) {
        q = q.startAfter(cursorDoc);
      }
    } catch (err) {
      console.error('Error fetching cursor document:', err);
      // Continue without cursor if there's an error
    }
  }
  
  // Fetch one more than limit to check if there are more items
  const fetchCount = params.limit + 1;
  
  let snap: FirebaseFirestore.QuerySnapshot;
  try {
    snap = await q.limit(fetchCount).get();
  } catch (e: any) {
    // If composite index is missing, fall back to simpler query
    console.error('Query failed, possibly missing composite index:', e);
    
    // Fallback: just query by isPublic and sort, then filter in memory
    q = col.where('isPublic', '==', true).orderBy(sortBy, sortOrder);
    
    if (params.cursor) {
      try {
        const cursorDoc = await col.doc(params.cursor).get();
        if (cursorDoc.exists) {
          q = q.startAfter(cursorDoc);
        }
      } catch {}
    }
    
    snap = await q.limit(fetchCount * 3).get(); // Fetch more since we'll filter in memory
  }
  
  let allItems: GenerationHistoryItem[] = snap.docs.map(d => normalizePublicItem(d.id, d.data() as any));
  
  // Filter in memory if needed
  allItems = allItems.filter(item => {
    if (item.status !== 'completed') return false;
    if (params.generationType && item.generationType !== params.generationType) return false;
    if (params.createdBy && item.createdBy?.uid !== params.createdBy) return false;
    return true;
  });
  
  // Check if there are more items
  const hasMore = allItems.length > params.limit;
  const items = hasMore ? allItems.slice(0, params.limit) : allItems;
  
  // Set nextCursor to the last item's ID if there are more items
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : undefined;
  
  // Get total count for pagination context (optional, can be expensive)
  let totalCount: number | undefined;
  
  console.log(`[publicGenerationsRepository] Returning ${items.length} public items, hasMore: ${hasMore}, nextCursor: ${nextCursor}`);
  
  return { items, nextCursor, totalCount };
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
