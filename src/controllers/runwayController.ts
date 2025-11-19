import { Request, Response, NextFunction } from 'express';
import { formatApiResponse } from '../utils/formatApiResponse';
import { runwayService } from '../services/runwayService';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { creditsRepository } from '../repository/creditsRepository';
import { logger } from '../utils/logger';

async function textToImage(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const ctx = (req as any).context || {};
    const result = await runwayService.textToImage(uid, req.body);
    // Only a task is created here; actual outputs are attached on status success.
    // We can debit now against the historyId to reserve post-charge on success; instead, we debit at completion in getStatus.
    res.json(formatApiResponse('success', 'Runway task created', { ...result, expectedDebit: ctx.creditCost }));
  } catch (err) {
    next(err);
  }
}

async function getStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id || '');
    const uid = (req as any).uid;
    const result = await runwayService.getStatus(uid, id);
    const status = (result as any)?.status;
    
    if (status === 'SUCCEEDED') {
      try {
        const located = await generationHistoryRepository.findByProviderTaskId(uid, 'runway', id);
        if (located) {
          const item = located.item as any;
          const payload: any = {
            historyId: located.id,
            model: item?.model,
            status: 'SUCCEEDED',
          };
          if (Array.isArray(item?.images) && item.images.length > 0) payload.images = item.images;
          if (Array.isArray(item?.videos) && item.videos.length > 0) payload.videos = item.videos;
          
          // Also include outputs from task if videos/images not in history yet
          if ((!payload.images || payload.images.length === 0) && (!payload.videos || payload.videos.length === 0)) {
            const taskOutputs = (result as any)?.output || (result as any)?.outputs || [];
            if (Array.isArray(taskOutputs) && taskOutputs.length > 0) {
              // Determine if it's images or videos based on generation type
              const isImage = item?.generationType === 'text-to-image';
              if (isImage) {
                payload.images = taskOutputs.map((url: string, i: number) => ({
                  id: `${id}-${i}`,
                  url,
                  originalUrl: url,
                }));
              } else {
                payload.videos = taskOutputs.map((url: string, i: number) => ({
                  id: `${id}-${i}`,
                  url,
                  originalUrl: url,
                }));
              }
            }
          }
          
          return res.json(formatApiResponse('success', 'Runway status', payload));
        }
      } catch (err) {
        console.error('[Runway Controller] Error finding history:', err);
      }
      
      // If history not found but task is SUCCEEDED, return task with outputs
      const taskOutputs = (result as any)?.output || (result as any)?.outputs || [];
      const payload: any = {
        ...result,
        status: 'SUCCEEDED',
        outputs: taskOutputs,
        output: taskOutputs, // Include both for compatibility
      };
      return res.json(formatApiResponse('success', 'Runway status', payload));
    }
    
    res.json(formatApiResponse('success', 'Runway status', result));
  } catch (err) {
    next(err);
  }
}

async function videoGenerate(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const ctx = (req as any).context || {};
    const result = await runwayService.videoGenerate(uid, req.body);
    res.json(formatApiResponse('success', 'Runway video task created', { ...result, expectedDebit: ctx.creditCost }));
  } catch (err) {
    next(err);
  }
}

async function characterPerformance(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const ctx = (req as any).context || {};
    console.log('[Runway Controller] Act-Two request body:', JSON.stringify(req.body, null, 2));
    const result = await runwayService.characterPerformance(uid, req.body);
    console.log('[Runway Controller] Act-Two result:', JSON.stringify(result, null, 2));
    res.json(formatApiResponse('success', 'Runway Act-Two task created', { ...result, expectedDebit: ctx.creditCost }));
  } catch (err: any) {
    console.error('[Runway Controller] Act-Two error:', err);
    next(err);
  }
}

export const runwayController = {
  textToImage,
  getStatus,
  videoGenerate,
  characterPerformance,
};


