import { Request, Response, NextFunction } from 'express';
import * as changeSeasonsService from '../../../services/workflows/fun/changeSeasonsService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';

export const handleChangeSeasons = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const uid = (req as any).uid;
        if (!uid) throw new ApiError("User not authenticated", 401);

        const { image, isPublic, seasonDescription } = req.body;

        if (!image) {
            throw new ApiError("Image is required", 400);
        }

        // We can allow blank description, but ideally the UI forces it or provides a default.
        // If blank, the service prompt will just say "Target Season: """, which might be weak.
        // Let's ensure we pass something or let the service handle the empty string gracefully.

        const result = await changeSeasonsService.changeSeasons(uid, {
            imageUrl: image,
            isPublic,
            seasonDescription: seasonDescription || "Winter" // Default fallback if needed, but UI should provide it.
        });

        // Credit deduction logic (90 credits for this workflow)
        const CREDIT_COST = 90;
        const ctx: { creditCost: number } = { creditCost: CREDIT_COST };
        await postSuccessDebit(uid, result, ctx, 'replicate', 'change-seasons');

        res.status(200).json({
            responseStatus: 'success',
            message: 'OK',
            data: result
        });
    } catch (error) {
        next(error);
    }
};
