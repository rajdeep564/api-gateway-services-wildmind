import { Request, Response, NextFunction } from 'express';
import { replicateService } from '../services/replicateService';
import { formatApiResponse } from '../utils/formatApiResponse';
import { postSuccessDebit } from '../utils/creditDebit';

async function removeBackground(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const data = await replicateService.removeBackground(uid, req.body || {});
    (res as any).locals = { ...(res as any).locals, success: true };
    const ctx = (req as any).context || {};
    try { await postSuccessDebit(uid, data, ctx, 'replicate', 'bg-remove'); } catch { }
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
    const ctx = (req as any).context || {};
    try { await postSuccessDebit(uid, data, ctx, 'replicate', 'upscale'); } catch { }
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
    const ctx = (req as any).context || {};
    // Perform debit and include credit info in response, similar to FAL image generation
    const debitOutcome = await postSuccessDebit(uid, data, ctx, 'replicate', 'generate');
    res.json(
      formatApiResponse('success', 'OK', {
        ...data,
        debitedCredits: ctx.creditCost,
        debitStatus: debitOutcome,
      })
    );
  } catch (e) {
    next(e);
    return;
  }
}

async function wanI2V(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const data = await replicateService.wanI2V(uid, req.body || {});
    (res as any).locals = { ...(res as any).locals, success: true };
    res.json({ responseStatus: 'success', message: 'OK', data });
  } catch (e) {
    next(e);
    return;
  }
}

async function wanT2V(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const data = await replicateService.wanT2V(uid, req.body || {});
    (res as any).locals = { ...(res as any).locals, success: true };
    res.json({ responseStatus: 'success', message: 'OK', data });
  } catch (e) {
    next(e);
    return;
  }
}

export const replicateController = { removeBackground, upscale, generateImage, wanI2V, wanT2V } as any;
// Queue-style handlers for Replicate WAN 2.5
export async function wanT2vSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const result = await (replicateService as any).wanT2vSubmit(uid, req.body || {});
    res.json(formatApiResponse('success', 'Submitted', result));
  } catch (e) { next(e); }
}

export async function wanI2vSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const result = await (replicateService as any).wanI2vSubmit(uid, req.body || {});
    res.json(formatApiResponse('success', 'Submitted', result));
  } catch (e) { next(e); }
}

export async function queueStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const requestId = (req.query.requestId as string) || (req.body?.requestId as string);
    if (!requestId) return res.status(400).json(formatApiResponse('error', 'requestId is required', null as any));
    // Disable caching for polling endpoints
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const result = await (replicateService as any).replicateQueueStatus(uid, requestId);
    res.json(formatApiResponse('success', 'Status', result));
  } catch (e) { next(e); }
}

export async function queueResult(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const requestId = (req.query.requestId as string) || (req.body?.requestId as string);
    if (!requestId) return res.status(400).json(formatApiResponse('error', 'requestId is required', null as any));
    // Disable caching for polling endpoints
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const result = await (replicateService as any).replicateQueueResult(uid, requestId);
    res.json(formatApiResponse('success', 'Result', result));
  } catch (e) { next(e); }
}

Object.assign(replicateController, { wanT2vSubmit, wanI2vSubmit, queueStatus, queueResult });

// Kling queue handlers
export async function klingT2vSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const result = await (replicateService as any).klingT2vSubmit(uid, req.body || {});
    res.json(formatApiResponse('success', 'Submitted', result));
  } catch (e) { next(e); }
}

export async function klingI2vSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const result = await (replicateService as any).klingI2vSubmit(uid, req.body || {});
    res.json(formatApiResponse('success', 'Submitted', result));
  } catch (e) { next(e); }
}

Object.assign(replicateController, { klingT2vSubmit, klingI2vSubmit });

// Seedance queue handlers
export async function seedanceT2vSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const result = await (replicateService as any).seedanceT2vSubmit(uid, req.body || {});

    const ctx = (req as any).context || {};
    const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'seedance-t2v');

    res.json(formatApiResponse('success', 'Submitted', {
      ...result,
      debitedCredits: ctx.creditCost,
      debitStatus: debitOutcome
    }));
  } catch (e) { next(e); }
}

export async function seedanceI2vSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const result = await (replicateService as any).seedanceI2vSubmit(uid, req.body || {});

    const ctx = (req as any).context || {};
    const debitOutcome = await postSuccessDebit(uid, result, ctx, 'replicate', 'seedance-i2v');

    res.json(formatApiResponse('success', 'Submitted', {
      ...result,
      debitedCredits: ctx.creditCost,
      debitStatus: debitOutcome
    }));
  } catch (e) { next(e); }
}

Object.assign(replicateController, { seedanceT2vSubmit, seedanceI2vSubmit });

// PixVerse queue handlers
export async function pixverseT2vSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const result = await (replicateService as any).pixverseT2vSubmit(uid, req.body || {});
    res.json(formatApiResponse('success', 'Submitted', result));
  } catch (e) { next(e); }
}

export async function pixverseI2vSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const result = await (replicateService as any).pixverseI2vSubmit(uid, req.body || {});
    res.json(formatApiResponse('success', 'Submitted', result));
  } catch (e) { next(e); }
}

Object.assign(replicateController, { pixverseT2vSubmit, pixverseI2vSubmit });

// Kling Lipsync queue handler
export async function klingLipsyncSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const result = await (replicateService as any).klingLipsyncSubmit(uid, req.body || {});
    res.json(formatApiResponse('success', 'Submitted', result));
  } catch (e) { next(e); }
}

Object.assign(replicateController, { klingLipsyncSubmit });

// WAN Animate Replace queue handler
export async function wanAnimateReplaceSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const result = await (replicateService as any).wanAnimateReplaceSubmit(uid, req.body || {});
    res.json(formatApiResponse('success', 'Submitted', result));
  } catch (e) { next(e); }
}

Object.assign(replicateController, { wanAnimateReplaceSubmit });

export async function wanAnimateAnimationSubmit(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid as string;
    const result = await (replicateService as any).wanAnimateAnimationSubmit(uid, req.body || {});
    res.json(formatApiResponse('success', 'Submitted', result));
  } catch (e) { next(e); }
}

Object.assign(replicateController, { wanAnimateAnimationSubmit });


