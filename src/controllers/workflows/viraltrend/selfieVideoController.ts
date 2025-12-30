import { Request, Response, NextFunction } from 'express';
import { generateSelfieVideoImage, GenerateSelfieVideoImageRequest } from '../../../services/workflows/viraltrend/selfieVideoService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { formatApiResponse } from '../../../utils/formatApiResponse';

/**
 * Controller for generating selfie video images
 */
export async function generateImage(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = (req as any).uid;
        if (!uid) {
            throw new ApiError('User not authenticated', 401);
        }

        const { selfieImageUrl, friendImageUrl, frameSize, customBackground, customClothes } = req.body;

        // Validate required fields
        if (!selfieImageUrl || !friendImageUrl) {
            throw new ApiError('selfieImageUrl and friendImageUrl are required', 400);
        }

        if (!frameSize || !['vertical', 'horizontal'].includes(frameSize)) {
            throw new ApiError('frameSize must be either "vertical" or "horizontal"', 400);
        }

        // Build request payload explicitly so TypeScript uses the exported interface
        const requestPayload: GenerateSelfieVideoImageRequest = {
            selfieImageUrl,
            friendImageUrl,
            frameSize,
            customBackground,
            customClothes,
        };

        // Generate image
        const result = await generateSelfieVideoImage(uid, requestPayload);

        // Compute image cost (46 credits per generated image)
        const IMAGE_COST = 46;
        const ctx: any = { creditCost: IMAGE_COST };
        // Perform debit (idempotent via historyId returned from service)
        const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'generate');

        const responseData = {
            requestId: result?.historyId || null,
            historyId: result?.historyId || null,
            model: 'openai/gpt-image-1.5',
            status: 'submitted',
            expectedDebit: ctx.creditCost,
            debitedCredits: debitOutcome === 'WRITTEN' ? ctx.creditCost : 0,
            debitStatus: debitOutcome,
            message: 'Image generation started. Use /api/replicate/queue/result with requestId to check status.',
            // include the useful image fields as well
            imageUrl: result?.imageUrl,
            storagePath: result?.storagePath,
        };

        res.json(formatApiResponse('success', 'Submitted', responseData));
    } catch (error) {
        next(error);
    }
}
