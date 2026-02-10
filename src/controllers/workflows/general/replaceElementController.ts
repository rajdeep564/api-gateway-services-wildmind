import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { replaceElement, ReplaceElementRequest } from '../../../services/workflows/general/replaceElementService';

export async function replaceElementController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const { image, from, to } = req.body;

        if (!image) {
            throw new ApiError('image URL is required', 400);
        }

        if (!from) {
            throw new ApiError('Please specify the object to replace', 400);
        }

        if (!to) {
            throw new ApiError('Please specify the object to replace with', 400);
        }

        const requestPayload: ReplaceElementRequest = {
            imageUrl: image,
            from: from,
            to: to
        };

        // Service call
        const result = await replaceElement(uid, requestPayload);

        // Credit deduction logic (80 credits)
        const CREDIT_COST = 90;
        const ctx: any = { creditCost: CREDIT_COST };

        await postSuccessDebit(uid, result, ctx, 'replicate', 'replace-element');

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
