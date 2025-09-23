import { Request, Response, NextFunction } from 'express';
import '../types/http';

import { bflService } from '../services/bflService';
import { formatApiResponse } from '../utils/formatApiResponse';

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height } = req.body || {};
    const uid = req.uid;
    const result = await bflService.generate(uid, { prompt, userPrompt, model, n, frameSize, style, uploadedImages, width, height });
    res.json(formatApiResponse('success', 'Images generated', result));
  } catch (err) {
    next(err);
  }
}

async function fill(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const result = await bflService.fill(uid, req.body);
    res.json(formatApiResponse('success', 'Image filled', result));
  } catch (err) {
    next(err);
  }
}

async function expand(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const result = await bflService.expand(uid, req.body);
    res.json(formatApiResponse('success', 'Image expanded', result));
  } catch (err) {
    next(err);
  }
}

async function canny(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const result = await bflService.canny(uid, req.body);
    res.json(formatApiResponse('success', 'Image generated (canny)', result));
  } catch (err) {
    next(err);
  }
}

async function depth(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const result = await bflService.depth(uid, req.body);
    res.json(formatApiResponse('success', 'Image generated (depth)', result));
  } catch (err) {
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