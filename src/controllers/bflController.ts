import { Request, Response, NextFunction } from 'express';
import '../types/http';

import { bflService } from '../services/bflService';
import { formatApiResponse } from '../utils/formatApiResponse';
import { creditsRepository } from '../repository/creditsRepository';
import { postSuccessDebit } from '../utils/creditDebit';
import { logger } from '../utils/logger';

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height , generationType , tags , nsfw , visibility , isPublic } = req.body || {};
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter generate controller with context');
    const result = await bflService.generate(uid, { prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height , generationType , tags , nsfw , visibility , isPublic });
    const debitOutcome = await postSuccessDebit(uid, result, ctx, 'bfl', 'generate');
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
    const debitOutcomeFill = await postSuccessDebit(uid, result, ctx, 'bfl', 'fill');
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
    const debitOutcomeExpand = await postSuccessDebit(uid, result, ctx, 'bfl', 'expand');
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
    const debitOutcomeCanny = await postSuccessDebit(uid, result, ctx, 'bfl', 'canny');
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
    const debitOutcomeDepth = await postSuccessDebit(uid, result, ctx, 'bfl', 'depth');
    res.json(formatApiResponse('success', 'Image generated (depth)', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcomeDepth }));
  } catch (err) {
    logger.error({ err }, '[CREDITS] Depth controller error');
    next(err);
  }
}

async function expandWithFill(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter expandWithFill controller with context');
    const result = await bflService.expandWithFill(uid, req.body);
    const debitOutcome = await postSuccessDebit(uid, result, ctx, 'bfl', 'expandWithFill');
    res.json(formatApiResponse('success', 'Image expanded with FLUX Fill', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
  } catch (err) {
    logger.error({ err }, '[CREDITS] ExpandWithFill controller error');
    next(err);
  }
}

export const bflController = {
  generate,
  fill,
  expand,
  expandWithFill,
  canny,
  depth,
}