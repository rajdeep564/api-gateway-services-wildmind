import { Request, Response, NextFunction } from 'express';
import '../types/http';
import { formatApiResponse } from '../utils/formatApiResponse';
import { generationHistoryService } from '../services/generationHistoryService';
import { normalizeMode } from '../utils/modeTypeMap';
import { getCachedLibrary, setCachedLibrary, getCachedUploads, setCachedUploads, invalidateLibraryCache } from '../utils/generationCache';
import { createHash } from 'crypto';
import { uploadDataUriToZata, uploadFromUrlToZata } from '../utils/storage/zataUpload';
import { authRepository } from '../repository/auth/authRepository';

/**
 * Get user's library (generated images/videos)
 * Supports pagination and mode filtering
 */
export async function getLibrary(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      return res.status(401).json(formatApiResponse('error', 'Unauthorized', null));
    }

    const { limit = 50, cursor, nextCursor, mode } = req.query as any;
    const normalizedMode = normalizeMode(mode);
    const targetItemLimit = Math.max(1, Math.min(Number(limit) || 50, 200));

    // Build cache params
    const cacheParams = {
      limit: targetItemLimit,
      cursor: cursor || undefined,
      nextCursor: nextCursor || undefined,
      mode: normalizedMode || 'all',
    };

    // Try cache first
    try {
      const cached = await getCachedLibrary(uid, cacheParams);
      if (cached) {
        // Generate ETag for better browser cache validation
        const etag = createHash('md5').update(JSON.stringify(cached)).digest('hex');
        res.setHeader('ETag', `"${etag}"`);
        
        // Check if client has cached version (304 Not Modified)
        const clientEtag = req.headers['if-none-match'];
        if (clientEtag === `"${etag}"` || clientEtag === etag) {
          res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600'); // 30 min browser, 1 hour CDN
          res.setHeader('X-Cache', 'HIT-304');
          return res.status(304).end(); // Not Modified - browser uses its cache
        }
        
        // Set HTTP cache headers for browser caching
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900'); // 5 min browser, 15 min CDN
        res.setHeader('X-Cache', 'HIT');
        return res.json(
          formatApiResponse('success', 'Library retrieved', cached)
        );
      }
    } catch (e) {
      console.warn('[getLibrary] Cache read failed, falling back to DB:', e);
    }

    // Map mode to generation types
    const imageGenerationTypes = [
      'text-to-image',
      'image-to-image',
      'image-generation',
      'image',
      'text-to-character',
      'image-upscale',
      'image-edit',
      'image-to-svg',
      'image-vectorize',
      'vectorize',
      'logo',
      'logo-generation',
      'sticker-generation',
      'product-generation',
      'mockup-generation',
      'ad-generation',
    ];

    const videoGenerationTypes = [
      'text-to-video',
      'image-to-video',
      'video-to-video',
      'video-generation',
      'video',
      'video-edit',
    ];

    let generationTypes: string[] | undefined;
    if (normalizedMode === 'image') {
      generationTypes = imageGenerationTypes;
    } else if (normalizedMode === 'video') {
      generationTypes = videoGenerationTypes;
    } else if (!normalizedMode || normalizedMode === 'all') {
      generationTypes = [...imageGenerationTypes, ...videoGenerationTypes];
    } else {
      generationTypes = undefined;
    }

    const aggregatedItems: Array<{
      id: string;
      historyId: string;
      url: string;
      type: 'image' | 'video';
      thumbnail?: string;
      prompt?: string;
      model?: string;
      createdAt?: string;
      storagePath?: string;
      mediaId?: string;
      aspectRatio?: string;
      aestheticScore?: number;
    }> = [];

    let nextCursorLocal: string | number | undefined | null = nextCursor || undefined;
    let cursorLocal: string | undefined = cursor || undefined;
    let serviceHasMore = false;
    let fetchCount = 0;
    const MAX_FETCHES = 5;
    const fetchLimit = Math.min(targetItemLimit * 2, 100);

    while (aggregatedItems.length < targetItemLimit && fetchCount < MAX_FETCHES) {
      const params: any = {
        limit: fetchLimit,
        status: 'completed',
        generationType: generationTypes as any,
        mode: normalizedMode,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };

      if (fetchCount === 0 && cursorLocal) {
        params.cursor = cursorLocal;
      }
      if (nextCursorLocal) {
        params.nextCursor = nextCursorLocal;
      }

      const result = await generationHistoryService.listUserGenerations(uid, params);
      serviceHasMore = Boolean(result.hasMore);
      nextCursorLocal = result.nextCursor || undefined;

      for (const entry of result.items) {
        if (entry.images && Array.isArray(entry.images)) {
          for (const img of entry.images) {
            const url = img.url || img.originalUrl || '';
            if (!url) continue;
            aggregatedItems.push({
              id: `${entry.id}-${img.id || `${Date.now()}-${aggregatedItems.length}`}`,
              historyId: entry.id,
              url,
              type: 'image',
              thumbnail: img.thumbnailUrl || img.url,
              prompt: entry.prompt,
              model: entry.model,
              createdAt: entry.createdAt?.toString() || new Date().toISOString(),
              storagePath: img.storagePath,
              mediaId: img.id,
              aspectRatio: entry.aspect_ratio || entry.aspectRatio,
              aestheticScore: img.aestheticScore || entry.aestheticScore,
            });
            if (aggregatedItems.length >= targetItemLimit) break;
          }
        }
        if (aggregatedItems.length >= targetItemLimit) break;

        if (entry.videos && Array.isArray(entry.videos)) {
          for (const video of entry.videos) {
            const url = video.url || video.originalUrl || '';
            if (!url) continue;
            aggregatedItems.push({
              id: `${entry.id}-${video.id || `${Date.now()}-${aggregatedItems.length}`}`,
              historyId: entry.id,
              url,
              type: 'video',
              thumbnail: video.thumbUrl || video.posterUrl,
              prompt: entry.prompt,
              model: entry.model,
              createdAt: entry.createdAt?.toString() || new Date().toISOString(),
              storagePath: video.storagePath,
              mediaId: video.id,
              aspectRatio: entry.aspect_ratio || entry.aspectRatio,
              aestheticScore: video.aestheticScore || entry.aestheticScore,
            });
            if (aggregatedItems.length >= targetItemLimit) break;
          }
        }

        if (aggregatedItems.length >= targetItemLimit) break;
      }

      if (!serviceHasMore || !nextCursorLocal) {
        break;
      }

      cursorLocal = undefined;
      fetchCount += 1;
    }

    const items = aggregatedItems.slice(0, targetItemLimit);
    const hasMore = aggregatedItems.length > targetItemLimit || (serviceHasMore && Boolean(nextCursorLocal));

    const response = {
      items,
      nextCursor: nextCursorLocal,
      hasMore,
    };

    // Cache the result
    try {
      await setCachedLibrary(uid, cacheParams, response);
    } catch (e) {
      console.warn('[getLibrary] Failed to set cache:', e);
    }

    // Generate ETag for browser cache validation
    const etag = createHash('md5').update(JSON.stringify(response)).digest('hex');
    res.setHeader('ETag', `"${etag}"`);
    
    // Set HTTP cache headers
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900'); // 5 min browser, 15 min CDN
    res.setHeader('X-Cache', 'MISS');

    return res.json(
      formatApiResponse('success', 'Library retrieved', response)
    );
  } catch (err) {
    console.error('[getLibrary] Error:', err);
    return next(err);
  }
}

