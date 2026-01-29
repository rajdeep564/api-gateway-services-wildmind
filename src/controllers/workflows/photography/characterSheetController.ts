import { Request, Response, NextFunction } from 'express';
import { generateCharacterSheet, CharacterSheetRequest } from '../../../services/workflows/photography/characterSheetService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';

/**
 * Controller for generating character sheets
 */
export async function characterSheetController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const { image, isPublic } = req.body;

        if (!image) {
            throw new ApiError('image URL is required', 400);
        }

        const requestPayload: CharacterSheetRequest = {
            imageUrl: image,
            isPublic: isPublic
        };

        // Service call
        const result = await generateCharacterSheet(uid, requestPayload);

        // Credit deduction logic - 90 credits
        const CREDIT_COST = 90;
        const ctx: any = { creditCost: CREDIT_COST };

        console.log(`[characterSheetController] Calling postSuccessDebit for uid=${uid} historyId=${result.historyId} cost=${CREDIT_COST}`);
        const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'character-sheet');
        console.log(`[characterSheetController] postSuccessDebit outcome: ${debitOutcome}`);

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
