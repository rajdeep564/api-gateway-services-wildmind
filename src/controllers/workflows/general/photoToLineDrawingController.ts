import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { photoToLineDrawing, PhotoToLineDrawingRequest } from '../../../services/workflows/general/photoToLineDrawingService';

export async function photoToLineDrawingController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const { image, prompt } = req.body;

        if (!image) {
            throw new ApiError('image URL is required', 400);
        }

        const requestPayload: PhotoToLineDrawingRequest = {
            imageUrl: image,
            prompt: prompt
        };

        // Service call
        const result = await photoToLineDrawing(uid, requestPayload);

        // Credit deduction logic (Same as Restore Old Photo: 80 credits)
        const CREDIT_COST = 90;
        const ctx: any = { creditCost: CREDIT_COST };

        await postSuccessDebit(uid, result, ctx, 'replicate', 'photo-to-line-drawing');

        const responseData = {
            images: result.images, // Array from service
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
