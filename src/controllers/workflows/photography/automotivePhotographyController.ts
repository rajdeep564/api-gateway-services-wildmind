import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { generateAutomotiveShot, AutomotiveRequest } from '../../../services/workflows/photography/automotivePhotographyService';

export async function automotivePhotographyController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const {
            carImage,
            background,
            lighting,
            motionBlur,
            isPublic
        } = req.body;

        if (!carImage) {
            throw new ApiError('Car image is required', 400);
        }

        const requestPayload: AutomotiveRequest = {
            carImage,
            background: background || 'urban',
            lighting: lighting || 'golden-hour',
            motionBlur: motionBlur || 'Medium',
            isPublic
        };

        // Service call
        const result = await generateAutomotiveShot(uid, requestPayload);

        // Credit deduction logic (90 credits)
        const CREDIT_COST = 90;
        const ctx: any = { creditCost: CREDIT_COST };

        console.log(`[automotivePhotographyController] Calling postSuccessDebit for uid=${uid} historyId=${result.historyId} cost=${CREDIT_COST}`);
        const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'automotive');
        console.log(`[automotivePhotographyController] postSuccessDebit outcome: ${debitOutcome}`);

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
