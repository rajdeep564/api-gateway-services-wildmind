import { Request, Response, NextFunction } from 'express';
import '../types/http';

import { formatApiResponse } from '../utils/formatApiResponse';
import {falService, falQueueService} from '../services/falService';
import { creditsRepository } from '../repository/creditsRepository';
import { logger } from '../utils/logger';

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, userPrompt, model, n, frameSize, style, uploadedImages, output_format , generationType , tags , nsfw , visibility , isPublic , aspect_ratio ,num_images} = req.body || {};
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS][FAL] Enter generate with context');
    const result = await falService.generate(uid, { num_images,prompt, userPrompt, model, n, frameSize, style, uploadedImages, output_format , generationType , tags , nsfw , visibility , isPublic , aspect_ratio });
    let debitOutcome: 'SKIPPED' | 'WRITTEN' | undefined;
    try {
      const requestId = (result as any).historyId || ctx.idempotencyKey;
      logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS][FAL] Attempt debit after success');
      if (requestId && typeof ctx.creditCost === 'number') {
        debitOutcome = await creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'fal.generate', {
          ...(ctx.meta || {}),
          historyId: (result as any).historyId,
          provider: 'fal',
          pricingVersion: ctx.pricingVersion,
        });
      }
    } catch (_e) {}
    res.json(formatApiResponse('success', 'Images generated', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
  } catch (err) {
    next(err);
  }
}

export const falController = {
  generate,
  // Queue
  async veoTtvSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veoTtvSubmit(uid, req.body || {}, false);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veoTtvFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veoTtvSubmit(uid, req.body || {}, true);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veoI2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veoI2vSubmit(uid, req.body || {}, false);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veoI2vFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veoI2vSubmit(uid, req.body || {}, true);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async queueStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const model = (req.query.model as string) || (req.body?.model as string);
      const requestId = (req.query.requestId as string) || (req.body?.requestId as string);
      const result = await falQueueService.queueStatus(uid, model, requestId);
      res.json(formatApiResponse('success', 'Status', result));
    } catch (err) { next(err); }
  },
  async queueResult(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const model = (req.query.model as string) || (req.body?.model as string);
      const requestId = (req.query.requestId as string) || (req.body?.requestId as string);
      const result = await falQueueService.queueResult(uid, model, requestId);
      res.json(formatApiResponse('success', 'Result', result));
    } catch (err) { next(err); }
  }
}

