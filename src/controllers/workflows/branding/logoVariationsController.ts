import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { generateLogoVariations, LogoVariationsRequest } from '../../../services/workflows/branding/logoVariationsService';

export async function logoVariationsController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const {
            image,
            numVariations,
            prompt,
            isPublic
        } = req.body;

        if (!image) {
            throw new ApiError('Logo image is required', 400);
        }

        // Validate numVariations
        const count = parseInt(numVariations || '1', 10);
        if (isNaN(count) || count < 1 || count > 4) {
            throw new ApiError('Number of variations must be between 1 and 4', 400);
        }

        const requestPayload: LogoVariationsRequest = {
            image,
            numVariations: count,
            prompt: prompt || "",
            isPublic
        };

        // Service call
        const result = await generateLogoVariations(uid, requestPayload);

        // Credit deduction logic (90 credits per variation)
        const CREDIT_COST = 90 * count;
        const ctx: any = { creditCost: CREDIT_COST };

        console.log(`[logoVariationsController] Calling postSuccessDebit for uid=${uid} historyId=${result.historyId} cost=${CREDIT_COST}`);
        const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'logo-variations');
        console.log(`[logoVariationsController] postSuccessDebit outcome: ${debitOutcome}`);

        const responseData = {
            images: result.images,
            historyId: result.historyId,
            model: result.model,
            status: 'completed',
            debug: {
                debitOutcome,
                creditCost: CREDIT_COST,
                historyId: result.historyId,
                uid
            }
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
