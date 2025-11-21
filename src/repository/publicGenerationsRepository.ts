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
  
  const HIGH_AESTHETIC_SCORE = 9.5; // Priority threshold for ArtStation
  
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
  
  // AESTHETIC SCORE PRIORITIZATION FOR ARTSTATION:
  // 1. First fetch items with aestheticScore >= 9.5 (sorted by createdAt desc - latest first)
  // 2. If not enough results, fetch items with aestheticScore < 9.5 (sorted by createdAt desc - latest first)
  // 3. Combine with high-scored items first, then lower scored items
  // 4. Also include text-to-music items without score requirement (only if not already filtered)
  
  // Query 1: High-scored items (>= 9.5)
  let queryHigh = baseQuery.where('aestheticScore', '>=', HIGH_AESTHETIC_SCORE);
  
  // Query 2: Lower-scored items (< 9.5) - only if we need to fill
  let queryLow: FirebaseFirestore.Query | null = null;
  
  // Query 3: Music items without score requirement (only if not already filtered)
  let queryMusic: FirebaseFirestore.Query | null = null;
  if (!params.generationType && (!params.mode || params.mode === 'all')) {
    queryMusic = baseQuery.where('generationType', '==', 'text-to-music');
  }
  
  // Apply sorting, projection, and pagination
  const applyQueryOptions = (q: FirebaseFirestore.Query) => {
    // Always sort by createdAt desc for latest first
    let query = q.select(...projectionFields as any).orderBy('createdAt', 'desc');
    if (params.cursor) {
      // Cursor will be applied after we get the cursor doc
    }
    return query;
  };
  
  queryHigh = applyQueryOptions(queryHigh);
  if (queryMusic) {
    queryMusic = applyQueryOptions(queryMusic);
  }
  
  // Handle cursor-based pagination
  // For cursor pagination, we continue from where we left off
  // The cursor represents the last item from the previous page
  if (params.cursor) {
    const cursorDoc = await col.doc(params.cursor).get();
    if (cursorDoc.exists) {
      queryHigh = queryHigh.startAfter(cursorDoc);
      if (queryMusic) {
        queryMusic = queryMusic.startAfter(cursorDoc);
      }
    }
  }
  
  // Execute high-scored query first - fetch more than needed to account for potential duplicates
  const snapHigh = await queryHigh.limit(params.limit * 2).get();
  
  // Convert high-scored results
  const highScoredItems: GenerationHistoryItem[] = snapHigh.docs
    .map(d => normalizePublicItem(d.id, d.data() as any))
    .sort((a, b) => {
      const aTime = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 
                   (a.createdAt as any)?.seconds ? (a.createdAt as any).seconds * 1000 : 0;
      const bTime = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 
                   (b.createdAt as any)?.seconds ? (b.createdAt as any).seconds * 1000 : 0;
      return bTime - aTime; // Latest first
    });
  
  // If we don't have enough high-scored items, fetch lower-scored items
  let lowScoredItems: GenerationHistoryItem[] = [];
  if (highScoredItems.length < params.limit) {
    const needed = params.limit - highScoredItems.length;
    
    // Build query for lower-scored items
    queryLow = baseQuery.where('aestheticScore', '<', HIGH_AESTHETIC_SCORE);
    queryLow = applyQueryOptions(queryLow);
    
    if (params.cursor) {
      const cursorDoc = await col.doc(params.cursor).get();
      if (cursorDoc.exists) {
        queryLow = queryLow.startAfter(cursorDoc);
      }
    }
    
    const snapLow = await queryLow.limit(needed * 2).get();
    lowScoredItems = snapLow.docs
      .map(d => normalizePublicItem(d.id, d.data() as any))
      .sort((a, b) => {
        const aTime = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 
                     (a.createdAt as any)?.seconds ? (a.createdAt as any).seconds * 1000 : 0;
        const bTime = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 
                     (b.createdAt as any)?.seconds ? (b.createdAt as any).seconds * 1000 : 0;
        return bTime - aTime; // Latest first
      });
  }
  
  // Fetch music items if needed
  let musicItems: GenerationHistoryItem[] = [];
  if (queryMusic && (highScoredItems.length + lowScoredItems.length) < params.limit) {
    const needed = params.limit - (highScoredItems.length + lowScoredItems.length);
    const snapMusic = await queryMusic.limit(needed).get();
    musicItems = snapMusic.docs
      .map(d => normalizePublicItem(d.id, d.data() as any))
      .sort((a, b) => {
        const aTime = typeof a.createdAt === 'string' ? new Date(a.createdAt).getTime() : 
                     (a.createdAt as any)?.seconds ? (a.createdAt as any).seconds * 1000 : 0;
        const bTime = typeof b.createdAt === 'string' ? new Date(b.createdAt).getTime() : 
                     (b.createdAt as any)?.seconds ? (b.createdAt as any).seconds * 1000 : 0;
        return bTime - aTime; // Latest first
      });
  }
  
  // Combine: high-scored first (sorted by latest), then lower-scored (sorted by latest), then music (sorted by latest)
  // Deduplicate by ID and maintain priority order
  const itemMap = new Map<string, GenerationHistoryItem>();
  const itemOrder: string[] = []; // Track order to maintain priority
  
  // Add high-scored items first (already sorted by latest first)
  highScoredItems.forEach(item => {
    if (!itemMap.has(item.id)) {
      itemMap.set(item.id, item);
      itemOrder.push(item.id);
    }
  });
  
  // Add lower-scored items (already sorted by latest first, avoid duplicates)
  lowScoredItems.forEach(item => {
    if (!itemMap.has(item.id)) {
      itemMap.set(item.id, item);
      itemOrder.push(item.id);
    }
  });
  
  // Add music items (already sorted by latest first, avoid duplicates)
  musicItems.forEach(item => {
    if (!itemMap.has(item.id)) {
      itemMap.set(item.id, item);
      itemOrder.push(item.id);
    }
  });
  
  // Convert to array maintaining priority order (high-scored first, then lower-scored, then music)
  // All groups are already sorted by createdAt desc (latest first)
  let items: GenerationHistoryItem[] = itemOrder
    .map(id => itemMap.get(id)!)
    .filter(item => item !== undefined);
  
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
 * Get multiple random high-scored images from the public feed
 * Returns up to 20 images with aestheticScore >= 9.5
 * 
 * IMPORTANT: 
 * - Every call returns DIFFERENT random images (shuffled)
 * - Only images with aestheticScore >= 9.5 are included
 * - Uses optimized avifUrl for faster loading
 */
