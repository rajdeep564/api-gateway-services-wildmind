import { adminDb, admin } from '../config/firebaseAdmin';
import { GenerationHistoryItem } from '../types/generate';

function normalizePublicItem(id: string, data: any): GenerationHistoryItem {
  const { uid, prompt, model, generationType, status, visibility, tags, nsfw, images, videos, audios, createdBy, isPublic, createdAt, updatedAt, isDeleted, aspectRatio, frameSize, aspect_ratio } = data;
  
  // Ensure isPublic is explicitly boolean true (not undefined, null, or false)
  // If isPublic is not explicitly true, set it to false to ensure proper filtering
  const normalizedIsPublic = isPublic === true;
  
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
    isPublic: normalizedIsPublic, // Explicitly set to true or false
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
    'aspectRatio', 'frameSize', 'aspect_ratio', 'aestheticScore'
  ];
  
  // ========== DATABASE-LEVEL FILTERING FOR OPTIMAL PERFORMANCE ==========
  // All filtering is done at database level - NO in-memory filtering
  
  const MIN_AESTHETIC_SCORE = 8.5;
  
  // Build base query with required filters
  let baseQuery = col
    .where('isPublic', '==', true)
    .where('isDeleted', '==', false);
  
  // Apply generationType filter if provided
  if (params.generationType) {
    if (Array.isArray(params.generationType)) {
      const arr = (params.generationType as string[]).map(s => String(s));
      if (arr.length > 0 && arr.length <= 10) {
        baseQuery = baseQuery.where('generationType', 'in', arr);
      }
    } else {
      baseQuery = baseQuery.where('generationType', '==', String(params.generationType));
    }
  }
  
  if (params.status) {
    baseQuery = baseQuery.where('status', '==', params.status);
  }
  
  if (params.createdBy) {
    baseQuery = baseQuery.where('createdBy.uid', '==', params.createdBy);
  }
  
  // Date filtering at database level
  if (params.dateStart && params.dateEnd) {
    const start = new Date(params.dateStart);
    const end = new Date(params.dateEnd);
    baseQuery = baseQuery
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start))
      .where('createdAt', '<=', admin.firestore.Timestamp.fromDate(end));
  }
  
  // Handle mode-based filtering at database level
  if (params.mode && params.mode !== 'all') {
    if (params.mode === 'video') {
      baseQuery = baseQuery.where('generationType', 'in', ['text-to-video', 'image-to-video', 'video-to-video']);
    } else if (params.mode === 'image') {
      baseQuery = baseQuery.where('generationType', 'in', ['text-to-image', 'logo', 'sticker-generation', 'product-generation', 'ad-generation']);
    } else if (params.mode === 'music') {
      baseQuery = baseQuery.where('generationType', '==', 'text-to-music');
    }
  }
  
  // AESTHETIC SCORE FILTERING: Use two queries and merge for optimal performance
  // Query 1: Items with aestheticScore >= 8.5 (images/videos with scores, and music with scores)
  // Query 2: Music items (text-to-music) without score requirement (only if not already filtered by mode)
  let query1 = baseQuery.where('aestheticScore', '>=', MIN_AESTHETIC_SCORE);
  let query2: FirebaseFirestore.Query | null = null;
  
  // Only add music query if we're not already filtering by generationType or mode
  if (!params.generationType && (!params.mode || params.mode === 'all')) {
    query2 = baseQuery.where('generationType', '==', 'text-to-music');
  }
  
  // Apply sorting, projection, and pagination
  const applyQueryOptions = (q: FirebaseFirestore.Query) => {
    let query = q.select(...projectionFields as any).orderBy(sortBy, sortOrder);
    if (params.cursor) {
      // Cursor will be applied after we get the cursor doc
    }
    return query;
  };
  
  query1 = applyQueryOptions(query1);
  if (query2) {
    query2 = applyQueryOptions(query2);
  }
  
  // Handle cursor-based pagination
  if (params.cursor) {
    const cursorDoc = await col.doc(params.cursor).get();
    if (cursorDoc.exists) {
      query1 = query1.startAfter(cursorDoc);
      if (query2) {
        query2 = query2.startAfter(cursorDoc);
      }
    }
  }
  
  // Execute queries in parallel - fetch 2x limit to account for deduplication
  const [snap1, snap2] = await Promise.all([
    query1.limit(params.limit * 2).get(),
    query2 ? query2.limit(params.limit).get() : Promise.resolve({ docs: [] } as any as FirebaseFirestore.QuerySnapshot),
  ]);
  
  // Merge and deduplicate results
  const docMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  snap1.docs.forEach(doc => docMap.set(doc.id, doc));
  if (query2) {
    snap2.docs.forEach(doc => {
      if (!docMap.has(doc.id)) {
        docMap.set(doc.id, doc);
      }
    });
  }
  
  // Convert to items and sort by createdAt desc (maintain order)
  let items: GenerationHistoryItem[] = Array.from(docMap.values())
    .map(d => normalizePublicItem(d.id, d.data() as any))
    .sort((a, b) => {
      const aTime = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 
                   (a.createdAt as any)?.seconds ? (a.createdAt as any).seconds * 1000 : 0;
      const bTime = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 
                   (b.createdAt as any)?.seconds ? (b.createdAt as any).seconds * 1000 : 0;
      return sortOrder === 'desc' ? bTime - aTime : aTime - bTime;
    });
  
  // Handle search - Firestore doesn't support full-text search, so minimal in-memory filter
  // This is the ONLY in-memory filtering we do, and it's necessary for search functionality
  if (params.search && params.search.trim().length > 0) {
    const needle = params.search.toLowerCase();
    items = items.filter((it: any) => {
      const p = String((it as any).prompt || '').toLowerCase();
      return p.includes(needle);
    });
  }
  
  // Return items up to limit
  const page = items.slice(0, params.limit);
  
  // Compute next cursor for pagination
  let nextCursor: string | undefined;
  if (page.length === params.limit && items.length > params.limit) {
    // Full page returned - use last item's ID
    nextCursor = page[page.length - 1].id;
  } else if (page.length > 0) {
    // Use last item's ID if we have results
    nextCursor = page[page.length - 1].id;
  }
  
  // Skip total count to reduce query cost/latency
  const totalCount: number | undefined = undefined;
  
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

