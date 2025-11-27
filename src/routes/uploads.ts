import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { generationHistoryService } from '../services/generationHistoryService';
import { requireAuth } from '../middlewares/authMiddleware';
import { formatApiResponse } from '../utils/formatApiResponse';
import { normalizeMode } from '../utils/modeTypeMap';

const router = Router();

/**
 * GET /api/uploads
 * Returns user's uploaded media (inputImages and inputVideos from generation history)
 * Filters generations to only return those with inputImages or inputVideos
 */
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = (req as any).uid;
    const { limit = 50, cursor, nextCursor, mode } = req.query as any;
    const normalizedMode = normalizeMode(mode);
    
    // Fetch user's generations with a higher limit to get more items to filter from
    // We need to fetch more generations because not all have inputImages/inputVideos
    const fetchLimit = Number(limit) * 3; // Fetch 3x more to account for filtering
    const result = await generationHistoryService.listUserGenerations(uid, {
      limit: fetchLimit,
      cursor: cursor || undefined,
      nextCursor: nextCursor || undefined,
      mode: normalizedMode,
    });
    
    // Filter to only include items with inputImages or inputVideos
    // Transform the items to extract inputImages/inputVideos as the main items
    const uploadItems: any[] = [];
    
    if (result.items && Array.isArray(result.items)) {
      for (const item of result.items) {
        const itemAny = item as any;
        
        // Extract inputImages
        if (itemAny.inputImages && Array.isArray(itemAny.inputImages) && itemAny.inputImages.length > 0) {
          for (const img of itemAny.inputImages) {
            const imgAny = img as any;
            uploadItems.push({
              id: imgAny.id || `${item.id}-input-${imgAny.url?.substring(0, 20)}`,
              historyId: item.id,
              url: imgAny.url || imgAny.firebaseUrl || imgAny.originalUrl,
              type: 'image',
              thumbnail: imgAny.thumbnailUrl || imgAny.avifUrl || imgAny.webpUrl,
              storagePath: imgAny.storagePath,
              mediaId: imgAny.id,
              originalUrl: imgAny.originalUrl || imgAny.url,
              createdAt: item.createdAt,
            });
          }
        }
        
        // Extract inputVideos
        if (itemAny.inputVideos && Array.isArray(itemAny.inputVideos) && itemAny.inputVideos.length > 0) {
          for (const vid of itemAny.inputVideos) {
            const vidAny = vid as any;
            uploadItems.push({
              id: vidAny.id || `${item.id}-input-video-${vidAny.url?.substring(0, 20)}`,
              historyId: item.id,
              url: vidAny.url || vidAny.firebaseUrl || vidAny.originalUrl,
              type: 'video',
              thumbnail: vidAny.thumbnailUrl || vidAny.thumbUrl || vidAny.avifUrl || vidAny.webpUrl,
              storagePath: vidAny.storagePath,
              mediaId: vidAny.id,
              originalUrl: vidAny.originalUrl || vidAny.url,
              createdAt: item.createdAt,
            });
          }
        }
      }
    }
    
    // Sort by createdAt descending (newest first)
    uploadItems.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });
    
    // Apply cursor-based filtering if nextCursor is provided
    let filteredItems = uploadItems;
    if (nextCursor) {
      // Filter items where createdAt is less than the cursor (older items)
      filteredItems = uploadItems.filter(item => {
        const itemTime = item.createdAt ? new Date(item.createdAt).getTime() : 0;
        return itemTime < Number(nextCursor);
      });
    }
    
    // Apply pagination to the filtered results
    const limitNum = Number(limit);
    const paginatedItems = filteredItems.slice(0, limitNum);
    const hasMore = filteredItems.length > limitNum || (result.hasMore || false);
    
    // For nextCursor, use the createdAt of the last item if available
    const nextCursorValue = paginatedItems.length > 0 && paginatedItems[paginatedItems.length - 1].createdAt
      ? new Date(paginatedItems[paginatedItems.length - 1].createdAt).getTime()
      : (result.nextCursor || undefined);
    
    return res.json(formatApiResponse('success', 'OK', {
      items: paginatedItems,
      nextCursor: nextCursorValue,
      hasMore,
    }));
  } catch (err) {
    return next(err);
  }
});

export default router;

