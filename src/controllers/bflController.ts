import { Request, Response, NextFunction } from 'express';
import '../types/http';

import { bflService } from '../services/bflService';
import { formatApiResponse } from '../utils/formatApiResponse';
import { creditsRepository } from '../repository/creditsRepository';
import { logger } from '../utils/logger';

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height , generationType , tags , nsfw , visibility , isPublic } = req.body || {};
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter generate controller with context');
    const result = await bflService.generate(uid, { prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height , generationType , tags , nsfw , visibility , isPublic });
    let debitOutcome: 'SKIPPED' | 'WRITTEN' | undefined;
    try {
      const requestId = (result as any).historyId || ctx.idempotencyKey;
      logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS] Attempt debit after success');
      if (requestId && typeof ctx.creditCost === 'number') {
        debitOutcome = await creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'bfl.generate', {
          ...(ctx.meta || {}),
          historyId: (result as any).historyId,
          provider: 'bfl',
          pricingVersion: ctx.pricingVersion,
        });
        logger.info({ uid, requestId, debitOutcome }, '[CREDITS] Debit result');
      }
    } catch (_e) {}
    res.json(formatApiResponse('success', 'Images generated', {
      ...result,
      debitedCredits: typeof ctx.creditCost === 'number' ? ctx.creditCost : undefined,
      debitStatus: debitOutcome,
    }));
  } catch (err) {
    logger.error({ err }, '[CREDITS] Generate controller error');
    next(err);
  }
}

async function fill(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter fill controller with context');
    const result = await bflService.fill(uid, req.body);
    let debitOutcomeFill: 'SKIPPED' | 'WRITTEN' | undefined;
    try {
      const requestId = (result as any).historyId || ctx.idempotencyKey;
      logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS] Attempt debit after fill success');
      if (requestId && typeof ctx.creditCost === 'number') {
        debitOutcomeFill = await creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'bfl.fill', {
          ...(ctx.meta || {}),
          historyId: (result as any).historyId,
          provider: 'bfl',
          pricingVersion: ctx.pricingVersion,
        });
        logger.info({ uid, requestId, debitOutcomeFill }, '[CREDITS] Debit result (fill)');
      }
    } catch (_e) {}
    res.json(formatApiResponse('success', 'Image filled', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcomeFill }));
  } catch (err) {
    logger.error({ err }, '[CREDITS] Fill controller error');
    next(err);
  }
}

async function expand(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter expand controller with context');
    const result = await bflService.expand(uid, req.body);
    let debitOutcomeExpand: 'SKIPPED' | 'WRITTEN' | undefined;
    try {
      const requestId = (result as any).historyId || ctx.idempotencyKey;
      logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS] Attempt debit after expand success');
      if (requestId && typeof ctx.creditCost === 'number') {
        debitOutcomeExpand = await creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'bfl.expand', {
          ...(ctx.meta || {}),
          historyId: (result as any).historyId,
          provider: 'bfl',
          pricingVersion: ctx.pricingVersion,
        });
        logger.info({ uid, requestId, debitOutcomeExpand }, '[CREDITS] Debit result (expand)');
      }
    } catch (_e) {}
    res.json(formatApiResponse('success', 'Image expanded', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcomeExpand }));
  } catch (err) {
    logger.error({ err }, '[CREDITS] Expand controller error');
    next(err);
  }
}

async function canny(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter canny controller with context');
    const result = await bflService.canny(uid, req.body);
    let debitOutcomeCanny: 'SKIPPED' | 'WRITTEN' | undefined;
    try {
      const requestId = (result as any).historyId || ctx.idempotencyKey;
      logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS] Attempt debit after canny success');
      if (requestId && typeof ctx.creditCost === 'number') {
        debitOutcomeCanny = await creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'bfl.canny', {
          ...(ctx.meta || {}),
          historyId: (result as any).historyId,
          provider: 'bfl',
          pricingVersion: ctx.pricingVersion,
        });
        logger.info({ uid, requestId, debitOutcomeCanny }, '[CREDITS] Debit result (canny)');
      }
    } catch (_e) {}
    res.json(formatApiResponse('success', 'Image generated (canny)', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcomeCanny }));
  } catch (err) {
    logger.error({ err }, '[CREDITS] Canny controller error');
    next(err);
  }
}

async function depth(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter depth controller with context');
    const result = await bflService.depth(uid, req.body);
    let debitOutcomeDepth: 'SKIPPED' | 'WRITTEN' | undefined;
    try {
      const requestId = (result as any).historyId || ctx.idempotencyKey;
      logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS] Attempt debit after depth success');
      if (requestId && typeof ctx.creditCost === 'number') {
        debitOutcomeDepth = await creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'bfl.depth', {
          ...(ctx.meta || {}),
          historyId: (result as any).historyId,
          provider: 'bfl',
          pricingVersion: ctx.pricingVersion,
        });
        logger.info({ uid, requestId, debitOutcomeDepth }, '[CREDITS] Debit result (depth)');
      }
    } catch (_e) {}
    res.json(formatApiResponse('success', 'Image generated (depth)', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcomeDepth }));
  } catch (err) {
    logger.error({ err }, '[CREDITS] Depth controller error');
    next(err);
  }
}

export const bflController = {
  generate,
  fill,
  expand,
  canny,
  depth,
}