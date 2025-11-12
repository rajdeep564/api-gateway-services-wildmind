import { Request, Response, NextFunction } from 'express';
import { generationHistoryService } from '../services/generationHistoryService';
import { formatApiResponse } from '../utils/formatApiResponse';

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
		const uid = (req as any).uid;
		const { limit = 20, cursor, nextCursor, status, generationType, sortBy, sortOrder, mode, dateStart, dateEnd, search, debug } = req.query as any;
		
		// Support grouped mode for convenience (e.g., mode=video)
		let generationTypeFilter: string | string[] | undefined = generationType;
		if (typeof mode === 'string' && mode.toLowerCase() === 'video') {
			generationTypeFilter = ['text-to-video', 'image-to-video', 'video-to-video'];
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
			sortBy: sortBy || undefined,
			sortOrder: sortOrder || undefined,
			dateStart: dateStart || undefined,
			dateEnd: dateEnd || undefined,
			search: search || undefined,
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
    const result = await generationHistoryService.softDelete(uid, historyId);
    return res.json(formatApiResponse('success', 'Deleted', result));
  } catch (err) {
    return next(err);
  }
}

async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const { historyId } = req.params as any;
    const updates = req.body as any;
    // Allow per-media privacy updates: image/video payloads are forwarded verbatim
    const result = await generationHistoryService.update(uid, historyId, updates);
    return res.json(formatApiResponse('success', 'Updated', result));
  } catch (err) {
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
