import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { removeWatermark, RemoveWatermarkRequest } from '../../../services/workflows/general/removeWatermarkService';

export async function removeWatermarkController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const { image, prompt } = req.body;

        if (!image) {
            throw new ApiError('image URL is required', 400);
        }

        const requestPayload: RemoveWatermarkRequest = {
            imageUrl: image,
            prompt: prompt
        };

        // Service call
        const result = await removeWatermark(uid, requestPayload);

        // Credit deduction logic (80 credits)
        const CREDIT_COST = 90;
        const ctx: any = { creditCost: CREDIT_COST };

        await postSuccessDebit(uid, result, ctx, 'replicate', 'remove-watermark');

        const responseData = {
            images: result.images,
            historyId: result.historyId,
            model: result.model,
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