/**
 * Get a random high-scored image from the public feed
 * Returns an image with aestheticScore >= 9.5
 */
export async function getRandomHighScoredImage(): Promise<{ imageUrl: string; prompt?: string; generationId?: string; creator?: { username?: string; photoURL?: string } } | null> {
  try {
    const col = adminDb.collection('generations');
    
    // Query for public items with aestheticScore >= 9.5
    // Note: Firestore doesn't support >= queries on aestheticScore directly if it's nested in images array
    // So we'll fetch items with document-level aestheticScore >= 9.5 OR check image-level scores
    let q = col
      .where('isPublic', '==', true)
      .where('isDeleted', '!=', true)
      .where('aestheticScore', '>=', 9.5)
      .limit(100); // Fetch up to 100 candidates for randomization
    
    const snap = await q.get();
    
    if (snap.empty) {
      // Fallback: fetch public items and filter in memory
      const fallbackQ = col
        .where('isPublic', '==', true)
        .limit(500);
      const fallbackSnap = await fallbackQ.get();
      
      const candidates: Array<{ item: GenerationHistoryItem; image: any }> = [];
      
      fallbackSnap.docs.forEach(doc => {
        const data = doc.data() as any;
        if (data.isDeleted === true) return;
        
        const images = Array.isArray(data.images) ? data.images : [];
        if (images.length === 0) return;
        
        // Check document-level aestheticScore
        const docScore = typeof data.aestheticScore === 'number' ? data.aestheticScore : null;
        
        // Check image-level aestheticScore
        for (const img of images) {
          const imgScore = typeof img?.aestheticScore === 'number' ? img.aestheticScore : 
                          (typeof img?.aesthetic?.score === 'number' ? img.aesthetic.score : null);
          const score = imgScore || docScore;
          
          if (score !== null && score >= 9.5) {
            candidates.push({
              item: normalizePublicItem(doc.id, data),
              image: img
            });
            break; // Only take first matching image per generation
          }
        }
      });
      
      if (candidates.length === 0) return null;
      
      // Randomly select one
      const random = candidates[Math.floor(Math.random() * candidates.length)];
      const imageUrl = random.image?.avifUrl || random.image?.thumbnailUrl || random.image?.url;
      
      if (!imageUrl) return null;
      
      // Get creator info
      const creator = random.item.createdBy || null;
      
      return {
        imageUrl,
        prompt: random.item.prompt,
        generationId: random.item.id,
        creator: creator ? {
          username: creator.username,
          photoURL: creator.photoURL
        } : undefined
      };
    }
    
    // Filter items that have images and extract image URLs
    const candidates: Array<{ item: GenerationHistoryItem; image: any }> = [];
    
    snap.docs.forEach(doc => {
      const data = doc.data() as any;
      if (data.isDeleted === true) return;
      
      const images = Array.isArray(data.images) ? data.images : [];
      if (images.length === 0) return;
      
      // Document-level aestheticScore (already >= 9.5 from query)
      const docScore = typeof data.aestheticScore === 'number' ? data.aestheticScore : null;
      
      // Prefer images with high scores, but accept document-level score >= 9.5
      for (const img of images) {
        const imgScore = typeof img?.aestheticScore === 'number' ? img.aestheticScore : 
                        (typeof img?.aesthetic?.score === 'number' ? img.aesthetic.score : null);
        
        // Use image score if available, otherwise fall back to document score
        const score = imgScore !== null ? imgScore : docScore;
        
        // If score >= 9.5, include it
        if (score !== null && score >= 9.5) {
          candidates.push({
            item: normalizePublicItem(doc.id, data),
            image: img
          });
          break; // Only take first matching image per generation
        }
      }
    });
    
    if (candidates.length === 0) return null;
    
    // Randomly select one
    const random = candidates[Math.floor(Math.random() * candidates.length)];
    
    // Prefer optimized URLs (avifUrl > thumbnailUrl > url)
    const imageUrl = random.image?.avifUrl || random.image?.thumbnailUrl || random.image?.url;
    
    if (!imageUrl) return null;
    
    // Get creator info
    const creator = random.item.createdBy || null;
    
    return {
      imageUrl,
      prompt: random.item.prompt,
      generationId: random.item.id,
      creator: creator ? {
        username: creator.username,
        photoURL: creator.photoURL
      } : undefined
    };
  } catch (error) {
    console.error('[publicGenerationsRepository] Error getting random high-scored image:', error);
    return null;
  }
}

export const publicGenerationsRepository = {
  listPublic,
  getPublicById,
  getRandomHighScoredImage,
};