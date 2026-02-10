import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';
import { postSuccessDebit } from '../../../utils/creditDebit';
import { generateStoryboard, StoryboardRequest } from '../../../services/workflows/filmIndustry/storyboardService';

export async function storyboardController(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      throw new ApiError('User not authenticated', 401);
    }

    const {
      image,
      characterImages,
      storyScript,
      storyboardTitle,
      textVisibility,
      visualStyle,
      screenOrientation,
      isPublic
    } = req.body;

    const requestPayload: StoryboardRequest = {
      image,
      characterImages,
      storyScript,
      storyboardTitle,
      textVisibility,
      visualStyle,
      screenOrientation,
      isPublic
    };

    // Service call
    const result = await generateStoryboard(uid, requestPayload);

    // Credit deduction logic (90 credits)
    const CREDIT_COST = 90;
    const ctx: any = { creditCost: CREDIT_COST };

    console.log(`[storyboardController] Calling postSuccessDebit for uid=${uid} historyId=${result.generationId} cost=${CREDIT_COST}`);
    // Using generic provider/model for debit tracking
    const debitOutcome = await postSuccessDebit(uid, { historyId: result.generationId, model: 'storyboard' } as any, ctx, 'replicate', 'storyboard');

    const responseData = {
      images: result.images, // Use images directly from service
      historyId: result.generationId,
      status: 'completed',
      debug: {
        debitOutcome,
        creditCost: CREDIT_COST,
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
