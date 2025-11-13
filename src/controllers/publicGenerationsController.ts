import { Request, Response, NextFunction } from 'express';
import { generationFilterService } from '../services/generationFilterService';
import { publicGenerationsRepository } from '../repository/publicGenerationsRepository';
import { formatApiResponse } from '../utils/formatApiResponse';
import { GenerationHistoryItem } from '../types/generate';

async function listPublic(req: Request, res: Response, next: NextFunction) {
	try {
		const params = await generationFilterService.validateAndTransformParams(req.query);
		const result = await generationFilterService.getPublicGenerations(params);
		try {
			const sample = (result?.items && result.items[0]) || null;
			if (sample) {
				const hasOptimized = Array.isArray((sample as any).images) && (sample as any).images.some((im: any) => im?.thumbnailUrl || im?.avifUrl);
				console.log('[Feed][listPublic] sample item', {
					id: (sample as any).id,
					imagesCount: Array.isArray((sample as any).images) ? (sample as any).images.length : 0,
					firstHasOptimized: hasOptimized,
				});
			}
		} catch {}
		return res.json(formatApiResponse('success', 'OK', result));
	} catch (err) {
		return next(err);
	}
}

async function getPublicById(req: Request, res: Response, next: NextFunction) {
	try {
		const { generationId } = req.params as any;
		const item: GenerationHistoryItem | null = await publicGenerationsRepository.getPublicById(generationId);
		if (!item) return res.status(404).json(formatApiResponse('error', 'Not found', {}));
		
		// Enrich createdBy with photoURL if missing
		if (item.createdBy?.uid && !item.createdBy.photoURL) {
			const { authRepository } = await import('../repository/auth/authRepository');
			const user = await authRepository.getUserById(item.createdBy.uid);
			if (user?.photoURL) {
				item.createdBy.photoURL = user.photoURL;
			}
		}
		
		return res.json(formatApiResponse('success', 'OK', { item }));
	} catch (err) {
		return next(err);
	}
}

export const publicGenerationsController = {
	listPublic,
	getPublicById,
};