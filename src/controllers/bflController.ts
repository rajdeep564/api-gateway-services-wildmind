import { Request, Response, NextFunction } from 'express';
import '../types/http';

import { bflService } from '../services/bflService';
import { formatApiResponse } from '../utils/formatApiResponse';
import { creditsRepository } from '../repository/creditsRepository';
import { postSuccessDebit } from '../utils/creditDebit';
import { logger } from '../utils/logger';

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height, generationType, tags, nsfw, visibility, isPublic } = req.body || {};
    const uid = req.uid as string;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter generate controller with context');
    const result = await bflService.generate(uid, { prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height, generationType, tags, nsfw, visibility, isPublic }, ctx);
    res.json(formatApiResponse('success', 'Images generated', result));
  } catch (err) {
    logger.error({ err }, '[CREDITS] Generate controller error');
    next(err);
  }
}

async function fill(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid as string;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter fill controller with context');
    const result = await bflService.fill(uid, req.body, ctx);
    res.json(formatApiResponse('success', 'Image filled', result));
  } catch (err) {
    logger.error({ err }, '[CREDITS] Fill controller error');
    next(err);
  }
}

async function expand(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid as string;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter expand controller with context');
    const result = await bflService.expand(uid, req.body, ctx);
    res.json(formatApiResponse('success', 'Image expanded', result));
  } catch (err) {
    logger.error({ err }, '[CREDITS] Expand controller error');
    next(err);
  }
}

async function canny(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid as string;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter canny controller with context');
    const result = await bflService.canny(uid, req.body, ctx);
    res.json(formatApiResponse('success', 'Image generated (canny)', result));
  } catch (err) {
    logger.error({ err }, '[CREDITS] Canny controller error');
    next(err);
  }
}

async function depth(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid as string;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter depth controller with context');
    const result = await bflService.depth(uid, req.body, ctx);
    res.json(formatApiResponse('success', 'Image generated (depth)', result));
  } catch (err) {
    logger.error({ err }, '[CREDITS] Depth controller error');
    next(err);
  }
}

async function expandWithFill(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid as string;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS] Enter expandWithFill controller with context');
    const result = await bflService.expandWithFill(uid, req.body, ctx);
    res.json(formatApiResponse('success', 'Image expanded with FLUX Fill', result));
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