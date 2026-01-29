import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { generationHistoryService } from '../services/generationHistoryService';
import { requireAuth } from '../middlewares/authMiddleware';
import { formatApiResponse } from '../utils/formatApiResponse';
import { normalizeMode } from '../utils/modeTypeMap';

import multer from 'multer';
import os from 'os';
import path from 'path';
import * as mediaLibraryController from '../controllers/canvas/mediaLibraryController';

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ext && ext.length <= 12 ? ext : '';
      const name = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`;
      cb(null, name);
    },
  }),
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB
  },
});

// POST /api/uploads/upload-file
// Uploads a local file (multipart/form-data) and stores it in storage.
router.post('/upload-file', requireAuth, upload.single('file'), mediaLibraryController.uploadMediaFile);

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
    const limitNum = Number(limit);
    
    // Fetch user's generations with a higher limit to get more items to filter from
    // We need to fetch more generations because not all have inputImages/inputVideos
    const fetchLimitBase = limitNum * 3; // Base multiplier
    
    let accumulatedItems: any[] = [];
    let currentNextCursor = nextCursor;
    let hasMoreGenerations = true;
    let loopCount = 0;
    const MAX_LOOPS = 12; // Allow deeper scanning for sparse uploads

    while (accumulatedItems.length < limitNum && hasMoreGenerations && loopCount < MAX_LOOPS) {
      const fetchLimit = Math.min(400, fetchLimitBase * (loopCount < 4 ? 1 : 2));
      const result = await generationHistoryService.listUserGenerations(uid, {
        limit: fetchLimit,
        cursor: loopCount === 0 ? (cursor || undefined) : undefined,
        nextCursor: currentNextCursor || undefined,
        mode: normalizedMode,
      });
      loopCount++;

      const batchItems: any[] = [];
      if (result.items && Array.isArray(result.items)) {
        for (const item of result.items) {
          const itemAny = item as any;
          if (itemAny.inputImages && Array.isArray(itemAny.inputImages) && itemAny.inputImages.length > 0) {
            for (const img of itemAny.inputImages) {
              const imgAny = img as any;
              batchItems.push({
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
          if (itemAny.inputVideos && Array.isArray(itemAny.inputVideos) && itemAny.inputVideos.length > 0) {
            for (const vid of itemAny.inputVideos) {
              const vidAny = vid as any;
              batchItems.push({
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
      accumulatedItems.push(...batchItems);

      currentNextCursor = result.nextCursor; // underlying generation cursor (timestamp)
      hasMoreGenerations = result.hasMore || false;
      if (!result.nextCursor) hasMoreGenerations = false;
    }

    // Fallback: if still no uploads found but generations remain, attempt one large sweep
    if (accumulatedItems.length === 0 && hasMoreGenerations) {
      const result = await generationHistoryService.listUserGenerations(uid, {
        limit: Math.min(500, fetchLimitBase * 4),
        nextCursor: currentNextCursor || undefined,
        mode: normalizedMode,
      });
      currentNextCursor = result.nextCursor;
      hasMoreGenerations = result.hasMore || false;
      if (result.items && Array.isArray(result.items)) {
        for (const item of result.items) {
          const itemAny = item as any;
          if (itemAny.inputImages && Array.isArray(itemAny.inputImages)) {
            for (const img of itemAny.inputImages) {
              accumulatedItems.push({
                id: (img as any).id || `${item.id}-input-${(img as any).url?.substring(0, 20)}`,
                historyId: item.id,
                url: (img as any).url || (img as any).firebaseUrl || (img as any).originalUrl,
                type: 'image',
                thumbnail: (img as any).thumbnailUrl || (img as any).avifUrl || (img as any).webpUrl,
                storagePath: (img as any).storagePath,
                mediaId: (img as any).id,
                originalUrl: (img as any).originalUrl || (img as any).url,
                createdAt: item.createdAt,
              });
            }
          }
          if (itemAny.inputVideos && Array.isArray(itemAny.inputVideos)) {
            for (const vid of itemAny.inputVideos) {
              accumulatedItems.push({
                id: (vid as any).id || `${item.id}-input-video-${(vid as any).url?.substring(0, 20)}`,
                historyId: item.id,
                url: (vid as any).url || (vid as any).firebaseUrl || (vid as any).originalUrl,
                type: 'video',
                thumbnail: (vid as any).thumbnailUrl || (vid as any).thumbUrl || (vid as any).avifUrl || (vid as any).webpUrl,
                storagePath: (vid as any).storagePath,
                mediaId: (vid as any).id,
                originalUrl: (vid as any).originalUrl || (vid as any).url,
                createdAt: item.createdAt,
              });
            }
          }
        }
      }
    }
    
    // Sort by createdAt descending (newest first)
    accumulatedItems.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });
    
    // Apply cursor-based filtering if nextCursor is provided (only for the first batch if we didn't rely on service)
    // But since we rely on service for pagination, we just need to ensure we don't return duplicates if any.
    // The service handles < nextCursor.
    
    // Apply pagination to the filtered results
    const paginatedItems = accumulatedItems.slice(0, limitNum);
    // If we found no uploads at all, stop pagination to avoid infinite empty scrolling
    const hasMore = paginatedItems.length > 0 ? (accumulatedItems.length > limitNum || hasMoreGenerations) : false;
    
    // Propagate underlying generation cursor (timestamp) rather than upload-derived timestamp to ensure forward progress
    const nextCursorValue = hasMore ? (currentNextCursor || undefined) : null;
    
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

