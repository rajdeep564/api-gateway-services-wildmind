import { Request, Response, NextFunction } from 'express';
import { queryCanvasPrompt } from '../../services/promptEnhancerService';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { postSuccessDebit } from '../../utils/creditDebit';

/**
 * POST /api/canvas/query
 * Query endpoint for canvas prompt enhancement
 * 
 * Request body:
 * {
 *   "text": "user message here",
 *   "max_new_tokens": 300 (optional)
 * }
 * 
 * Response:
 * {
 *   "type": "image" | "video" | "music" | "answer",
 *   "enhanced_prompt": "Enhanced prompt text..." | null,
 *   "response": "Answer text..." | null
 * }
 */
export async function queryCanvas(req: Request, res: Response, next: NextFunction) {
  try {
    const { text, max_new_tokens } = req.body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json(
        formatApiResponse('error', 'text is required and must be a string', null)
      );
    }

    // Validate max_new_tokens if provided
    if (max_new_tokens !== undefined) {
      if (typeof max_new_tokens !== 'number' || max_new_tokens < 1 || max_new_tokens > 2000) {
        return res.status(400).json(
          formatApiResponse('error', 'max_new_tokens must be a number between 1 and 2000', null)
        );
      }
    }

    const result = await queryCanvasPrompt(text, max_new_tokens);

    return res.json(formatApiResponse('success', 'Query processed successfully', result));
  } catch (err: any) {
    console.error('[Canvas Query Controller] Error:', err);
    next(err);
  }
}

export async function generateScenes(req: Request, res: Response, next: NextFunction) {
  try {
    const { story } = req.body || {};

    if (!story || typeof story !== 'string') {
      return res.status(400).json(
        formatApiResponse('error', 'story is required and must be a string', null)
      );
    }

    // Dynamic import to avoid circular deps if any
    const { generateScenesFromStory } = require('../../services/promptEnhancerService');
    const result = await generateScenesFromStory(story);

    const uid = (req as any).uid;
    const ctx = (req as any).context || {};
    const debitOutcome = await postSuccessDebit(uid, result, ctx, 'canvas', 'generate-scenes');

    return res.json(formatApiResponse('success', 'Scenes generated successfully', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
  } catch (err: any) {
    console.error('[Generate Scenes Controller] Error:', err);
    next(err);
  }
}

export default { queryCanvas, generateScenes };

