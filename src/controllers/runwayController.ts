import { Request, Response, NextFunction } from 'express';
import { formatApiResponse } from '../utils/formatApiResponse';
import { runwayService } from '../services/runwayService';

async function textToImage(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const result = await runwayService.textToImage(uid, req.body);
    res.json(formatApiResponse('success', 'Runway task created', result));
  } catch (err) {
    next(err);
  }
}

async function getStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id || '');
    const uid = (req as any).uid;
    const result = await runwayService.getStatus(uid, id);
    res.json(formatApiResponse('success', 'Runway status', result));
  } catch (err) {
    next(err);
  }
}

async function videoGenerate(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    const result = await runwayService.videoGenerate(uid, req.body);
    res.json(formatApiResponse('success', 'Runway video task created', result));
  } catch (err) {
    next(err);
  }
}

export const runwayController = {
  textToImage,
  getStatus,
  videoGenerate
};


