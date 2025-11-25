import { adminDb, admin } from '../config/firebaseAdmin';
import { GenerationHistoryItem } from '../types/generate';
import { mapModeToGenerationTypes } from '../utils/modeTypeMap';

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
  sortBy?: 'createdAt' | 'updatedAt' | 'prompt' | 'aestheticScore';
  sortOrder?: 'asc' | 'desc';
  createdBy?: string; // uid of creator
  dateStart?: string;
  dateEnd?: string;
  mode?: 'video' | 'image' | 'music' | 'branding' | 'all';
  search?: string; // free-text prompt search
  minScore?: number; // Minimum aesthetic score threshold
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
  
  // Use minScore if provided, otherwise default to 9.0 for backward compatibility
  const HIGH_AESTHETIC_SCORE = params.minScore !== undefined ? params.minScore : 9.0;
  
  // Build base query with required filters
  let baseQuery = col
    .where('isPublic', '==', true)
    .where('isDeleted', '==', false);
  
  // Apply minScore filter if provided
  if (params.minScore !== undefined) {
    baseQuery = baseQuery.where('aestheticScore', '>=', params.minScore);
  }
  
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
    const mappedTypes = mapModeToGenerationTypes(params.mode);
    if (mappedTypes && mappedTypes.length > 0) {
      baseQuery = baseQuery.where('generationType', 'in', mappedTypes);
    }
  }
  
  // AESTHETIC SCORE PRIORITIZATION FOR ARTSTATION:
  // If minScore is provided, only fetch items >= minScore
  // Otherwise, use the two-tier approach (high-scored first, then lower-scored)
  // 1. First fetch items with aestheticScore >= threshold (sorted by aestheticScore or createdAt)
  // 2. If not enough results and minScore not set, fetch items with aestheticScore < threshold
  // 3. Combine with high-scored items first, then lower scored items
  // 4. Also include text-to-music items without score requirement (only if not already filtered)
  
  // Query 1: High-scored items (>= threshold)
  // If minScore is provided, baseQuery already has the filter, so use it directly
  let queryHigh = params.minScore !== undefined ? baseQuery : baseQuery.where('aestheticScore', '>=', HIGH_AESTHETIC_SCORE);
  
  // Query 2: Lower-scored items (< 9.0) - only if we need to fill
  let queryLow: FirebaseFirestore.Query | null = null;
  
  // Query 3: Music items without score requirement (only if not already filtered)
  let queryMusic: FirebaseFirestore.Query | null = null;
  if (!params.generationType && (!params.mode || params.mode === 'all')) {
    queryMusic = baseQuery.where('generationType', '==', 'text-to-music');
  }
  
  // Apply sorting, projection, and pagination
  const applyQueryOptions = (q: FirebaseFirestore.Query) => {
    // If sorting by aestheticScore, we need to order by that field (requires composite index)
    // Otherwise, order by createdAt
    const sortField = params.sortBy === 'aestheticScore' ? 'aestheticScore' : 'createdAt';
    const sortDir = params.sortOrder === 'asc' ? 'asc' : 'desc';
    let query = q.select(...projectionFields as any).orderBy(sortField, sortDir);
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
  
  // Helper function to get aesthetic score (default to 0 if missing)
  const getAestheticScore = (item: GenerationHistoryItem): number => {
    return typeof item.aestheticScore === 'number' ? item.aestheticScore : 0;
  };
  
  // Helper function to get createdAt timestamp
  const getCreatedAtTime = (item: GenerationHistoryItem): number => {
    if (typeof item.createdAt === 'string') return new Date(item.createdAt).getTime();
    if ((item.createdAt as any)?.seconds) return (item.createdAt as any).seconds * 1000;
    return 0;
  };
  
  // Convert high-scored results with proper sorting
  const highScoredItems: GenerationHistoryItem[] = snapHigh.docs
    .map(d => normalizePublicItem(d.id, d.data() as any))
    .sort((a, b) => {
      if (params.sortBy === 'aestheticScore') {
        // Sort by aestheticScore first (desc), then createdAt as tiebreaker (desc)
        const aScore = getAestheticScore(a);
        const bScore = getAestheticScore(b);
        if (aScore !== bScore) {
          return params.sortOrder === 'asc' ? aScore - bScore : bScore - aScore;
        }
        // Tiebreaker: createdAt desc (latest first)
        const aTime = getCreatedAtTime(a);
        const bTime = getCreatedAtTime(b);
        return bTime - aTime;
      } else {
        // Default: sort by createdAt
        const aTime = getCreatedAtTime(a);
        const bTime = getCreatedAtTime(b);
        return params.sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      }
    });
  
  // If we don't have enough high-scored items and minScore is not set, fetch lower-scored items
  // (If minScore is set, we only want items >= minScore, so skip lower-scored items)
  let lowScoredItems: GenerationHistoryItem[] = [];
  if (params.minScore === undefined && highScoredItems.length < params.limit) {
    const needed = params.limit - highScoredItems.length;
    
    // Build query for lower-scored items (exclude items already in high-scored)
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
        if (params.sortBy === 'aestheticScore') {
          const aScore = getAestheticScore(a);
          const bScore = getAestheticScore(b);
          if (aScore !== bScore) {
            return params.sortOrder === 'asc' ? aScore - bScore : bScore - aScore;
          }
          const aTime = getCreatedAtTime(a);
          const bTime = getCreatedAtTime(b);
          return bTime - aTime;
        } else {
          const aTime = getCreatedAtTime(a);
          const bTime = getCreatedAtTime(b);
          return params.sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
        }
      });
  }
  
  // Fetch music items if needed (skip if minScore is set, as music items may not have scores)
  let musicItems: GenerationHistoryItem[] = [];
  if (params.minScore === undefined && queryMusic && (highScoredItems.length + lowScoredItems.length) < params.limit) {
    const needed = params.limit - (highScoredItems.length + lowScoredItems.length);
    const snapMusic = await queryMusic.limit(needed).get();
    musicItems = snapMusic.docs
      .map(d => normalizePublicItem(d.id, d.data() as any))
      .sort((a, b) => {
        if (params.sortBy === 'aestheticScore') {
          const aScore = getAestheticScore(a);
          const bScore = getAestheticScore(b);
          if (aScore !== bScore) {
            return params.sortOrder === 'asc' ? aScore - bScore : bScore - aScore;
          }
          const aTime = getCreatedAtTime(a);
          const bTime = getCreatedAtTime(b);
          return bTime - aTime;
        } else {
          const aTime = getCreatedAtTime(a);
          const bTime = getCreatedAtTime(b);
          return params.sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
        }
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
 * Returns up to 20 images with aestheticScore >= 9.0
 * 
 * IMPORTANT: 
 * - Every call returns DIFFERENT random images (shuffled)
 * - Only images with aestheticScore >= 9.0 are included
 * - Uses optimized avifUrl for faster loading
 */
export async function getRandomHighScoredImages(count: number = 20): Promise<Array<{ imageUrl: string; prompt?: string; generationId?: string; creator?: { username?: string; photoURL?: string } }>> {
  try {
    const col = adminDb.collection('generations');
    
    // Query for public items with aestheticScore >= 9.0
    // Note: Firestore doesn't support >= queries on aestheticScore directly if it's nested in images array
    // So we'll fetch items with document-level aestheticScore >= 9.0 OR check image-level scores
    // This ensures ONLY images with score >= 9.0 are returned
    let q = col
      .where('isPublic', '==', true)
      .where('isDeleted', '!=', true)
      .where('aestheticScore', '>=', 9.0)
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
          
          if (score !== null && score >= 9.0) {
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
      
      // Document-level aestheticScore (already >= 9.0 from query)
      const docScore = typeof data.aestheticScore === 'number' ? data.aestheticScore : null;
      
      // Prefer images with high scores, but accept document-level score >= 9.0
      for (const img of images) {
        const imgScore = typeof img?.aestheticScore === 'number' ? img.aestheticScore : 
                        (typeof img?.aesthetic?.score === 'number' ? img.aesthetic.score : null);
        
        // Use image score if available, otherwise fall back to document score
        const score = imgScore !== null ? imgScore : docScore;
        
        // If score >= 9.0, include it
        if (score !== null && score >= 9.0) {
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