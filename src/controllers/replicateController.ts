import { Request, Response, NextFunction } from 'express';
import { replicateService } from '../services/replicateService';

async function removeBackground(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const data = await replicateService.removeBackground(uid, req.body || {});
    (res as any).locals = { ...(res as any).locals, success: true };
    res.json({ responseStatus: 'success', message: 'OK', data });
  } catch (e) {
    next(e);
    return;
  }
}

async function upscale(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const data = await replicateService.upscale(uid, req.body || {});
    (res as any).locals = { ...(res as any).locals, success: true };
    res.json({ responseStatus: 'success', message: 'OK', data });
  } catch (e) {
    next(e);
    return;
  }
}

async function generateImage(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const data = await replicateService.generateImage(uid, req.body || {});
    (res as any).locals = { ...(res as any).locals, success: true };
    res.json({ responseStatus: 'success', message: 'OK', data });
  } catch (e) {
    next(e);
    return;
  }
}

export const replicateController = { removeBackground, upscale, generateImage };


