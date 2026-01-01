import { Request, Response, NextFunction } from 'express';
import { creativelyUpscale, CreativelyUpscaleRequest } from '../../../services/workflows/general/creativelyUpscaleService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { probeImageMeta } from '../../../utils/media/imageProbe';
import { creditsService } from '../../../services/creditsService';
import { creditsRepository } from '../../../repository/creditsRepository';

/**
 * Controller for Creatively Upscale feature
 */
export async function creativelyUpscaleController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const { image, upscaleFactor } = req.body;

        if (!image) {
            throw new ApiError('image URL is required', 400);
        }

        const ZATA_PREFIX = 'https://idr01.zata.ai/devstoragev1/';
        const RESOURCE_SEG = '/api/proxy/resource/';

        const normalizeToZataUrl = (src: string): string => {
            const s = String(src || '').trim();
            if (!s) return s;
            if (s.startsWith(ZATA_PREFIX)) return s;
            if (s.startsWith(RESOURCE_SEG)) {
                const decoded = decodeURIComponent(s.substring(RESOURCE_SEG.length));
                return `${ZATA_PREFIX}${decoded}`;
            }
            if (s.startsWith('http://') || s.startsWith('https://')) {
                try {
                    const u = new URL(s);
                    if (u.pathname.startsWith(RESOURCE_SEG)) {
                        const decoded = decodeURIComponent(u.pathname.substring(RESOURCE_SEG.length));
                        return `${ZATA_PREFIX}${decoded}`;
                    }
                } catch { }
            }
            return s;
        };

        const normalizedImage = normalizeToZataUrl(String(image));

        const factor = upscaleFactor ? Number(upscaleFactor) : 2;
        const safeFactor = Math.max(1, Math.min(8, Math.round(Number.isFinite(factor) ? factor : 2)));

        // Pricing: 5 credits per output megapixel (rounded up, min 1)
        let meta: any;
        try {
            meta = await probeImageMeta(String(normalizedImage));
        } catch (e) {
            meta = null;
        }
        const inW = Number(meta?.width || 0);
        const inH = Number(meta?.height || 0);
        if (!Number.isFinite(inW) || !Number.isFinite(inH) || inW <= 0 || inH <= 0) {
            throw new ApiError('Unable to read image dimensions for pricing. Please use a public image URL (Zata) and avoid /api/proxy/resource links.', 400);
        }
        const outW = Math.max(1, Math.round(inW * safeFactor));
        const outH = Math.max(1, Math.round(inH * safeFactor));
        const mp = (outW * outH) / 1_000_000;
        const creditCost = Math.max(1, Math.ceil(mp * 5));

        // Ensure user credits are initialized and validate balance BEFORE calling the model
        await creditsService.ensureUserInit(uid);
        await creditsService.ensureLaunchDailyReset(uid);
        const creditBalance = await creditsRepository.readUserCredits(uid);
        if (creditBalance < creditCost) {
            return res.status(402).json({
                responseStatus: 'error',
                message: 'Payment Required',
                data: {
                    requiredCredits: creditCost,
                    currentBalance: creditBalance,
                    suggestion: 'Buy plan or reduce upscale factor',
                },
            });
        }

        const requestPayload: CreativelyUpscaleRequest = {
            imageUrl: normalizedImage,
            upscaleFactor: safeFactor,
        };

        // Service call
        const result = await creativelyUpscale(uid, requestPayload);

        const ctx: any = {
            creditCost,
            pricingVersion: 'seedvr_upscale_image_mp_v1_x5',
            meta: {
                model: 'fal-ai/seedvr/upscale/image',
                inW,
                inH,
                outW,
                outH,
                upscaleFactor: safeFactor,
                mp,
            },
        };

        const debitOutcome = await postSuccessDebit(uid, result, ctx, 'fal', 'creatively-upscale');

        const responseData = {
            images: [
                {
                    id: result.historyId || `fal-${Date.now()}`,
                    url: result.images[0].url,
                    storagePath: (result.images[0] as any).storagePath,
                    originalUrl: result.images[0].originalUrl
                }
            ],
            historyId: result.historyId,
            model: 'fal-ai/seedvr/upscale/image',
            status: 'completed'
        };

        res.json({
            responseStatus: 'success',
            message: 'OK',
            data: responseData
        });
    } catch (error) {
        next(error);
    }
}
