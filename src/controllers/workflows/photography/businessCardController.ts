import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { generateBusinessCard, BusinessCardRequest } from '../../../services/workflows/photography/businessCardService';

export async function businessCardController(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const {
            logo,
            companyName,
            personName,
            designation,
            contact,
            style,
            color,
            sides,
            isPublic,
        } = req.body as BusinessCardRequest;

        // Basic validation
        if (!logo) throw new ApiError('Logo image is required', 400);
        if (!companyName) throw new ApiError('Company name is required', 400);
        if (!personName) throw new ApiError('Person name is required', 400);
        if (!designation) throw new ApiError('Designation is required', 400);
        if (!contact) throw new ApiError('Contact details are required', 400);
        if (!style) throw new ApiError('Style is required', 400);
        if (!color) throw new ApiError('Color is required', 400);
        const sideCount = sides === 2 ? 2 : 1;

        const requestPayload: BusinessCardRequest = {
            logo,
            companyName,
            personName,
            designation,
            contact,
            style,
            color,
            sides: sideCount,
            isPublic,
        };

        const result = await generateBusinessCard(uid, requestPayload);

        // Credit deduction: 90 per side
        const CREDIT_COST = 90 * sideCount;
        const ctx: any = { creditCost: CREDIT_COST };
        const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'business-card');

        const responseData = {
            images: result.images,
            historyId: result.historyId,
            model: result.model,
            status: 'completed',
            debug: {
                debitOutcome,
                creditCost: CREDIT_COST,
                historyId: result.historyId,
                uid,
            },
        };

        res.json({
            responseStatus: 'success',
            message: 'OK',
            data: responseData,
        });
    } catch (error) {
        next(error);
    }
}
