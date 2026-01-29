import { Request, Response, NextFunction } from 'express';
import * as customStickersService from '../../../services/workflows/fun/customStickersService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';

export const handleCustomStickers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const uid = (req as any).uid;
        if (!uid) throw new ApiError("User not authenticated", 401);

        const { image, isPublic, shape, style, theme, material, details, stickerType, fileStyle } = req.body;

        if (!image) {
            throw new ApiError("Image is required", 400);
        }

        const result = await customStickersService.customStickers(uid, {
            imageUrl: image,
            isPublic,
            shape,
            style,
            theme,
            material,
            details,
            stickerType,
            fileStyle
        });

        // Credit deduction logic (90 credits for this workflow)
        const CREDIT_COST = 90;
        const ctx: { creditCost: number } = { creditCost: CREDIT_COST };
        await postSuccessDebit(uid, result, ctx, 'replicate', 'custom-stickers');

        res.status(200).json({
            responseStatus: 'success',
            message: 'OK',
            data: result
        });
    } catch (error) {
        next(error);
    }
};
