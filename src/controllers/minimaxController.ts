import { Request, Response, NextFunction } from 'express';
import '../types/http';
import { env } from '../config/env';
import { formatApiResponse } from '../utils/formatApiResponse';
import { minimaxService } from '../services/minimaxService';
import { creditsRepository } from '../repository/creditsRepository';
import { postSuccessDebit } from '../utils/creditDebit';
import { logger } from '../utils/logger';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { authRepository } from '../repository/auth/authRepository';
import { uploadFromUrlToZata, uploadDataUriToZata } from '../utils/storage/zataUpload';

// Images

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    // Forward the full body for extensibility (visibility/isPublic/tags/nsfw etc.)
    const payload = req.body || {};
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS][MINIMAX] Enter generate with context');
    // Log incoming public/visibility flags for debugging
    logger.info({ uid, isPublic: Boolean((payload as any).isPublic), visibility: (payload as any).visibility }, '[MINIMAX] Generate request flags');
    const result = await minimaxService.generate(uid, payload as any);
    const debitOutcome = await postSuccessDebit(uid, result, ctx, 'minimax', 'generate');
    res.json(formatApiResponse('success', 'Images generated', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
  } catch (err) {
    next(err);
  }
}

// Video
async function videoStart(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = env.minimaxApiKey as string;
    const groupId = env.minimaxGroupId as string;
    const ctx = (req as any).context || {};
    const result = await minimaxService.generateVideo(apiKey, groupId, req.body);
    // Create history now so we have a consistent idempotency/debit key and store model params for pricing
    const uid = req.uid;
    const body = req.body || {};
    const creator = await authRepository.getUserById(uid);
    const prompt = String(body?.prompt || body?.promptText || '');
    const model = String(body?.model || 'MiniMax-Hailuo-02');
    const generationType = body?.generationType || 'text-to-video';
    const { historyId } = await generationHistoryRepository.create(uid, {
      prompt,
      model,
      generationType,
      visibility: (body as any).visibility || 'private',
      tags: (body as any).tags,
      nsfw: (body as any).nsfw,
      isPublic: (body as any).isPublic === true,
      createdBy: { uid, username: creator?.username, email: (creator as any)?.email },
    } as any);
    const updates: any = { provider: 'minimax', providerTaskId: (result as any).taskId };
    if (typeof (body as any)?.duration !== 'undefined') updates.duration = (body as any).duration;
    if (typeof (body as any)?.resolution !== 'undefined') updates.resolution = (body as any).resolution;
    await generationHistoryRepository.update(uid, historyId, updates);

    // Persist any input images used for I2V flows so preview can show uploads
    try {
      const username = creator?.username || uid;
      const keyPrefix = `users/${username}/input/${historyId}`;
      const urls: string[] = [];
      const pushIfString = (v: any) => { if (typeof v === 'string' && v) urls.push(v); };
      pushIfString((body as any).first_frame_image);
      pushIfString((body as any).first_frame);
      pushIfString((body as any).first_frame_url);
      pushIfString((body as any).start_image_url);
      pushIfString((body as any).image_url);
      if (Array.isArray((body as any).image_urls)) {
        for (const u of (body as any).image_urls) if (typeof u === 'string') urls.push(u);
      }
      // Also handle subject_reference like MiniMax image API uses
      if (Array.isArray((body as any).subject_reference)) {
        for (const ref of (body as any).subject_reference) {
          const file = ref?.image_file || (Array.isArray(ref?.image) ? ref.image[0] : undefined);
          if (typeof file === 'string') urls.push(file);
        }
      }
      const inputPersisted: any[] = [];
      let idx = 0;
      for (const src of urls) {
        try {
          const stored = /^data:/i.test(src)
            ? await uploadDataUriToZata({ dataUri: src, keyPrefix, fileName: `input-${++idx}` })
            : await uploadFromUrlToZata({ sourceUrl: src, keyPrefix, fileName: `input-${++idx}` });
          inputPersisted.push({ id: `in-${idx}`, url: stored.publicUrl, storagePath: (stored as any).key, originalUrl: src });
        } catch {}
      }
      if (inputPersisted.length > 0) {
        await generationHistoryRepository.update(uid, historyId, { inputImages: inputPersisted } as any);
      }
    } catch {}

    res.json(formatApiResponse('success', 'Task created', { ...result, historyId, expectedDebit: ctx.creditCost }));
  } catch (err) {
    next(err);
  }
}

async function videoStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = env.minimaxApiKey as string;
    const taskId = String(req.query.task_id || '');
    const result = await minimaxService.getVideoStatus(apiKey, taskId);
    res.json(formatApiResponse('success', 'Status', result));
  } catch (err) {
    next(err);
  }
}

async function videoFile(req: Request, res: Response, next: NextFunction) {
  try {
    const fileId = String(req.query.file_id || '');
    const historyId = req.query.history_id ? String(req.query.history_id) : undefined;
    const result = await minimaxService.processVideoFile(req.uid, fileId, historyId);
    res.json(formatApiResponse('success', 'File', result));
  } catch (err) {
    next(err);
  }
}

// Music
async function musicGenerate(req: Request, res: Response, next: NextFunction) {
  try {
    const ctx = (req as any).context || {};
    const result = await minimaxService.musicGenerateAndStore(req.uid, req.body);
    // musicGenerateAndStore updates history; we'll perform debit here if historyId present
    try { await postSuccessDebit(req.uid, result, ctx, 'minimax', 'music'); } catch {}
    res.json(formatApiResponse('success', 'Music generated', { ...result, debitedCredits: ctx.creditCost }));
  } catch (err) {
    next(err);
  }
}

export const minimaxController = {
  generate,
  videoStart,
  videoStatus,
  videoFile,
  musicGenerate
};