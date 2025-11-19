import { Request, Response } from 'express';
import { cursorAgentService } from '../../services/canvas/cursorAgentService';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';
import { CursorAgentInstruction } from '../../types/canvas';

export async function planAgentActions(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { instruction, projectId, context } = req.body;

    if (!instruction || !projectId || !context) {
      throw new ApiError('Missing required fields: instruction, projectId, context', 400);
    }

    const agentInstruction: CursorAgentInstruction = {
      userId,
      projectId,
      context,
      instruction,
    };

    const plan = await cursorAgentService.planAgentActions(userId, agentInstruction);

    res.json(formatApiResponse('success', 'Agent plan created', { plan }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to plan agent actions', null)
    );
  }
}

export async function executeAgentPlan(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { planId, execute } = req.body;

    if (!planId) {
      throw new ApiError('planId is required', 400);
    }

    // For now, execution is handled client-side
    // This endpoint can be used for logging/auditing
    res.json(formatApiResponse('success', 'Plan execution logged', { planId, executed: execute }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to execute plan', null)
    );
  }
}