/**
 * Get user's uploads (inputImages and inputVideos from generation history)
 * Supports pagination and mode filtering
 */
export async function getUploads(req: Request, res: Response, next: NextFunction) {
  try {
    // Log immediately to ensure we see the function is being called
    console.log('='.repeat(80));
    console.log('[getUploads] ===== FUNCTION CALLED =====');
    console.log('[getUploads] Request received at:', new Date().toISOString());
    process.stdout.write('[getUploads] Function entry point\n');
    
    const uid = (req as any).uid;
    console.log('[getUploads] UID:', uid);
    if (!uid) {
      console.error('[getUploads] No UID found - returning 401');
      return res.status(401).json(formatApiResponse('error', 'Unauthorized', null));
    }

    const { limit = 50, cursor, nextCursor, mode } = req.query as any;
    const normalizedMode = normalizeMode(mode);
    const targetItemLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    
    console.log('[getUploads] Query params:', { limit, cursor, nextCursor, mode, normalizedMode, targetItemLimit });

    // Build cache params
    const cacheParams = {
      limit: targetItemLimit,
      cursor: cursor || undefined,
      nextCursor: nextCursor || undefined,
      mode: normalizedMode || 'all',
    };

    // Try cache first
    try {
      console.log('[getUploads] Checking cache...');
      const cached = await getCachedUploads(uid, cacheParams);
      if (cached) {
        console.log('[getUploads] ✅ CACHE HIT - Returning cached data. Items:', cached.items?.length || 0);
        // Generate ETag for better browser cache validation
        const etag = createHash('md5').update(JSON.stringify(cached)).digest('hex');
        res.setHeader('ETag', `"${etag}"`);
        
        // Check if client has cached version (304 Not Modified)
        const clientEtag = req.headers['if-none-match'];
        if (clientEtag === `"${etag}"` || clientEtag === etag) {
          console.log('[getUploads] Client has cached version (304 Not Modified)');
          res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600'); // 30 min browser, 1 hour CDN
          res.setHeader('X-Cache', 'HIT-304');
          return res.status(304).end(); // Not Modified - browser uses its cache
        }
        
        // Set HTTP cache headers for browser caching
        res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900'); // 5 min browser, 15 min CDN
        res.setHeader('X-Cache', 'HIT');
        console.log('[getUploads] Returning cached response with', cached.items?.length || 0, 'items');
        return res.json(
          formatApiResponse('success', 'Uploads retrieved', cached)
        );
      } else {
        console.log('[getUploads] ❌ CACHE MISS - Will fetch from database');
      }
    } catch (e) {
      console.warn('[getUploads] Cache read failed, falling back to DB:', e);
    }

    const aggregatedItems: Array<{
      id: string;
      historyId: string;
      url: string;
      type: 'image' | 'video';
      thumbnail?: string;
      prompt?: string;
      model?: string;
      createdAt?: string;
      storagePath?: string;
      mediaId?: string;
      originalUrl?: string;
    }> = [];

    let nextCursorLocal: string | number | undefined | null = nextCursor || undefined;
    let cursorLocal: string | undefined = cursor || undefined;
    let serviceHasMore = false;
    let fetchCount = 0;
    const MAX_FETCHES = 10; // Increased to find more wild-upload entries
    const fetchLimit = Math.min(targetItemLimit * 3, 200); // Increased limit to find more entries per page

    console.log('[getUploads] Starting database fetch loop. Target items:', targetItemLimit, 'Max fetches:', MAX_FETCHES, 'Fetch limit:', fetchLimit);

    while (aggregatedItems.length < targetItemLimit && fetchCount < MAX_FETCHES) {
      console.log(`[getUploads] === Fetch iteration ${fetchCount + 1}/${MAX_FETCHES} ===`);
      // Don't filter by mode or generationType - fetch all completed entries
      // Then filter by model === 'wild-upload' to find upload entries
      // This ensures we find all uploads regardless of generationType
      const params: any = {
        limit: fetchLimit,
        status: 'completed',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };

      if (fetchCount === 0 && cursorLocal) {
        params.cursor = cursorLocal;
      }
      if (nextCursorLocal) {
        params.nextCursor = nextCursorLocal;
      }

      console.log(`[getUploads] Calling listUserGenerations with params:`, JSON.stringify(params, null, 2));
      const result = await generationHistoryService.listUserGenerations(uid, params);
      console.log(`[getUploads] ✅ Database query completed. Got ${result.items.length} entries`);
      serviceHasMore = Boolean(result.hasMore);
      nextCursorLocal = result.nextCursor || undefined;

      // Log for debugging - log every fetch, not just first
      const wildUploadEntries = result.items.filter((e: any) => e.model === 'wild-upload');
      console.log(`[getUploads] Fetch ${fetchCount + 1} results:`, {
        count: result.items.length,
        models: [...new Set(result.items.map((e: any) => e.model))],
        wildUploadCount: wildUploadEntries.length,
        mode: normalizedMode,
        generationTypes: [...new Set(result.items.map((e: any) => e.generationType))],
        wildUploadGenerationTypes: [...new Set(wildUploadEntries.map((e: any) => e.generationType))],
        hasMore: serviceHasMore,
        nextCursor: nextCursorLocal ? 'present' : 'null'
      });
      
      // If no wild-upload entries found in first fetch, log warning with more details
      if (fetchCount === 0 && wildUploadEntries.length === 0) {
        if (result.items.length > 0) {
          console.warn('[getUploads] ⚠️ No wild-upload entries found in first fetch. Total entries:', result.items.length, {
            sampleModels: [...new Set(result.items.slice(0, 5).map((e: any) => e.model))],
            sampleGenerationTypes: [...new Set(result.items.slice(0, 5).map((e: any) => e.generationType))]
          });
        } else {
          console.warn('[getUploads] ⚠️ No entries found at all. This might indicate:', {
            uid,
            mode: normalizedMode,
            possibleReasons: [
              'No completed generations exist',
              'All entries are in generating/failed status',
              'Database query issue'
            ]
          });
        }
      }
      
      for (const entry of result.items) {
        // Check if this entry has uploads in the input folder
        // Method 1: Explicit wild-upload entries (new format)
        const isWildUpload = entry.model === 'wild-upload';
        
        // Method 2: Check if entry has storage paths in input folder (old format or alternative)
        const hasInputPath = (entry.inputImages && Array.isArray(entry.inputImages) && entry.inputImages.some((img: any) => {
          const path = img.storagePath || img.url || '';
          return path.includes('/input/');
        })) || (entry.inputVideos && Array.isArray(entry.inputVideos) && entry.inputVideos.some((vid: any) => {
          const path = vid.storagePath || vid.url || '';
          return path.includes('/input/');
        }));
        
        // Method 3: Check if entry has inputImages/inputVideos populated (any format)
        const hasInputMedia = (entry.inputImages && Array.isArray(entry.inputImages) && entry.inputImages.length > 0) ||
                              (entry.inputVideos && Array.isArray(entry.inputVideos) && entry.inputVideos.length > 0);
        
        // Method 4: Check if regular images/videos arrays have storage paths in input folder (old format)
        const hasInputInRegularArrays = (entry.images && Array.isArray(entry.images) && entry.images.some((img: any) => {
          const path = img.storagePath || img.url || '';
          return path.includes('/input/');
        })) || (entry.videos && Array.isArray(entry.videos) && entry.videos.some((vid: any) => {
          const path = vid.storagePath || vid.url || '';
          return path.includes('/input/');
        }));
        
        // Include entry if it matches any of these criteria
        if (!isWildUpload && !hasInputPath && !hasInputMedia && !hasInputInRegularArrays) {
          continue;
        }
        
        // Log all included entries for debugging (only on first fetch to avoid spam)
        if (fetchCount === 0) {
          console.log('[getUploads] ✅ Including upload entry:', {
            id: entry.id,
            model: entry.model,
            generationType: entry.generationType,
            criteria: {
              isWildUpload,
              hasInputPath,
              hasInputMedia,
              hasInputInRegularArrays
            },
            counts: {
              inputImages: entry.inputImages?.length || 0,
              inputVideos: entry.inputVideos?.length || 0,
              images: entry.images?.length || 0,
              videos: entry.videos?.length || 0
            },
            samplePaths: {
              inputImage: entry.inputImages?.[0]?.storagePath?.substring(0, 100) || entry.inputImages?.[0]?.url?.substring(0, 100) || 'none',
              image: entry.images?.[0]?.storagePath?.substring(0, 100) || entry.images?.[0]?.url?.substring(0, 100) || 'none'
            }
          });
        }

        // Log wild-upload entries found
        if (fetchCount === 0) {
          console.log('[getUploads] Found wild-upload entry:', {
            id: entry.id,
            hasInputImages: !!(entry.inputImages && Array.isArray(entry.inputImages) && entry.inputImages.length > 0),
            hasInputVideos: !!(entry.inputVideos && Array.isArray(entry.inputVideos) && entry.inputVideos.length > 0),
            inputImagesCount: entry.inputImages?.length || 0,
            inputVideosCount: entry.inputVideos?.length || 0,
            generationType: entry.generationType
          });
        }

        // Filter by mode: if mode is 'image', only include inputImages; if 'video', only include inputVideos
        const shouldIncludeImages = !normalizedMode || normalizedMode === 'all' || normalizedMode === 'image';
        const shouldIncludeVideos = !normalizedMode || normalizedMode === 'all' || normalizedMode === 'video';

        if (shouldIncludeImages && entry.inputImages && Array.isArray(entry.inputImages)) {
          for (const img of entry.inputImages) {
            const url = img.url || img.originalUrl || '';
            if (!url) {
              console.warn('[getUploads] Image missing URL:', { entryId: entry.id, imageId: img.id, image: img });
              continue;
            }
            aggregatedItems.push({
              id: `${entry.id}-input-${img.id || `${Date.now()}-${aggregatedItems.length}`}`,
              historyId: entry.id,
              url,
              type: 'image',
              thumbnail: img.url,
              prompt: entry.prompt,
              model: entry.model,
              createdAt: entry.createdAt?.toString() || new Date().toISOString(),
              storagePath: img.storagePath,
              mediaId: img.id,
              originalUrl: img.originalUrl,
            });
            if (aggregatedItems.length >= targetItemLimit) break;
          }
        }
        if (aggregatedItems.length >= targetItemLimit) break;

        if (shouldIncludeVideos && entry.inputVideos && Array.isArray(entry.inputVideos)) {
          for (const video of entry.inputVideos) {
            const url = video.url || video.originalUrl || '';
            if (!url) {
              console.warn('[getUploads] Video missing URL:', { entryId: entry.id, videoId: video.id, video: video });
              continue;
            }
            aggregatedItems.push({
              id: `${entry.id}-input-video-${video.id || `${Date.now()}-${aggregatedItems.length}`}`,
              historyId: entry.id,
              url,
              type: 'video',
              thumbnail: video.thumbUrl || video.url,
              prompt: entry.prompt,
              model: entry.model,
              createdAt: entry.createdAt?.toString() || new Date().toISOString(),
              storagePath: video.storagePath,
              mediaId: video.id,
              originalUrl: video.originalUrl,
            });
            if (aggregatedItems.length >= targetItemLimit) break;
          }
        }

        // Also check regular images/videos arrays for entries with input folder paths (old format or alternative)
        // This handles cases where uploads were saved in the regular arrays instead of inputImages/inputVideos
        if (shouldIncludeImages && entry.images && Array.isArray(entry.images)) {
          for (const img of entry.images) {
            const storagePath = img.storagePath || img.url || '';
            // Only include if storage path is in input folder (users/username/input/historyId/...)
            if (!storagePath.includes('/input/')) {
              continue;
            }
            const url = img.url || img.originalUrl || '';
            if (!url) {
              console.warn('[getUploads] Image in input folder missing URL:', { entryId: entry.id, imageId: img.id, storagePath });
              continue;
            }
            aggregatedItems.push({
              id: `${entry.id}-image-${img.id || `${Date.now()}-${aggregatedItems.length}`}`,
              historyId: entry.id,
              url,
              type: 'image',
              thumbnail: img.url || img.thumbnailUrl || img.avifUrl || url,
              prompt: entry.prompt,
              model: entry.model,
              createdAt: entry.createdAt?.toString() || new Date().toISOString(),
              storagePath: img.storagePath,
              mediaId: img.id,
              originalUrl: img.originalUrl || img.url,
            });
            if (aggregatedItems.length >= targetItemLimit) break;
          }
        }
        if (aggregatedItems.length >= targetItemLimit) break;

        if (shouldIncludeVideos && entry.videos && Array.isArray(entry.videos)) {
          for (const video of entry.videos) {
            const storagePath = video.storagePath || video.url || '';
            // Only include if storage path is in input folder (users/username/input/historyId/...)
            if (!storagePath.includes('/input/')) {
              continue;
            }
            const url = video.url || video.originalUrl || '';
            if (!url) {
              console.warn('[getUploads] Video in input folder missing URL:', { entryId: entry.id, videoId: video.id, storagePath });
              continue;
            }
            aggregatedItems.push({
              id: `${entry.id}-video-${video.id || `${Date.now()}-${aggregatedItems.length}`}`,
              historyId: entry.id,
              url,
              type: 'video',
              thumbnail: video.thumbUrl || video.thumbnailUrl || video.url,
              prompt: entry.prompt,
              model: entry.model,
              createdAt: entry.createdAt?.toString() || new Date().toISOString(),
              storagePath: video.storagePath,
              mediaId: video.id,
              originalUrl: video.originalUrl || video.url,
            });
            if (aggregatedItems.length >= targetItemLimit) break;
          }
        }

        if (aggregatedItems.length >= targetItemLimit) break;
      }

      if (!serviceHasMore || !nextCursorLocal) {
        break;
      }

      cursorLocal = undefined;
      fetchCount += 1;
    }

    const items = aggregatedItems.slice(0, targetItemLimit);
    const hasMore = aggregatedItems.length > targetItemLimit || (serviceHasMore && Boolean(nextCursorLocal));

    // Log warning if we fetched multiple pages but found no uploads
    if (fetchCount > 0 && items.length === 0) {
      console.warn('[getUploads] ⚠️ Fetched multiple pages but found no upload items. This might indicate:', {
        fetchCount,
        mode: normalizedMode,
        uid,
        possibleReasons: [
          'No uploads have been saved yet',
          'Uploads were saved with different model name',
          'Uploads exist but inputImages/inputVideos are not populated'
        ]
      });
    }

    console.log('[getUploads] Final response:', {
      itemsCount: items.length,
      hasMore,
      nextCursor: nextCursorLocal ? 'present' : 'null',
      fetchCount,
      totalFetched: aggregatedItems.length,
      mode: normalizedMode,
      uid,
      sampleItem: items[0] ? { id: items[0].id, type: items[0].type, url: items[0].url?.substring(0, 50) } : null
    });

    const response = {
      items,
      nextCursor: nextCursorLocal,
      hasMore,
    };

    // Cache the result
    try {
      await setCachedUploads(uid, cacheParams, response);
    } catch (e) {
      console.warn('[getUploads] Failed to set cache:', e);
    }

    // Generate ETag for browser cache validation
    const etag = createHash('md5').update(JSON.stringify(response)).digest('hex');
    res.setHeader('ETag', `"${etag}"`);
    
    // Set HTTP cache headers
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900'); // 5 min browser, 15 min CDN
    res.setHeader('X-Cache', 'MISS');

    console.log('[getUploads] ===== SENDING RESPONSE =====');
    console.log('[getUploads] Response items:', response.items.length, 'Has more:', response.hasMore);
    process.stdout.write(`[getUploads] Sending ${response.items.length} items to client\n`);

    return res.json(
      formatApiResponse('success', 'Uploads retrieved', response)
    );
  } catch (err) {
    console.error('[getUploads] Error:', err);
    return next(err);
  }
}

