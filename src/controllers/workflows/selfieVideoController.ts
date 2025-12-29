import { Request, Response, NextFunction } from 'express';
import { generateSelfieVideoImage } from '../../services/workflows/selfieVideoService';
import { ApiError } from '../../utils/errorHandler';

/**
 * Controller for generating selfie video images
 */
export async function generateImage(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const { selfieImageUrl, friendImageUrl, frameSize, customBackground } = req.body;

        // Validate required fields
        if (!selfieImageUrl || !friendImageUrl) {
            throw new ApiError('selfieImageUrl and friendImageUrl are required', 400);
        }

        if (!frameSize || !['vertical', 'horizontal'].includes(frameSize)) {
            throw new ApiError('frameSize must be either "vertical" or "horizontal"', 400);
        }

        // Generate image
        const result = await generateSelfieVideoImage(uid, {
            selfieImageUrl,
            friendImageUrl,
            frameSize,
            customBackground,
        });

        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        next(error);
    }
}
