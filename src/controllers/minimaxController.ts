import { Request, Response, NextFunction } from 'express';
import { formatApiResponse } from '../utils/formatApiResponse';
import { minimaxService } from '../services/minimaxService';

// Images
async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, aspect_ratio, width, height, response_format, seed, n, prompt_optimizer, subject_reference, generationType, style } = req.body || {};
    const uid = (req as any).uid;
    const result = await minimaxService.generate(uid, { prompt, aspect_ratio, width, height, response_format, seed, n, prompt_optimizer, subject_reference, generationType, style });
    res.json(formatApiResponse('success', 'Images generated', result));
  } catch (err) {
    next(err);
  }
}

// Video
async function videoStart(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = process.env.MINIMAX_API_KEY as string;
    const groupId = process.env.MINIMAX_GROUP_ID as string;
    const result = await minimaxService.generateVideo(apiKey, groupId, req.body);
    res.json(formatApiResponse('success', 'Task created', result));
  } catch (err) {
    next(err);
  }
}

async function videoStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = process.env.MINIMAX_API_KEY as string;
    const taskId = String(req.query.task_id || '');
    const result = await minimaxService.getVideoStatus(apiKey, taskId);
    res.json(formatApiResponse('success', 'Status', result));
  } catch (err) {
    next(err);
  }
}

async function videoFile(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = process.env.MINIMAX_API_KEY as string;
    const groupId = process.env.MINIMAX_GROUP_ID as string;
    const fileId = String(req.query.file_id || '');
    console.log("groupId", groupId);
    const result = await minimaxService.getFile(apiKey, groupId, fileId);
    res.json(formatApiResponse('success', 'File', result));
  } catch (err) {
    next(err);
  }
}

// Music
async function musicGenerate(req: Request, res: Response, next: NextFunction) {
  try {
    const apiKey = process.env.MINIMAX_API_KEY as string;
    const result = await minimaxService.generateMusic(apiKey, req.body);
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
}


