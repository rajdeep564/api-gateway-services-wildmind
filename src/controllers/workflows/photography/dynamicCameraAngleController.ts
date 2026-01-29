import { Request, Response, NextFunction } from 'express';
import * as dynamicCameraAngleService from '../../../services/workflows/photography/dynamicCameraAngleService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';

export const handleDynamicCameraAngle = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const uid = (req as any).uid;
        if (!uid) throw new ApiError("User not authenticated", 401);

        const { image, angle, additionalDetails, isPublic } = req.body;

        if (!image) {
            throw new ApiError("Image is required", 400);
        }

        if (!angle) {
            throw new ApiError("Angle is required", 400);
        }

        const result = await dynamicCameraAngleService.generateDynamicAngle(uid, {
            imageUrl: image,
            angle,
            additionalDetails,
            isPublic
        });

        // Credit deduction logic (90 credits)
        const CREDIT_COST = 90;
        const ctx: { creditCost: number } = { creditCost: CREDIT_COST };
        await postSuccessDebit(uid, result, ctx, 'replicate', 'dynamic-camera-angle');

        res.status(200).json({
            responseStatus: 'success',
            message: 'OK',
            data: result
        });
    } catch (error) {
        next(error);
    }
};
