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
    'aspectRatio', 'frameSize', 'aspect_ratio', 'aestheticScore', 'scoreUpdatedAt'
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
  const getAestheticScore = (item: GenerationHistoryItem, rawData?: any): number => {
    return typeof item.aestheticScore === 'number' ? item.aestheticScore : 0;
  };
  
  // Helper function to get createdAt timestamp
  const getCreatedAtTime = (item: GenerationHistoryItem): number => {
    if (typeof item.createdAt === 'string') return new Date(item.createdAt).getTime();
    if ((item.createdAt as any)?.seconds) return (item.createdAt as any).seconds * 1000;
    return 0;
  };

  // Helper function to get scoreUpdatedAt timestamp (admin score update time)
  const getScoreUpdatedAtTime = (rawData: any): number => {
    if (!rawData) return 0;
    const scoreUpdatedAt = rawData.scoreUpdatedAt;
    if (!scoreUpdatedAt) return 0;
    
    // Handle Firestore Timestamp
    if (scoreUpdatedAt.seconds !== undefined) {
      return scoreUpdatedAt.seconds * 1000 + (scoreUpdatedAt.nanoseconds || 0) / 1000000;
    }
    if (typeof scoreUpdatedAt.toMillis === 'function') {
      return scoreUpdatedAt.toMillis();
    }
    
    // Handle string date
    if (typeof scoreUpdatedAt === 'string') {
      const parsed = new Date(scoreUpdatedAt).getTime();
      return isNaN(parsed) ? 0 : parsed;
    }
    
    // Handle number (milliseconds)
    if (typeof scoreUpdatedAt === 'number') {
      return scoreUpdatedAt;
    }
    
    return 0;
  };

  // Helper function to check if item has admin score (has scoreUpdatedAt)
  // Note: When using .select() projection, missing fields are undefined, not null
  const hasAdminScore = (rawData: any): boolean => {
    if (!rawData) return false;
    // Check both null and undefined (since Firestore projection omits missing fields)
    return rawData.scoreUpdatedAt !== null && rawData.scoreUpdatedAt !== undefined;
  };
  
  // Convert high-scored results with proper sorting
  // Store raw data alongside normalized items for sorting
  // IMPORTANT: When using .select() projection, only selected fields are returned
  // If scoreUpdatedAt doesn't exist in the document, it won't be in rawData (will be undefined)
  const highScoredItemsWithData = snapHigh.docs.map(d => {
    const rawData = d.data() as any;
    return {
      item: normalizePublicItem(d.id, rawData),
      rawData: rawData
    };
  });

  // NEW SORTING LOGIC FOR ARTSTATION:
  // 1. Admin-scored items first (has scoreUpdatedAt) - sorted by scoreUpdatedAt desc, then aestheticScore desc
  // 2. Non-admin items with score >= 9 - sorted by createdAt desc, then aestheticScore desc
  // 3. Items with score < 9 or no score - sorted by createdAt desc
  const highScoredItems: GenerationHistoryItem[] = highScoredItemsWithData
    .sort((a, b) => {
      const aHasAdmin = hasAdminScore(a.rawData);
      const bHasAdmin = hasAdminScore(b.rawData);
      const aScore = getAestheticScore(a.item, a.rawData);
      const bScore = getAestheticScore(b.item, b.rawData);
      const aCreated = getCreatedAtTime(a.item);
      const bCreated = getCreatedAtTime(b.item);

      // Priority 1: Admin-scored items come first
      if (aHasAdmin && !bHasAdmin) return -1;
      if (!aHasAdmin && bHasAdmin) return 1;

      if (aHasAdmin && bHasAdmin) {
        // Both have admin scores - sort by scoreUpdatedAt desc, then score desc
        const aScoreTime = getScoreUpdatedAtTime(a.rawData);
        const bScoreTime = getScoreUpdatedAtTime(b.rawData);
        if (aScoreTime !== bScoreTime) {
          return bScoreTime - aScoreTime; // Newer admin scores first
        }
        // Tiebreaker: higher score first
        return bScore - aScore;
      }

      // Priority 2: Non-admin items with score >= 9
      const aHighScore = aScore >= 9;
      const bHighScore = bScore >= 9;
      if (aHighScore && !bHighScore) return -1;
      if (!aHighScore && bHighScore) return 1;

      if (aHighScore && bHighScore) {
        // Both have high scores - sort by createdAt desc, then score desc
        if (aCreated !== bCreated) {
          return bCreated - aCreated; // Newer first
        }
        return bScore - aScore; // Higher score first
      }

      // Priority 3: Items with score < 9 or no score - sort by createdAt desc
      return bCreated - aCreated;
    })
    .map(({ item }) => item);
  
  // If we don't have enough high-scored items and minScore is not set, fetch lower-scored items
  // (If minScore is set, we only want items >= minScore, so skip lower-scored items)
  let lowScoredItems: GenerationHistoryItem[] = [];
  let lowScoredItemsWithData: Array<{ item: GenerationHistoryItem; rawData: any }> = [];
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
    lowScoredItemsWithData = snapLow.docs.map(d => ({
      item: normalizePublicItem(d.id, d.data() as any),
      rawData: d.data() as any
    }));

    lowScoredItems = lowScoredItemsWithData
      .sort((a, b) => {
        const aHasAdmin = hasAdminScore(a.rawData);
        const bHasAdmin = hasAdminScore(b.rawData);
        const aScore = getAestheticScore(a.item, a.rawData);
        const bScore = getAestheticScore(b.item, b.rawData);
        const aCreated = getCreatedAtTime(a.item);
        const bCreated = getCreatedAtTime(b.item);

        // Admin-scored items first (even if score < 9)
        if (aHasAdmin && !bHasAdmin) return -1;
        if (!aHasAdmin && bHasAdmin) return 1;

        if (aHasAdmin && bHasAdmin) {
          const aScoreTime = getScoreUpdatedAtTime(a.rawData);
          const bScoreTime = getScoreUpdatedAtTime(b.rawData);
          if (aScoreTime !== bScoreTime) {
            return bScoreTime - aScoreTime;
          }
          return bScore - aScore;
        }

        // For non-admin items, sort by createdAt desc
        return bCreated - aCreated;
      })
      .map(({ item }) => item);
  }
  
  // Fetch music items if needed (skip if minScore is set, as music items may not have scores)
  let musicItems: GenerationHistoryItem[] = [];
  let musicItemsWithData: Array<{ item: GenerationHistoryItem; rawData: any }> = [];
  if (params.minScore === undefined && queryMusic && (highScoredItems.length + lowScoredItems.length) < params.limit) {
    const needed = params.limit - (highScoredItems.length + lowScoredItems.length);
    const snapMusic = await queryMusic.limit(needed).get();
    musicItemsWithData = snapMusic.docs.map(d => ({
      item: normalizePublicItem(d.id, d.data() as any),
      rawData: d.data() as any
    }));

    musicItems = musicItemsWithData
      .sort((a, b) => {
        const aHasAdmin = hasAdminScore(a.rawData);
        const bHasAdmin = hasAdminScore(b.rawData);
        const aScore = getAestheticScore(a.item, a.rawData);
        const bScore = getAestheticScore(b.item, b.rawData);
        const aCreated = getCreatedAtTime(a.item);
        const bCreated = getCreatedAtTime(b.item);

        // Admin-scored items first
        if (aHasAdmin && !bHasAdmin) return -1;
        if (!aHasAdmin && bHasAdmin) return 1;

        if (aHasAdmin && bHasAdmin) {
          const aScoreTime = getScoreUpdatedAtTime(a.rawData);
          const bScoreTime = getScoreUpdatedAtTime(b.rawData);
          if (aScoreTime !== bScoreTime) {
            return bScoreTime - aScoreTime;
          }
          return bScore - aScore;
        }

        // For non-admin items, sort by createdAt desc
        return bCreated - aCreated;
      })
      .map(({ item }) => item);
  }
  
  // Combine all items with their raw data for final sorting
  // We need to store raw data to do proper cross-group sorting
  const allItemsWithData: Array<{ item: GenerationHistoryItem; rawData: any }> = [];

  // Create a map to store raw data by item ID
  const rawDataMap = new Map<string, any>();

  // Store raw data from high-scored items
  highScoredItemsWithData.forEach(({ item, rawData }) => {
    if (!rawDataMap.has(item.id)) {
      rawDataMap.set(item.id, rawData);
      allItemsWithData.push({ item, rawData });
    }
  });

  // Store raw data from low-scored items (avoid duplicates)
  lowScoredItemsWithData.forEach(({ item, rawData }) => {
    if (!rawDataMap.has(item.id)) {
      rawDataMap.set(item.id, rawData);
      allItemsWithData.push({ item, rawData });
    }
  });

  // Store raw data from music items (avoid duplicates)
  musicItemsWithData.forEach(({ item, rawData }) => {
    if (!rawDataMap.has(item.id)) {
      rawDataMap.set(item.id, rawData);
      allItemsWithData.push({ item, rawData });
    }
  });

  // Final comprehensive sort across all groups with proper priority:
  // 1. Admin-scored items (has scoreUpdatedAt) - by scoreUpdatedAt desc, then score desc
  // 2. Non-admin items with score >= 9 - by createdAt desc, then score desc
  // 3. Items with score < 9 or no score - by createdAt desc
  allItemsWithData.sort((a, b) => {
    const aHasAdmin = hasAdminScore(a.rawData);
    const bHasAdmin = hasAdminScore(b.rawData);
    const aScore = getAestheticScore(a.item, a.rawData);
    const bScore = getAestheticScore(b.item, b.rawData);
    const aCreated = getCreatedAtTime(a.item);
    const bCreated = getCreatedAtTime(b.item);

    // Priority 1: Admin-scored items come first
    if (aHasAdmin && !bHasAdmin) return -1;
    if (!aHasAdmin && bHasAdmin) return 1;

    if (aHasAdmin && bHasAdmin) {
      // Both have admin scores - sort by scoreUpdatedAt desc, then score desc
      const aScoreTime = getScoreUpdatedAtTime(a.rawData);
      const bScoreTime = getScoreUpdatedAtTime(b.rawData);
      if (aScoreTime !== bScoreTime) {
        return bScoreTime - aScoreTime; // Newer admin scores first
      }
      // Tiebreaker: higher score first
      return bScore - aScore;
    }

    // Priority 2: Non-admin items with score >= 9
    const aHighScore = aScore >= 9;
    const bHighScore = bScore >= 9;
    if (aHighScore && !bHighScore) return -1;
    if (!aHighScore && bHighScore) return 1;

    if (aHighScore && bHighScore) {
      // Both have high scores - sort by createdAt desc, then score desc
      if (aCreated !== bCreated) {
        return bCreated - aCreated; // Newer first
      }
      return bScore - aScore; // Higher score first
    }

    // Priority 3: Items with score < 9 or no score - sort by createdAt desc
    return bCreated - aCreated;
  });

  // Extract just the items in the final sorted order
  let items: GenerationHistoryItem[] = allItemsWithData.map(({ item }) => item);
  
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
 * Returns 1 pure image generation (text-to-image, image-to-image) with aestheticScore >= 9.0
 * 
 * IMPORTANT: 
 * - Every call returns DIFFERENT random image (highly randomized)
 * - Only pure image generation types (excludes branding, edit, etc.)
 * - Only images with aestheticScore >= 9.0 are included
 * - Uses optimized avifUrl for fastest loading
 * - Excludes: branding-kit, logo, edit-image, image-edit, and all edit/branding types
 */
