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
		const { limit = 20, cursor, status, generationType, sortBy, sortOrder } = req.query as any;
		const result = await generationHistoryService.listUserGenerations(uid, { 
			limit: Number(limit), 
			cursor, 
			status, 
			generationType,
			sortBy,
			sortOrder 
		});
		return res.json(formatApiResponse('success', 'OK', result));
	} catch (err) {
		return next(err);
	}
}

export const generationHistoryController = {
	create,
	updateStatus,
	get,
	listMine,
};
