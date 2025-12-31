import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { removeElement, RemoveElementRequest } from '../../../services/workflows/general/removeElementService';

export async function removeElementController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const { image, prompt } = req.body;

        if (!image) {
            throw new ApiError('image URL is required', 400);
        }

        if (!prompt) {
            throw new ApiError('Please specify what to remove', 400);
        }

        const requestPayload: RemoveElementRequest = {
            imageUrl: image,
            prompt: prompt
        };

        // Service call
        const result = await removeElement(uid, requestPayload);

        // Credit deduction logic (80 credits)
        const CREDIT_COST = 80;
        const ctx: any = { creditCost: CREDIT_COST };

        await postSuccessDebit(uid, result, ctx, 'replicate', 'remove-element');

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
