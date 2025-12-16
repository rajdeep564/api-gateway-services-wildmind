import { Request, Response, NextFunction } from 'express';
import { generationHistoryService } from '../services/generationHistoryService';
import { formatApiResponse } from '../utils/formatApiResponse';
import { normalizeMode } from '../utils/modeTypeMap';

async function create(req: Request, res: Response, next: NextFunction) {
	try {
		const uid = (req as any).uid;
		const result = await generationHistoryService.startGeneration(uid, req.body);
		return res.json(formatApiResponse('success', 'Generation started', result));
	} catch (err) {
		return next(err);
	}
}

async function updateStatus(req: Request, res: Response, next: NextFunction) {
	try {
		const uid = (req as any).uid;
		const { historyId } = req.params as any;
		const { status } = req.body as any;
		if (status === 'completed') {
			await generationHistoryService.markGenerationCompleted(uid, historyId, req.body);
			return res.json(formatApiResponse('success', 'Generation marked completed', {}));
		}
		if (status === 'failed') {
			await generationHistoryService.markGenerationFailed(uid, historyId, req.body);
			return res.json(formatApiResponse('success', 'Generation marked failed', {}));
		}
		return res.status(400).json(formatApiResponse('error', 'Invalid status', {}));
	} catch (err) {
		return next(err);
	}
}

async function get(req: Request, res: Response, next: NextFunction) {
	try {
		// Ensure per-user freshness; do not allow browser/proxy caching for item reads
		try {
			res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
			res.setHeader('Pragma', 'no-cache');
			res.setHeader('Expires', '0');
			res.setHeader('Vary', 'Authorization, Cookie');
		} catch {}
		const uid = (req as any).uid;
		const { historyId } = req.params as any;
		const item = await generationHistoryService.getUserGeneration(uid, historyId);
		if (!item) return res.status(404).json(formatApiResponse('error', 'Not found', {}));
		return res.json(formatApiResponse('success', 'OK', { item }));
	} catch (err) {
		return next(err);
	}
}

async function listMine(req: Request, res: Response, next: NextFunction) {
	try {
		// Ensure per-user freshness; do not allow browser/proxy caching for list reads
		try {
			res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
			res.setHeader('Pragma', 'no-cache');
			res.setHeader('Expires', '0');
			res.setHeader('Vary', 'Authorization, Cookie');
		} catch {}
		const uid = (req as any).uid;
		const { limit = 20, cursor, nextCursor, status, generationType, sortBy, sortOrder, sort, mode, dateStart, dateEnd, search, debug } = req.query as any;
		const normalizedMode = normalizeMode(mode);
		
		// Allow explicit generationType override, otherwise rely on mode down the chain
		const generationTypeFilter: string | string[] | undefined = generationType;
		
		// Handle new 'sort' parameter: 'oldest' or 'recent'
		// Map 'oldest' to sortBy='createdAt', sortOrder='asc'
		// Map 'recent' to sortBy='createdAt', sortOrder='desc'
		let finalSortBy = sortBy;
		let finalSortOrder = sortOrder;
		
		if (sort === 'oldest') {
			finalSortBy = 'createdAt';
			finalSortOrder = 'asc';
		} else if (sort === 'recent') {
			finalSortBy = 'createdAt';
			finalSortOrder = 'desc';
		}
		
		// Prefer optimized pagination: omit legacy sort fields unless explicitly provided.
		// Frontend now passes nextCursor (millis) for createdAt DESC pagination.
		const result = await generationHistoryService.listUserGenerations(uid, { 
			limit: Number(limit),
			// Legacy cursor only if explicitly provided (kept for backward compatibility)
			cursor: cursor || undefined,
			nextCursor: nextCursor || undefined,
			status, 
			generationType: generationTypeFilter as any,
			// Pass sortBy/sortOrder only if they were explicitly included to avoid disabling optimized path
			sortBy: finalSortBy || undefined,
			sortOrder: finalSortOrder || undefined,
			dateStart: dateStart || undefined,
			dateEnd: dateEnd || undefined,
			search: search || undefined,
			mode: normalizedMode,
			debug: debug || undefined,
		});
		
		return res.json(formatApiResponse('success', 'OK', result));
	} catch (err) {
		return next(err);
	}
}

async function softDelete(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const { historyId } = req.params as any;
    
    console.log('[Controller][softDelete] Request received:', {
      uid,
      historyId,
      method: req.method,
      path: req.path,
      timestamp: new Date().toISOString(),
    });
    
    const result = await generationHistoryService.softDelete(uid, historyId);
    
    const response = formatApiResponse('success', 'Deleted', result);
    console.log('[Controller][softDelete] Response:', {
      status: 'success',
      historyId,
      itemId: result.item?.id,
      isDeleted: result.item?.isDeleted,
      isPublic: result.item?.isPublic,
    });
    
    return res.json(response);
  } catch (err: any) {
    console.error('[Controller][softDelete] Error:', {
      error: err?.message || err,
      stack: err?.stack,
      historyId: req.params?.historyId,
      uid: (req as any)?.uid,
    });
    return next(err);
  }
}

async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const { historyId } = req.params as any;
    const updates = req.body as any;
    
    console.log('[Controller][update] Request received:', {
      uid,
      historyId,
      method: req.method,
      path: req.path,
      updates: {
        isPublic: updates.isPublic,
        visibility: updates.visibility,
        hasImageUpdate: !!updates.image,
        hasVideoUpdate: !!updates.video,
        otherFields: Object.keys(updates).filter(k => !['isPublic', 'visibility', 'image', 'video'].includes(k)),
      },
      timestamp: new Date().toISOString(),
    });
    
    // Allow per-media privacy updates: image/video payloads are forwarded verbatim
    const result = await generationHistoryService.update(uid, historyId, updates);
    
    const response = formatApiResponse('success', 'Updated', result);
    console.log('[Controller][update] Response:', {
      status: 'success',
      historyId,
      itemId: result.item?.id,
      isPublic: result.item?.isPublic,
      visibility: result.item?.visibility,
      isDeleted: result.item?.isDeleted,
    });
    
    return res.json(response);
  } catch (err: any) {
    console.error('[Controller][update] Error:', {
      error: err?.message || err,
      stack: err?.stack,
      historyId: req.params?.historyId,
      uid: (req as any)?.uid,
    });
    return next(err);
  }
}

export const generationHistoryController = {
	create,
	updateStatus,
	get,
  listMine,
  softDelete,
  update,
};