/**
 * Save an uploaded media item (image/video) for the WildMind AI app.
 * This creates a dedicated history entry with model === 'wild-upload'
 * and stores the file in Zata, so it appears in the /uploads endpoint
 * but is not tied to any specific generation run.
 */
export async function saveUploadForWild(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { url, type } = req.body || {};

    if (!url || !type) {
      return res.status(400).json(
        formatApiResponse('error', 'url and type are required', null)
      );
    }

    if (type !== 'image' && type !== 'video') {
      return res.status(400).json(
        formatApiResponse('error', 'type must be \"image\" or \"video\"', null)
      );
    }

    // Get user info
    const creator = await authRepository.getUserById(uid);
    const username = creator?.username || uid;

    // Create a minimal generation history entry representing this upload
    const { historyId } = await generationHistoryService.startGeneration(uid, {
      prompt: 'Uploaded from WildMind AI',
      model: 'wild-upload',
      generationType: type === 'image' ? 'text-to-image' : 'text-to-video',
      visibility: 'private',
    });

    // Upload the file to Zata
    const isDataUri = /^data:/.test(url);
    const keyPrefix = `users/${username}/input/${historyId}`;
    const fileName = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    let stored: { key: string; publicUrl: string; storagePath?: string; originalUrl?: string };

    if (isDataUri) {
      const result = await uploadDataUriToZata({
        dataUri: url,
        keyPrefix,
        fileName,
      });
      stored = {
        key: result.key,
        publicUrl: result.publicUrl,
        storagePath: result.key,
        originalUrl: url,
      };
    } else {
      const result = await uploadFromUrlToZata({
        sourceUrl: url,
        keyPrefix,
        fileName,
      });
      stored = {
        key: result.key,
        publicUrl: result.publicUrl,
        storagePath: result.key,
        originalUrl: result.originalUrl,
      };
    }

    // Build media item shape compatible with wild project
    const mediaItem = {
      id: `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      url: stored.publicUrl,
      firebaseUrl: stored.publicUrl,
      storagePath: stored.storagePath,
      originalUrl: stored.originalUrl || url,
    };

    const updateData: any = {
      status: 'completed',
    };
    if (type === 'image') {
      updateData.inputImages = [mediaItem];
    } else {
      updateData.inputVideos = [mediaItem];
    }

    await generationHistoryService.markGenerationCompleted(uid, historyId, updateData);

    console.log('[saveUploadForWild] Upload saved successfully:', {
      uid,
      historyId,
      type,
      url: stored.publicUrl,
      storagePath: stored.storagePath,
      hasInputImages: type === 'image',
      hasInputVideos: type === 'video',
      model: 'wild-upload',
      generationType: type === 'image' ? 'text-to-image' : 'text-to-video',
      updateData: {
        status: updateData.status,
        inputImagesCount: updateData.inputImages?.length || 0,
        inputVideosCount: updateData.inputVideos?.length || 0
      }
    });

    // Verify the entry was saved correctly by fetching it back
    try {
      const verificationEntry = await generationHistoryService.getUserGeneration(uid, historyId);
      if (verificationEntry) {
        console.log('[saveUploadForWild] ✅ Verification - Entry retrieved:', {
          historyId: verificationEntry.id,
          model: verificationEntry.model,
          status: verificationEntry.status,
          hasInputImages: !!(verificationEntry.inputImages && Array.isArray(verificationEntry.inputImages) && verificationEntry.inputImages.length > 0),
          hasInputVideos: !!(verificationEntry.inputVideos && Array.isArray(verificationEntry.inputVideos) && verificationEntry.inputVideos.length > 0),
          inputImagesCount: verificationEntry.inputImages?.length || 0,
          inputVideosCount: verificationEntry.inputVideos?.length || 0,
          firstImageUrl: verificationEntry.inputImages?.[0]?.url?.substring(0, 50) || 'none',
          firstVideoUrl: verificationEntry.inputVideos?.[0]?.url?.substring(0, 50) || 'none'
        });
      } else {
        console.error('[saveUploadForWild] ❌ Verification failed - Entry not found after saving!', { historyId, uid });
      }
    } catch (verifyError) {
      console.error('[saveUploadForWild] ❌ Verification error:', verifyError);
    }

    // Invalidate uploads cache so the new upload appears immediately
    try {
      await invalidateLibraryCache(uid);
      console.log('[saveUploadForWild] Invalidated uploads cache for user:', uid);
    } catch (cacheError) {
      console.warn('[saveUploadForWild] Failed to invalidate cache:', cacheError);
      // Don't fail the request if cache invalidation fails
    }

    return res.json(
      formatApiResponse('success', 'Uploaded media saved', {
        id: mediaItem.id,
        url: stored.publicUrl,
        type,
        storagePath: stored.storagePath,
        historyId,
      })
    );
  } catch (err) {
    console.error('[saveUploadForWild] Error:', err);
    return next(err);
  }
}

