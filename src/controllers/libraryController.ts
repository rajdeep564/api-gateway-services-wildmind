import { Request, Response, NextFunction } from 'express';
import '../types/http';
import { formatApiResponse } from '../utils/formatApiResponse';
import { generationHistoryService } from '../services/generationHistoryService';
import { normalizeMode } from '../utils/modeTypeMap';
import { getCachedLibrary, setCachedLibrary, getCachedUploads, setCachedUploads } from '../utils/generationCache';
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
      const cached = await getCachedUploads(uid, cacheParams);
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
          formatApiResponse('success', 'Uploads retrieved', cached)
        );
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
    const MAX_FETCHES = 6;
    const fetchLimit = Math.min(targetItemLimit * 2, 120);

    while (aggregatedItems.length < targetItemLimit && fetchCount < MAX_FETCHES) {
      const params: any = {
        limit: fetchLimit,
        status: 'completed',
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
        // Only treat explicit WildMind uploads as \"uploads\" here.
        // These are the synthetic history entries we create via the
        // saveUploadForWild endpoint with model === 'wild-upload' and
        // inputImages/inputVideos populated.
        if (entry.model !== 'wild-upload') {
          continue;
        }

        if (entry.inputImages && Array.isArray(entry.inputImages)) {
          for (const img of entry.inputImages) {
            const url = img.url || img.originalUrl || '';
            if (!url) continue;
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

        if (entry.inputVideos && Array.isArray(entry.inputVideos)) {
          for (const video of entry.inputVideos) {
            const url = video.url || video.originalUrl || '';
            if (!url) continue;
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

