import { Request, Response, NextFunction } from 'express';
import * as relightingService from '../../../services/workflows/fun/relightingService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';

export const handleRelighting = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const uid = (req as any).uid;
        if (!uid) throw new ApiError("User not authenticated", 401);

        const { image, isPublic, lightingStyle } = req.body;

        if (!image) {
            throw new ApiError("Image is required", 400);
        }

        const result = await relightingService.relighting(uid, {
            imageUrl: image,
            isPublic,
            lightingStyle: lightingStyle || "Natural"
        });

        // Credit deduction logic (90 credits for this workflow)
        const CREDIT_COST = 90;
        const ctx: { creditCost: number } = { creditCost: CREDIT_COST };
        await postSuccessDebit(uid, result, ctx, 'replicate', 'relighting');

        res.status(200).json({
            responseStatus: 'success',
            message: 'OK',
            data: result
        });
    } catch (error) {
        next(error);
    }
};
