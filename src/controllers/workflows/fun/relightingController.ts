import { Request, Response, NextFunction } from 'express';
import * as relightingService from '../../../services/workflows/fun/relightingService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';

export const handleRelighting = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const uid = (req as any).uid;
        if (!uid) throw new ApiError("User not authenticated", 401);

        const {
            image,
            isPublic,
            lightingStyle,
            additionalText,
            lightDirection,
            lightIntensity,
            shadowControl,
            lighting,
            prompt,
            referenceImageUri,
            alphaMode,
            alphaUri,
            maxResolution,
            lightingOnly,
        } = req.body;

        if (!image) {
            throw new ApiError("Image is required", 400);
        }
        const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
        if (!normalizedPrompt) {
            throw new ApiError("Prompt is required", 400);
        }
        if (normalizedPrompt.length > 2000) {
            throw new ApiError("Prompt must be 2000 characters or fewer", 400);
        }

        const result = await relightingService.relighting(uid, {
            imageUrl: image,
            isPublic,
            lightingStyle: lightingStyle || "Natural",
            additionalText,
            lightDirection,
            lightIntensity,
            shadowControl,
            lighting,
            beeblePrompt: normalizedPrompt,
            referenceImageUri,
            alphaMode,
            alphaUri,
            maxResolution,
            lightingOnly: lightingOnly === true || lightingOnly === 'true',
        });

        // Credit deduction logic (90 credits for this workflow)
        const CREDIT_COST = 90;
        const ctx: { creditCost: number } = { creditCost: CREDIT_COST };
        await postSuccessDebit(uid, result, ctx, 'beeble', 'relighting');

        res.status(200).json({
            responseStatus: 'success',
            message: 'OK',
            data: result
        });
    } catch (error) {
        next(error);
    }
};
