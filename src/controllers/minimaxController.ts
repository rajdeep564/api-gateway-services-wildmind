import { Request, Response, NextFunction } from 'express';
import '../types/http';
import { env } from '../config/env';
import { formatApiResponse } from '../utils/formatApiResponse';
import { minimaxService } from '../services/minimaxService';

// Images

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, aspect_ratio, width, height, response_format, seed, n, prompt_optimizer, subject_reference, generationType, style } = req.body || {};
    const uid = req.uid;
    const result = await minimaxService.generate(uid, { prompt, aspect_ratio, width, height, response_format, seed, n, prompt_optimizer, subject_reference, generationType, style });
    res.json(formatApiResponse('success', 'Images generated', result));
  } catch (err) {
    next(err);
  }
}

// Video
async function videoStart(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = env.minimaxApiKey as string;
    const groupId = env.minimaxGroupId as string;
    const result = await minimaxService.generateVideo(apiKey, groupId, req.body);
    res.json(formatApiResponse('success', 'Task created', result));
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
    // Preserve existing generation call? We will store as well using helper
    const result = await minimaxService.musicGenerateAndStore(req.uid, req.body);
    res.json(formatApiResponse('success', 'Music generated', result));
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


