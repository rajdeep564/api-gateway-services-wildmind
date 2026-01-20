import { Request, Response, NextFunction } from 'express';
import * as polaroidStyleService from '../../../services/workflows/fun/polaroidStyleService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';

export const handlePolaroidStyle = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const uid = (req as any).uid;
        if (!uid) throw new ApiError("User not authenticated", 401);

        const { image, isPublic } = req.body;

        if (!image) {
            throw new ApiError("Image is required", 400);
        }

        const result = await polaroidStyleService.polaroidStyle(uid, {
            imageUrl: image,
            isPublic
        });

        // Credit deduction logic (90 credits for this workflow)
        const CREDIT_COST = 90;
        const ctx: { creditCost: number } = { creditCost: CREDIT_COST };
        await postSuccessDebit(uid, result, ctx, 'replicate', 'polaroid-style');

        res.status(200).json({
            responseStatus: 'success',
            message: 'OK',
            data: result
        });
    } catch (error) {
        next(error);
    }
};
