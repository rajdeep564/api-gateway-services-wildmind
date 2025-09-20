import { Request, Response, NextFunction } from 'express';
import { formatApiResponse } from '../utils/formatApiResponse';
import { runwayService } from '../services/runwayService';

async function textToImage(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await runwayService.textToImage(req.body);
    res.json(formatApiResponse('success', 'Runway task created', result));
  } catch (err) {
    next(err);
  }
}

async function getStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id || '');
    const result = await runwayService.getStatus(id);
    res.json(formatApiResponse('success', 'Runway status', result));
  } catch (err) {
    next(err);
  }
}

async function videoGenerate(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await runwayService.videoGenerate(req.body);
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


