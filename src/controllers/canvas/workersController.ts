import { Request, Response } from 'express';
import { formatApiResponse } from '../../utils/formatApiResponse';
import { ApiError } from '../../utils/errorHandler';
import { triggerSnapshotWorker } from '../../workers/canvas/snapshotWorker';
import { triggerMediaGCWorker } from '../../workers/canvas/mediaGCWorker';

/**
 * Trigger snapshot worker for a project or all projects
 */
export async function triggerSnapshot(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    const { projectId } = req.query;
    const config = {
      maxOpsSinceSnapshot: req.body.maxOpsSinceSnapshot,
      maxTimeSinceSnapshot: req.body.maxTimeSinceSnapshot,
      batchSize: req.body.batchSize,
    };

    const result = await triggerSnapshotWorker(
      projectId as string | undefined,
      config
    );

    res.json(formatApiResponse('success', 'Snapshot worker completed', { result }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to trigger snapshot worker', null)
    );
  }
}

/**
 * Trigger media GC worker for a media item or all unreferenced media
 */
export async function triggerMediaGC(req: Request, res: Response) {
  try {
    const userId = (req as any).uid;
    if (!userId) {
      throw new ApiError('Unauthorized', 401);
    }

    // Only allow admins or specific users to trigger GC
    // For now, we'll allow any authenticated user, but you can add role checks here
    const { mediaId } = req.query;
    const config = {
      ttlDays: req.body.ttlDays,
      batchSize: req.body.batchSize,
      dryRun: req.body.dryRun !== false, // Default to dry run for safety
    };

    const result = await triggerMediaGCWorker(mediaId as string | undefined, config);

    res.json(formatApiResponse('success', 'Media GC worker completed', { result }));
  } catch (error: any) {
    res.status(error.statusCode || 500).json(
      formatApiResponse('error', error.message || 'Failed to trigger media GC worker', null)
    );
  }
}