export async function getRandomHighScoredImages(count: number = 20): Promise<Array<{ imageUrl: string; prompt?: string; generationId?: string; creator?: { username?: string; photoURL?: string } }>> {
  try {
    const col = adminDb.collection('generations');
    
    // Pure image generation types only (exclude branding and edit types)
    const pureImageTypes = ['text-to-image', 'image-to-image', 'image-generation', 'image', 'text-to-character'];
    
    // Excluded types: branding, edit, and related
    const excludedTypes = [
      'logo', 'logo-generation', 'branding', 'branding-kit', 'sticker-generation', 
      'product-generation', 'mockup-generation', 'ad-generation',
      'image-edit', 'image_edit', 'edit-image', 'edit_image', 'image-upscale',
      'image-to-svg', 'image-vectorize', 'vectorize', 'remove-bg', 'resize', 
      'replace', 'fill', 'erase', 'expand', 'reimagine'
    ];
    
    console.log('[getRandomHighScoredImages] Starting query with pureImageTypes:', pureImageTypes);
    
    // Query without aestheticScore filter to avoid index requirement
    // Filter aestheticScore in memory instead
    // This avoids needing a composite index for: generationType (in) + isPublic + aestheticScore (range) + isDeleted
    let q = col
      .where('isPublic', '==', true)
      .where('isDeleted', '!=', true)
      .where('generationType', 'in', pureImageTypes)
      .limit(100); // Fetch more to filter in memory
    
    const snap = await q.get();
    console.log('[getRandomHighScoredImages] Query (without aestheticScore filter) returned:', snap.size, 'documents');
    
    // Process primary query results - filter aestheticScore in memory
    let candidates: Array<{ item: GenerationHistoryItem; image: any; score: number }> = [];
    
    if (!snap.empty) {
      snap.docs.forEach(doc => {
        const data = doc.data() as any;
        if (data.isDeleted === true) return;
        
        const images = Array.isArray(data.images) ? data.images : [];
        if (images.length === 0) return;
        
        // Check document-level aestheticScore
        const docScore = typeof data.aestheticScore === 'number' ? data.aestheticScore : null;
        
        // Check image-level aestheticScore - prioritize high scores (>= 9.0), but accept >= 8.0
        for (const img of images) {
          const imgScore = typeof img?.aestheticScore === 'number' ? img.aestheticScore : 
                          (typeof img?.aesthetic?.score === 'number' ? img.aesthetic.score : null);
          const score = imgScore || docScore;
          
          // Accept score >= 8.0, or no score (for older items without scores)
          if (score === null || score >= 8.0) {
            candidates.push({
              item: normalizePublicItem(doc.id, data),
              image: img,
              score: score || 0 // Store score for sorting
            });
            break; // Only take first matching image per generation
          }
        }
      });
    }
    
    // If primary query didn't find enough candidates, try fallback without generationType filter
    if (candidates.length < 5) {
      console.log('[getRandomHighScoredImages] Primary query found', candidates.length, 'candidates, trying fallback');
      const fallbackQ = col
        .where('isPublic', '==', true)
        .where('isDeleted', '!=', true)
        .limit(200); // Fetch more for in-memory filtering
      const fallbackSnap = await fallbackQ.get();
      console.log('[getRandomHighScoredImages] Fallback query returned:', fallbackSnap.size, 'documents');
      
      fallbackSnap.docs.forEach(doc => {
        const data = doc.data() as any;
        if (data.isDeleted === true) return;
        
        // Filter out branding and edit types
        const genType = String(data.generationType || '').toLowerCase().replace(/[_\s]/g, '-');
        if (excludedTypes.some(excluded => genType.includes(excluded) || genType === excluded)) {
          return; // Skip branding/edit types
        }
        if (!pureImageTypes.includes(genType)) {
          return; // Only allow pure image generation types
        }
        
        const images = Array.isArray(data.images) ? data.images : [];
        if (images.length === 0) return;
        
        // Check document-level aestheticScore
        const docScore = typeof data.aestheticScore === 'number' ? data.aestheticScore : null;
        
        // Check image-level aestheticScore - accept any score or no score
        for (const img of images) {
          const imgScore = typeof img?.aestheticScore === 'number' ? img.aestheticScore : 
                          (typeof img?.aesthetic?.score === 'number' ? img.aesthetic.score : null);
          const score = imgScore || docScore;
          
          // Accept any score >= 8.0, or no score (for older items)
          if (score === null || score >= 8.0) {
            // Check if already added (avoid duplicates)
            const existing = candidates.find(c => c.item.id === doc.id);
            if (!existing) {
              candidates.push({
                item: normalizePublicItem(doc.id, data),
                image: img,
                score: score || 0
              });
            }
            break; // Only take first matching image per generation
          }
        }
      });
    }
    
    console.log('[getRandomHighScoredImages] Total candidates found:', candidates.length);
    if (candidates.length === 0) {
      console.warn('[getRandomHighScoredImages] No candidates found');
      return [];
    }
    
    // Sort by score (highest first) for better quality, then randomize
    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    
    // Better randomization: Fisher-Yates shuffle for true randomness
    // Shuffle top candidates (prioritize high scores but still randomize)
    const topCandidates = candidates.slice(0, Math.min(50, candidates.length));
    for (let i = topCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [topCandidates[i], topCandidates[j]] = [topCandidates[j], topCandidates[i]];
    }
    
    // Take up to 'count' images from shuffled top candidates
    const selected = topCandidates.slice(0, Math.min(count, topCandidates.length));
    
    // Map to result format with optimized URLs - PRIORITIZE avifUrl first for fastest loading
    const results = selected
      .map(candidate => {
        // Prioritize avifUrl > thumbnailUrl > url for optimal performance
        const imageUrl = candidate.image?.avifUrl || candidate.image?.thumbnailUrl || candidate.image?.url;
        if (!imageUrl) return null;
        
        const creator = candidate.item.createdBy || null;
        
        return {
          imageUrl, // Already prioritized: avifUrl first
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