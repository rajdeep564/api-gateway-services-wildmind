import { Request, Response, NextFunction } from 'express';
import { reimagineProduct, ReimagineProductRequest } from '../../../services/workflows/photography/reimagineProductService';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { creditsService } from '../../../services/creditsService';
import { creditsRepository } from '../../../repository/creditsRepository';

/**
 * Controller for Reimagine Product (Dynamic Camera Angle)
 */
export async function reimagineProductController(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      throw new ApiError('User not authenticated', 401);
    }

    const { image, angle, additionalDetails, isPublic } = req.body;

    if (!image) {
      throw new ApiError('image URL is required', 400);
    }

    const creditCost = 90; // Fixed cost for this workflow as per frontend data.js

    // Ensure user credits are initialized
    await creditsService.ensureUserInit(uid);
    await creditsService.ensureLaunchDailyReset(uid);

    const creditBalance = await creditsRepository.readUserCredits(uid);
    if (creditBalance < creditCost) {
      return res.status(402).json({
        responseStatus: 'error',
        message: 'Insufficient credits',
        data: {
          requiredCredits: creditCost,
          currentBalance: creditBalance
        },
      });
    }

    const requestPayload: ReimagineProductRequest = {
      imageUrl: image,
      angle: angle || 'Eye-Level',
      additionalDetails,
      isPublic: isPublic !== false // default to public if not specified
    };

    // Service call
    const result = await reimagineProduct(uid, requestPayload);

    const ctx: any = {
      creditCost,
      pricingVersion: 'qwen_reimagine_product_v1',
      meta: {
        model: 'qwen/qwen-image-edit-2511',
        angle: requestPayload.angle,
        operation: 'reimagine-product'
      },
    };

    await postSuccessDebit(uid, result, ctx, 'replicate', 'reimagine-product');

    res.json({
      responseStatus: 'success',
      message: 'OK',
      data: result
    });
  } catch (error) {
    next(error);
  }
}
