import { Request, Response } from 'express';
import { opService } from '../../services/canvas/opService';
import { projectRepository } from '../../repository/canvas/projectRepository';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';

export async function appendOp(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id: projectId } = req.params;
    const op = req.body;

    const result = await opService.appendOp(projectId, userId, op);

    res.json(formatApiResponse('success', 'Operation appended', result));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to append operation', null)
    );
  }
}

export async function getOps(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { id: projectId } = req.params;
    const fromIndex = parseInt(req.query.fromOp as string) || 0;
    const limit = parseInt(req.query.limit as string) || 100;

    const ops = await opService.getOpsAfterIndex(projectId, userId, fromIndex, limit);

    res.json(formatApiResponse('success', 'Operations retrieved', { ops }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to get operations', null)
    );
  }
}

