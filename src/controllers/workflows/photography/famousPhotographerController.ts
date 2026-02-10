import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { generateFamousPhotographer, FamousPhotographerRequest } from '../../../services/workflows/photography/famousPhotographerService';

export async function famousPhotographerController(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      throw new ApiError('User not authenticated', 401);
    }

    const {
      sourceImage,
      style,
      isPublic
    } = req.body;

    if (!sourceImage) {
      throw new ApiError('Source image is required', 400);
    }

    const requestPayload: FamousPhotographerRequest = {
      sourceImage,
      style,
      isPublic
    };

    // Service call
    const result = await generateFamousPhotographer(uid, requestPayload);

    // Credit deduction logic (90 credits)
    const CREDIT_COST = 90;
    const ctx: any = { creditCost: CREDIT_COST };

    console.log(`[famousPhotographerController] Calling postSuccessDebit for uid=${uid} historyId=${result.historyId} cost=${CREDIT_COST}`);
    const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'famous-photographer');
    console.log(`[famousPhotographerController] postSuccessDebit outcome: ${debitOutcome}`);

    const responseData = {
      images: result.images,
      historyId: result.historyId,
      model: result.model,
      status: 'completed',
      debug: {
        debitOutcome,
        creditCost: CREDIT_COST,
        historyId: result.historyId,
        uid
      }
    };

    res.json({
      responseStatus: 'success',
      message: 'OK',
      data: responseData
    });
  } catch (error) {
    next(error);
  }
}
