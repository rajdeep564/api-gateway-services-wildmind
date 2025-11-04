import { Request, Response, NextFunction } from 'express';
import '../types/http';

import { formatApiResponse } from '../utils/formatApiResponse';
import {falService, falQueueService} from '../services/falService';
import { creditsRepository } from '../repository/creditsRepository';
import { logger } from '../utils/logger';

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
  const { prompt, userPrompt, model, n, frameSize, style, uploadedImages, output_format , generationType , tags , nsfw , visibility , isPublic , aspect_ratio , num_images, resolution, seed, negative_prompt } = req.body || {};
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS][FAL] Enter generate with context');
  const result = await falService.generate(uid, { num_images, prompt, userPrompt, model, n, frameSize, style, uploadedImages, output_format , generationType , tags , nsfw , visibility , isPublic , aspect_ratio, resolution, seed, negative_prompt });
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
  async topazUpscaleImage(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falService.topazUpscaleImage(uid, req.body || {});
      let debitOutcome: 'SKIPPED' | 'WRITTEN' | undefined;
      try {
        const requestId = (result as any).historyId || ctx.idempotencyKey;
        if (requestId && typeof ctx.creditCost === 'number') {
          debitOutcome = await creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'fal.topaz.upscale.image', {
            ...(ctx.meta || {}),
            historyId: (result as any).historyId,
            provider: 'fal',
            pricingVersion: ctx.pricingVersion,
          });
        }
      } catch (_e) {}
      res.json(formatApiResponse('success', 'Upscaled', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
  async seedvrUpscale(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falService.seedvrUpscale(uid, req.body || {});
      let debitOutcome: 'SKIPPED' | 'WRITTEN' | undefined;
      try {
        const requestId = (result as any).historyId || ctx.idempotencyKey;
        if (requestId && typeof ctx.creditCost === 'number') {
          debitOutcome = await creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'fal.seedvr.upscale', {
            ...(ctx.meta || {}),
            historyId: (result as any).historyId,
            provider: 'fal',
            pricingVersion: ctx.pricingVersion,
          });
        }
      } catch (_e) {}
      res.json(formatApiResponse('success', 'Upscaled', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
  async image2svg(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falService.image2svg(uid, req.body || {});
      let debitOutcome: 'SKIPPED' | 'WRITTEN' | undefined;
      try {
        const requestId = (result as any).historyId || ctx.idempotencyKey;
        if (requestId && typeof ctx.creditCost === 'number') {
          debitOutcome = await creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'fal.image2svg', {
            ...(ctx.meta || {}),
            historyId: (result as any).historyId,
            provider: 'fal',
            pricingVersion: ctx.pricingVersion,
          });
        }
      } catch (_e) {}
      res.json(formatApiResponse('success', 'Converted to SVG', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
  async recraftVectorize(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falService.recraftVectorize(uid, req.body || {});
      let debitOutcome: 'SKIPPED' | 'WRITTEN' | undefined;
      try {
        const requestId = (result as any).historyId || ctx.idempotencyKey;
        if (requestId && typeof ctx.creditCost === 'number') {
          debitOutcome = await creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'fal.recraft.vectorize', {
            ...(ctx.meta || {}),
            historyId: (result as any).historyId,
            provider: 'fal',
            pricingVersion: ctx.pricingVersion,
          });
        }
      } catch (_e) {}
      res.json(formatApiResponse('success', 'Vectorized to SVG', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
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
  async veo31TtvSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31TtvSubmit(uid, req.body || {}, false);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31TtvFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31TtvSubmit(uid, req.body || {}, true);
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
  async veo31I2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31I2vSubmit(uid, req.body || {}, false);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31I2vFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31I2vSubmit(uid, req.body || {}, true);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31FirstLastFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31FirstLastFastSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31ReferenceToVideoSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31ReferenceToVideoSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31FirstLastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31FirstLastSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async sora2I2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.sora2I2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async sora2ProI2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.sora2ProI2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async sora2T2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.sora2T2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async sora2ProT2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.sora2ProT2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async sora2RemixV2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.sora2RemixV2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async ltx2ProI2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.ltx2ProI2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async ltx2FastI2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.ltx2FastI2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async ltx2ProT2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.ltx2ProT2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async ltx2FastT2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.ltx2FastT2vSubmit(uid, req.body || {});
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

