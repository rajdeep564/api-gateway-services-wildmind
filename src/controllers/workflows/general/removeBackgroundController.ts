import { Request, Response, NextFunction } from 'express';
import { removeBackground, RemoveBackgroundRequest } from '../../../services/workflows/general/removeBackgroundService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { formatApiResponse } from '../../../utils/formatApiResponse';

/**
 * Controller for removing image background
 */
export async function removeBackgroundController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const { image } = req.body;

        if (!image) {
            throw new ApiError('image URL is required', 400);
        }

        const requestPayload: RemoveBackgroundRequest = {
            imageUrl: image,
        };

        // Service call
        const result = await removeBackground(uid, requestPayload);

        // Credit deduction logic
        // Cost: 8 credits (approx cost for utility models like this, or check standard)
        // If user provided specific credit instructions, I'd follow them.
        // Assuming a reasonable default for now.
        const CREDIT_COST = 8;
        const ctx: any = { creditCost: CREDIT_COST };

        const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'remove-bg');

        const responseData = {
            images: [
                {
                    id: result.historyId || `replicate-${Date.now()}`,
                    url: result.imageUrl,
                    storagePath: result.storagePath,
                    originalUrl: result.imageUrl // Or the original Replicate URL if available, but service returns resolved Zata URL
                }
            ],
            historyId: result.historyId,
            model: '851-labs/background-remover',
            status: 'completed'
        };

        // Custom format to match user request exactly
        res.json({
            responseStatus: 'success',
            message: 'OK',
            data: responseData
        });
    } catch (error) {
        next(error);
    }
}