export async function getRandomHighScoredImages(count: number = 20): Promise<Array<{ imageUrl: string; prompt?: string; generationId?: string; creator?: { username?: string; photoURL?: string } }>> {
  try {
    const col = adminDb.collection('generations');
    
    // Query for public items with aestheticScore >= 9.5
    // Note: Firestore doesn't support >= queries on aestheticScore directly if it's nested in images array
    // So we'll fetch items with document-level aestheticScore >= 9.5 OR check image-level scores
    // This ensures ONLY images with score >= 9.5 are returned
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
      
      if (candidates.length === 0) return [];
      
      // Shuffle candidates array for randomization - ensures different images each time
      // Using Math.random() - 0.5 provides true randomization
      const shuffled = candidates.sort(() => Math.random() - 0.5);
      
      // Take up to 'count' images
      const selected = shuffled.slice(0, Math.min(count, shuffled.length));
      
      // Map to result format with optimized URLs (avifUrl > thumbnailUrl > url)
      const results = selected
        .map(candidate => {
          const imageUrl = candidate.image?.avifUrl || candidate.image?.thumbnailUrl || candidate.image?.url;
          if (!imageUrl) return null;
          
          const creator = candidate.item.createdBy || null;
          
          return {
            imageUrl,
            prompt: candidate.item.prompt,
            generationId: candidate.item.id,
            creator: creator ? {
              username: creator.username,
              photoURL: creator.photoURL
            } : undefined
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
      
      return results;
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
    
    if (candidates.length === 0) return [];
    
    // Shuffle candidates array for randomization
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    
    // Take up to 'count' images
    const selected = shuffled.slice(0, Math.min(count, shuffled.length));
    
    // Map to result format with optimized URLs (avifUrl > thumbnailUrl > url)
    const results = selected
      .map(candidate => {
        const imageUrl = candidate.image?.avifUrl || candidate.image?.thumbnailUrl || candidate.image?.url;
        if (!imageUrl) return null;
        
        const creator = candidate.item.createdBy || null;
        
        return {
          imageUrl,
          prompt: candidate.item.prompt,
          generationId: candidate.item.id,
          creator: creator ? {
            username: creator.username,
            photoURL: creator.photoURL
          } : undefined
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    
    return results;
  } catch (error) {
    console.error('[publicGenerationsRepository] Error getting random high-scored images:', error);
    return [];
  }
}

export const publicGenerationsRepository = {
  listPublic,
  getPublicById,
  getRandomHighScoredImages,
};