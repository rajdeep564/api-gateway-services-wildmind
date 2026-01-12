import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { generateMockup, MockupGenerationRequest } from '../../../services/workflows/branding/mockupGenerationService';

export async function mockupGenerationController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const {
            image,
            productType,
            prompt,
            isPublic
        } = req.body;

        if (!image) {
            throw new ApiError('Logo image is required', 400);
        }

        if (!productType) {
            throw new ApiError('Product type is required', 400);
        }

        const requestPayload: MockupGenerationRequest = {
            image,
            productType,
            prompt: prompt || "",
            isPublic
        };

        // Service call
        const result = await generateMockup(uid, requestPayload);

        // Credit deduction logic (90 credits)
        const CREDIT_COST = 90;
        const ctx: any = { creditCost: CREDIT_COST };

        console.log(`[mockupGenerationController] Calling postSuccessDebit for uid=${uid} historyId=${result.historyId} cost=${CREDIT_COST}`);
        const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'mockup-generation');
        console.log(`[mockupGenerationController] postSuccessDebit outcome: ${debitOutcome}`);

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
