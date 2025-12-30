import { Request, Response, NextFunction } from 'express';
import { generationFilterService } from '../services/generationFilterService';
import { publicGenerationsRepository } from '../repository/publicGenerationsRepository';
import { formatApiResponse } from '../utils/formatApiResponse';
import { GenerationHistoryItem } from '../types/generate';

async function listPublic(req: Request, res: Response, next: NextFunction) {
	try {
        console.log('[Feed][listPublic] Request params:', JSON.stringify(req.query));
		const params = await generationFilterService.validateAndTransformParams(req.query);
		const result = await generationFilterService.getPublicGenerations(params);
        console.log('[Feed][listPublic] Result count:', result?.items?.length || 0);
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
        console.error('[Feed][listPublic] Error:', err);
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

// Cache auto-population flag to prevent concurrent refreshes
let isRefreshingCache = false;

async function getRandomHighScoredImage(req: Request, res: Response, next: NextFunction) {
	try {
		// Use pre-computed cache from Firebase for INSTANT responses (< 1 second)
		const { signupImageCache } = await import('../repository/signupImageCache');
		
		const cachedImage = await signupImageCache.getRandomSignupImage();
		
		if (cachedImage) {
			// INSTANT response - no database queries! (< 100ms typically)
			res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600'); // 1 hour
			res.setHeader('X-Cache', 'HIT-FIREBASE');
			res.setHeader('X-Cache-Source', 'pre-computed');
			
			return res.json(formatApiResponse('success', 'OK', {
				imageUrl: cachedImage.imageUrl,
				prompt: cachedImage.prompt,
				generationId: cachedImage.generationId,
				creator: cachedImage.creator,
			}));
		}
		
		// Cache is empty - auto-populate in background (non-blocking)
		// Return a quick fallback response while cache populates
		if (!isRefreshingCache) {
			isRefreshingCache = true;
			// Populate cache in background (non-blocking)
			signupImageCache.refreshSignupImageCache().catch((error) => {
				console.error('[getRandomHighScoredImage] Background cache refresh failed:', error);
			}).finally(() => {
				isRefreshingCache = false;
			});
		}
		
		// Fallback: fetch one image from database (faster than waiting for full cache)
		console.log('[getRandomHighScoredImage] Cache empty, using fast fallback');
		const results = await publicGenerationsRepository.getRandomHighScoredImages(1);
		
		if (results.length === 0) {
			return res.status(404).json(formatApiResponse('error', 'No high-scored images found', null));
		}
		
		const result = results[0];
		
		// Skip enrichment for speed - just return the image
		res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
		res.setHeader('X-Cache', 'MISS-FALLBACK');
		
		return res.json(formatApiResponse('success', 'OK', result));
	} catch (err) {
		return next(err);
	}
}

async function refreshSignupImageCache(req: Request, res: Response, next: NextFunction) {
	try {
		// Admin endpoint to manually refresh the signup image cache
		const { signupImageCache } = await import('../repository/signupImageCache');
		
		console.log('[refreshSignupImageCache] Manual refresh triggered');
		const count = await signupImageCache.refreshSignupImageCache();
		
		return res.json(formatApiResponse('success', `Cache refreshed with ${count} images`, { count }));
	} catch (err) {
		return next(err);
	}
}

const publicGenerationsController = {
	listPublic,
	getPublicById,
	getRandomHighScoredImage,
	refreshSignupImageCache,
};

export { publicGenerationsController };