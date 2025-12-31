import { Request, Response, NextFunction } from 'express';
import * as becomeCelebrityService from '../../../services/workflows/fun/becomeCelebrityService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';

export const handleBecomeCelebrity = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const uid = (req as any).uid;
        if (!uid) throw new ApiError("User not authenticated", 401);

        const { image, prompt, frameSize, output_format, isPublic, style } = req.body;

        if (!image) {
            throw new ApiError("Image is required", 400);
        }

        const result = await becomeCelebrityService.becomeCelebrity(uid, {
            imageUrl: image,
            prompt,
            frameSize,
            output_format,
            isPublic,
            style
        });

        // Credit deduction logic (80 credits for this premium workflow)
        const CREDIT_COST = 80;
        const ctx: any = { creditCost: CREDIT_COST };
        await postSuccessDebit(uid, result, ctx, 'replicate', 'become-celebrity');

        res.status(200).json({
            responseStatus: 'success',
            message: 'OK',
            data: result
        });
    } catch (error) {
        next(error);
    }
};
