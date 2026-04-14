import { Request, Response, NextFunction } from 'express';
import { queryCanvasPrompt } from '../../services/promptEnhancerService';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { postSuccessDebit } from '../../utils/creditDebit';

/**
 * POST /api/canvas/query
 * Query endpoint for canvas prompt enhancement.
 * When reference_image_urls are provided, the backend uses vision (Gemini) to understand the images and produce a better prompt/answer.
 *
 * Request body:
 * {
 *   "text": "user message here",
 *   "max_new_tokens": 300 (optional),
 *   "reference_image_urls": ["https://...", "data:image/jpeg;base64,..."] (optional)
 * }
 */
export async function queryCanvas(req: Request, res: Response, next: NextFunction) {
  try {
    const { text, max_new_tokens, reference_image_urls } = req.body || {};

    if (!text || typeof text !== 'string') {
      return res.status(400).json(
        formatApiResponse('error', 'text is required and must be a string', null)
      );
    }

    if (max_new_tokens !== undefined) {
      if (typeof max_new_tokens !== 'number' || max_new_tokens < 1 || max_new_tokens > 2000) {
        return res.status(400).json(
          formatApiResponse('error', 'max_new_tokens must be a number between 1 and 2000', null)
        );
      }
    }

    const referenceImageUrls = Array.isArray(reference_image_urls)
      ? reference_image_urls.filter((u: unknown) => typeof u === 'string' && (u as string).trim())
      : [];

    // [CanvasPlan] Backend log: canvas query request (used for intent, clarification, prompt enhancement)
    console.log('[CanvasPlan][BACKEND] canvas/query request', {
      textLength: text.length,
      textPreview: text.slice(0, 120) + (text.length > 120 ? '...' : ''),
      max_new_tokens: max_new_tokens,
      referenceImageUrlsCount: referenceImageUrls.length,
      hasVision: referenceImageUrls.length > 0,
    });

    const result = await queryCanvasPrompt(text, max_new_tokens, { referenceImageUrls });

    // [CanvasPlan] Backend log: canvas/query result
    const responsePreview = typeof result?.response === 'string' ? result.response.slice(0, 100) + (result.response.length > 100 ? '...' : '') : '';
    console.log('[CanvasPlan][BACKEND] canvas/query result', {
      type: result?.type,
      responseLength: typeof result?.response === 'string' ? result.response.length : 0,
      responsePreview,
      enhanced_promptLength: typeof result?.enhanced_prompt === 'string' ? result.enhanced_prompt.length : 0,
    });

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

/**
 * POST /api/canvas/plan-log
 * Receives plan execution details from the frontend and logs them so you can see
 * which nodes were created and which node connects to which (backend logs).
 * Body: { planId, summaryPreview?, steps?: [...], executions?: { stepId, nodeType, nodeIds[], connections?: { from, to, label }[] } }
 */
export async function logPlanExecution(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body || {};
    const { planId, summaryPreview, steps, executions } = body;

    // [CanvasPlan] Structured backend log: what plan was built and what was executed
    console.log('[CanvasPlan][BACKEND] ========== PLAN LOG ==========');
    console.log('[CanvasPlan][BACKEND] planId:', planId || '(none)');
    if (summaryPreview) {
      console.log('[CanvasPlan][BACKEND] summaryPreview:', typeof summaryPreview === 'string' ? summaryPreview.slice(0, 300) + (summaryPreview.length > 300 ? '...' : '') : summaryPreview);
    }
    if (Array.isArray(steps) && steps.length > 0) {
      console.log('[CanvasPlan][BACKEND] steps count:', steps.length);
      steps.forEach((s: any, i: number) => {
        const stepLog: Record<string, unknown> = {
          index: i + 1,
          id: s.id,
          action: s.action,
          nodeType: s.nodeType,
          count: s.count,
        };
        if (s.configTemplate?.connectToFrames) {
          stepLog.connectToFrames = s.configTemplate.connectToFrames;
        }
        if (s.configTemplate?.firstFrameId) stepLog.firstFrameId = s.configTemplate.firstFrameId;
        if (s.configTemplate?.lastFrameId) stepLog.lastFrameId = s.configTemplate.lastFrameId;
        console.log('[CanvasPlan][BACKEND]   step:', JSON.stringify(stepLog));
      });
    }
    if (Array.isArray(executions) && executions.length > 0) {
      console.log('[CanvasPlan][BACKEND] executions count:', executions.length);
      executions.forEach((e: any, i: number) => {
        console.log('[CanvasPlan][BACKEND]   execution', i + 1, '| stepId:', e.stepId, '| nodeType:', e.nodeType, '| nodeIds:', e.nodeIds);
        if (Array.isArray(e.connections) && e.connections.length > 0) {
          e.connections.forEach((c: any) => {
            console.log('[CanvasPlan][BACKEND]     connection: ', c.from, ' --> ', c.to, c.label ? ` (${c.label})` : '');
          });
        }
      });
    }
    console.log('[CanvasPlan][BACKEND] ========== END PLAN LOG ==========');

    res.status(204).send();
  } catch (err: any) {
    console.error('[CanvasPlan][BACKEND] plan-log error:', err);
    next(err);
  }
}

export default { queryCanvas, generateScenes, logPlanExecution };

