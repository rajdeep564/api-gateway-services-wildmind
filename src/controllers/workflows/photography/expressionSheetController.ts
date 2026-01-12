import { Request, Response, NextFunction } from 'express';
import { generateExpressionSheet, ExpressionSheetRequest } from '../../../services/workflows/photography/expressionSheetService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';

/**
 * Controller for generating expression sheets
 */
export async function expressionSheetController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const { image, isPublic } = req.body;

        if (!image) {
            throw new ApiError('image URL is required', 400);
        }

        const requestPayload: ExpressionSheetRequest = {
            imageUrl: image,
            isPublic: isPublic
        };

        // Service call
        const result = await generateExpressionSheet(uid, requestPayload);

        // Credit deduction logic - 90 credits as requested
        const CREDIT_COST = 90;
        const ctx: any = { creditCost: CREDIT_COST };

        console.log(`[expressionSheetController] Calling postSuccessDebit for uid=${uid} historyId=${result.historyId} cost=${CREDIT_COST}`);
        const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'expression-sheet');
        console.log(`[expressionSheetController] postSuccessDebit outcome: ${debitOutcome}`);

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
