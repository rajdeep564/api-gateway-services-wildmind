import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { generateReimagineProduct, ReimagineProductRequest } from '../../../services/workflows/photography/reimagineProductService';

export async function reimagineProductController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const {
            image,
            angle,
            additionalDetails,
            isPublic
        } = req.body;

        if (!image) {
            throw new ApiError('Product details (image) are required', 400);
        }

        const requestPayload: ReimagineProductRequest = {
            image,
            angle: angle || 'Eye-Level',
            additionalDetails,
            isPublic
        };

        // Service call
        const result = await generateReimagineProduct(uid, requestPayload);

        // Credit deduction logic (90 credits)
        const CREDIT_COST = 90;
        const ctx: any = { creditCost: CREDIT_COST };

        console.log(`[reimagineProductController] Calling postSuccessDebit for uid=${uid} historyId=${result.historyId} cost=${CREDIT_COST}`);
        const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'reimagine-product');
        console.log(`[reimagineProductController] postSuccessDebit outcome: ${debitOutcome}`);

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
