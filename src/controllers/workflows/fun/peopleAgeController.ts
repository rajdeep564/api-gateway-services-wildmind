import { Request, Response, NextFunction } from 'express';
import * as peopleAgeService from '../../../services/workflows/fun/peopleAgeService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';

export const handlePeopleAge = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const uid = (req as any).uid;
        if (!uid) throw new ApiError("User not authenticated", 401);

        const { image, targetAge, isPublic } = req.body;

        if (!image) {
            throw new ApiError("Image is required", 400);
        }

        if (!targetAge) {
            throw new ApiError("Target age is required", 400);
        }

        const result = await peopleAgeService.peopleAge(uid, {
            imageUrl: image,
            targetAge,
            isPublic
        });

        // Credit deduction logic (90 credits for this workflow)
        const CREDIT_COST = 90;
        const ctx: { creditCost: number } = { creditCost: CREDIT_COST };
        await postSuccessDebit(uid, result, ctx, 'replicate', 'people-age');

        res.status(200).json({
            responseStatus: 'success',
            message: 'OK',
            data: result
        });
    } catch (error) {
        next(error);
    }
};
