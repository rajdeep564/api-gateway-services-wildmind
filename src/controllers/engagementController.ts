import { Request, Response, NextFunction } from 'express';
import { engagementRepository } from '../repository/engagementRepository';
import { formatApiResponse } from '../utils/formatApiResponse';

function getUid(req: Request): string {
  return (req as any).uid as string;
}

export async function toggleLike(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = getUid(req);
    const { generationId, action } = req.body || {};

    if (!generationId || !['like', 'unlike'].includes(action)) {
      return res.status(400).json(formatApiResponse('error', 'Invalid payload', null));
    }

    await engagementRepository.toggleEngagement('like', uid, String(generationId), action === 'like' ? 'add' : 'remove');

    return res.json(formatApiResponse('success', 'OK', null));
  } catch (error) {
    return next(error);
  }
}

export async function toggleBookmark(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = getUid(req);
    const { generationId, action } = req.body || {};

    if (!generationId || !['save', 'unsave'].includes(action)) {
      return res.status(400).json(formatApiResponse('error', 'Invalid payload', null));
    }

    await engagementRepository.toggleEngagement(
      'bookmark',
      uid,
      String(generationId),
      action === 'save' ? 'add' : 'remove'
    );

    return res.json(formatApiResponse('success', 'OK', null));
  } catch (error) {
    return next(error);
  }
}

export async function bulkStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = getUid(req);
    const { generationIds } = req.body || {};

    if (!Array.isArray(generationIds) || generationIds.length === 0) {
      return res.status(400).json(formatApiResponse('error', 'generationIds must be a non-empty array', null));
    }

    // Hard cap to keep the request fast
    const ids = generationIds.slice(0, 100).map(String);

    const items = await engagementRepository.getBulkStatus(uid, ids);

    return res.json(formatApiResponse('success', 'OK', { items }));
  } catch (error) {
    return next(error);
  }
}

export async function listMyLikes(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = getUid(req);
    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    const result = await engagementRepository.listUserEngagement('like', uid, limit, cursor);

    return res.json(
      formatApiResponse('success', 'OK', {
        items: result.items,
        nextCursor: result.nextCursor,
      })
    );
  } catch (error) {
    return next(error);
  }
}

export async function listMyBookmarks(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = getUid(req);
    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100);
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    const result = await engagementRepository.listUserEngagement('bookmark', uid, limit, cursor);

    return res.json(
      formatApiResponse('success', 'OK', {
        items: result.items,
        nextCursor: result.nextCursor,
      })
    );
  } catch (error) {
    return next(error);
  }
}

export const engagementController = {
  toggleLike,
  toggleBookmark,
  bulkStatus,
  listMyLikes,
  listMyBookmarks,
};


