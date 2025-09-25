import { Request, Response, NextFunction } from 'express';
import '../types/http';

import { formatApiResponse } from '../utils/formatApiResponse';
import {falService, falQueueService} from '../services/falService';

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const { prompt, userPrompt, model, n, frameSize, style, uploadedImages, output_format } = req.body || {};
    const uid = req.uid;
    const result = await falService.generate(uid, { prompt, userPrompt, model, n, frameSize, style, uploadedImages, output_format });
    res.json(formatApiResponse('success', 'Images generated', result));
  } catch (err) {
    next(err);
  }
}

export const falController = {
  generate,
  // Queue
  async veoTtvSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const result = await falQueueService.veoTtvSubmit(uid, req.body || {}, false);
      res.json(formatApiResponse('success', 'Submitted', result));
    } catch (err) { next(err); }
  },
  async veoTtvFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const result = await falQueueService.veoTtvSubmit(uid, req.body || {}, true);
      res.json(formatApiResponse('success', 'Submitted', result));
    } catch (err) { next(err); }
  },
  async veoI2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const result = await falQueueService.veoI2vSubmit(uid, req.body || {}, false);
      res.json(formatApiResponse('success', 'Submitted', result));
    } catch (err) { next(err); }
  },
  async veoI2vFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const result = await falQueueService.veoI2vSubmit(uid, req.body || {}, true);
      res.json(formatApiResponse('success', 'Submitted', result));
    } catch (err) { next(err); }
  },
  async queueStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const model = (req.query.model as string) || (req.body?.model as string);
      const requestId = (req.query.requestId as string) || (req.body?.requestId as string);
      const result = await falQueueService.queueStatus(uid, model, requestId);
      res.json(formatApiResponse('success', 'Status', result));
    } catch (err) { next(err); }
  },
  async queueResult(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const model = (req.query.model as string) || (req.body?.model as string);
      const requestId = (req.query.requestId as string) || (req.body?.requestId as string);
      const result = await falQueueService.queueResult(uid, model, requestId);
      res.json(formatApiResponse('success', 'Result', result));
    } catch (err) { next(err); }
  }
}

