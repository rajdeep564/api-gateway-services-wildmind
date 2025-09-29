import { Request, Response, NextFunction } from 'express';
import '../types/http';
import { env } from '../config/env';
import { formatApiResponse } from '../utils/formatApiResponse';
import { minimaxService } from '../services/minimaxService';
import { creditsRepository } from '../repository/creditsRepository';
import { authRepository } from '../repository/auth/authRepository';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { logger } from '../utils/logger';
import { generationHistoryRepository } from '../repository/generationHistoryRepository';
import { authRepository } from '../repository/auth/authRepository';

// Images

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, aspect_ratio, width, height, response_format, seed, n, prompt_optimizer, subject_reference, generationType, style } = req.body || {};
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS][MINIMAX] Enter generate with context');
    const result = await minimaxService.generate(uid, { prompt, aspect_ratio, width, height, response_format, seed, n, prompt_optimizer, subject_reference, generationType, style });
    let debitOutcome: 'SKIPPED' | 'WRITTEN' | undefined;
    try {
      const requestId = (result as any).historyId || ctx.idempotencyKey;
      logger.info({ uid, requestId, cost: ctx.creditCost }, '[CREDITS][MINIMAX] Attempt debit after success');
      if (requestId && typeof ctx.creditCost === 'number') {
        debitOutcome = await creditsRepository.writeDebitIfAbsent(uid, requestId, ctx.creditCost, ctx.reason || 'minimax.generate', {
          ...(ctx.meta || {}),
          historyId: (result as any).historyId,
          provider: 'minimax',
          pricingVersion: ctx.pricingVersion,
        });
      }
    } catch (_e) {}
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
    
    // Create history entry for video generation
    const { prompt, model, duration, resolution } = req.body;
    const creator = await authRepository.getUserById(req.uid);
    const createdBy = { uid: req.uid, username: creator?.username, email: (creator as any)?.email };
    const { historyId } = await generationHistoryRepository.create(req.uid, {
      prompt: prompt || 'Video Generation',
      model: model || 'MiniMax-Hailuo-02',
      generationType: 'text-to-video',
      visibility: 'private',
      isPublic: false,
      createdBy,
    } as any);
    
    // Start video generation with history ID
    const result = await minimaxService.generateVideo(apiKey, groupId, { ...req.body, historyId });
    
    // Update history with task ID for tracking
    await generationHistoryRepository.update(req.uid, historyId, {
      status: 'generating',
      provider: 'minimax',
      taskId: result.taskId,
    } as any);
    
    // Debit credits idempotently at task start, keyed by historyId
    try {
      if (typeof ctx.creditCost === 'number') {
        await creditsRepository.writeDebitIfAbsent(
          req.uid,
          historyId,
          ctx.creditCost,
          'minimax.video',
          { ...(ctx.meta || {}), historyId, taskId: result.taskId, provider: 'minimax', pricingVersion: ctx.pricingVersion }
        );
      }
    } catch (_e) {}

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
    try {
      const requestId = (result as any).historyId || ctx.idempotencyKey;
      if (requestId && typeof ctx.creditCost === 'number') {
        await creditsRepository.writeDebitIfAbsent(req.uid, requestId, ctx.creditCost, ctx.reason || 'minimax.music', {
          ...(ctx.meta || {}),
          historyId: (result as any).historyId,
          provider: 'minimax',
          pricingVersion: ctx.pricingVersion,
        });
      }
    } catch (_e) {}
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


