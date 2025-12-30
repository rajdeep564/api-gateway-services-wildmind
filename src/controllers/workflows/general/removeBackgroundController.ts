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
            requestId: result?.historyId || null,
            historyId: result?.historyId || null,
            model: '851-labs/background-remover',
            status: 'succeeded',
            expectedDebit: ctx.creditCost,
            debitedCredits: debitOutcome === 'WRITTEN' ? ctx.creditCost : 0,
            debitStatus: debitOutcome,
            imageUrl: result.imageUrl,
            storagePath: result.storagePath,
        };

        res.json(formatApiResponse('success', 'Background removed successfully', responseData));
    } catch (error) {
        next(error);
    }
}
