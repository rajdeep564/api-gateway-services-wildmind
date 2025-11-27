import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { generationHistoryService } from '../services/generationHistoryService';
import { requireAuth } from '../middlewares/authMiddleware';
import { validateListGenerations, handleValidationErrors } from '../middlewares/validateGenerations';
import { formatApiResponse } from '../utils/formatApiResponse';
import { normalizeMode } from '../utils/modeTypeMap';

const router = Router();

/**
 * GET /api/library
 * Returns user's generated media (library items)
 * Transforms generation history items to library item format
 */
router.get('/', requireAuth, validateListGenerations as any, handleValidationErrors, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Ensure per-user freshness
    try {
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Vary', 'Authorization, Cookie');
    } catch {}
    
    const uid = (req as any).uid;
    const { limit = 50, cursor, nextCursor, mode } = req.query as any;
    const normalizedMode = normalizeMode(mode);
    
    // Fetch user's generations
    const result = await generationHistoryService.listUserGenerations(uid, {
      limit: Number(limit),
      cursor: cursor || undefined,
      nextCursor: nextCursor || undefined,
      mode: normalizedMode,
    });
    
    // Flatten only the current page's history items
    const libraryItems: any[] = [];
    if (result.items && Array.isArray(result.items)) {
      for (const item of result.items) {
        // Extract images
        if (item.images && Array.isArray(item.images) && item.images.length > 0) {
          for (const img of item.images) {
            libraryItems.push({
              id: img.id || `${item.id}-${img.url?.substring(0, 20)}`,
              historyId: item.id,
              url: img.url || img.originalUrl,
              type: mode === 'video' ? 'video' : 'image',
              thumbnail: img.thumbnailUrl || img.avifUrl,
              prompt: item.prompt,
              model: item.model,
              createdAt: item.createdAt,
              storagePath: img.storagePath,
              mediaId: img.id,
              aspectRatio: item.aspectRatio,
              aestheticScore: item.aestheticScore,
              originalUrl: img.originalUrl || img.url,
            });
          }
        }
        // Extract videos
        if (item.videos && Array.isArray(item.videos) && item.videos.length > 0) {
          for (const vid of item.videos) {
            libraryItems.push({
              id: vid.id || `${item.id}-video-${vid.url?.substring(0, 20)}`,
              historyId: item.id,
              url: vid.url,
              type: 'video',
              thumbnail: vid.thumbnailUrl || vid.thumbUrl,
              prompt: item.prompt,
              model: item.model,
              createdAt: item.createdAt,
              storagePath: vid.storagePath,
              mediaId: vid.id,
              aspectRatio: item.aspectRatio,
            });
          }
        }
      }
    }
    // Sort by createdAt descending (newest first)
    libraryItems.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });
    // Use backend's nextCursor and hasMore for pagination
    return res.json(formatApiResponse('success', 'Library retrieved', {
      items: libraryItems,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore || false,
    }));
  } catch (err) {
    return next(err);
  }
});

export default router;

