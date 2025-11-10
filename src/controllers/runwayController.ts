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
    if ((result as any)?.status === 'SUCCEEDED') {
      try {
        const located = await generationHistoryRepository.findByProviderTaskId(uid, 'runway', id);
        if (located) {
          const item = located.item as any;
          const payload: any = {
            historyId: located.id,
            model: item?.model,
            status: 'completed',
          };
          if (Array.isArray(item?.images) && item.images.length > 0) payload.images = item.images;
          if (Array.isArray(item?.videos) && item.videos.length > 0) payload.videos = item.videos;
          return res.json(formatApiResponse('success', 'Runway status', payload));
        }
      } catch {}
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

export const runwayController = {
  textToImage,
  getStatus,
  videoGenerate
};


