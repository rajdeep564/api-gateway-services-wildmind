import { Request, Response, NextFunction } from 'express';
import { FalService } from '../services/falService';
import { formatApiResponse } from '../utils/formatApiResponse';
import { logger } from '../utils/logger';

export class FalController {
  // Submit image generation request
  static async submit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = req.body;
      
      logger.info({
        prompt: payload.prompt?.substring(0, 100) + '...',
        model: payload.model,
        numImages: payload.num_images || 1
      }, 'FAL submit request received');

      const result = await FalService.submit(payload);
      
      res.json({
        responseStatus: 'success',
        request_id: result.request_id,
        status: result.status
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'FAL submit error');
      next(error);
    }
  }

  // Get generation status
  static async status(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const requestId = req.query.requestId as string;
      
      if (!requestId) {
        res.status(400).json(formatApiResponse('error', 'requestId is required', null));
        return;
      }

      const result = await FalService.getStatus(requestId);
      
      res.json({
        responseStatus: 'success',
        status: result.status,
        request_id: result.request_id,
        logs: result.logs || [],
        metrics: result.metrics || {}
      });
    } catch (error: any) {
      if (error.message === 'Request not found') {
        res.status(404).json(formatApiResponse('error', 'Request not found', null));
        return;
      }
      
      logger.error({ error: error.message }, 'FAL status error');
      next(error);
    }
  }

  // Get generation results
  static async result(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const requestId = req.query.requestId as string;
      
      if (!requestId) {
        res.status(400).json(formatApiResponse('error', 'requestId is required', null));
        return;
      }

      const result = await FalService.getResult(requestId);
      
      // Format response to match what your frontend expects
      res.json({
        responseStatus: 'success',
        status: result.status,
        images: result.images,
        request_id: result.request_id
      });
    } catch (error: any) {
      if (error.message === 'Request not found') {
        res.status(404).json(formatApiResponse('error', 'Request not found', null));
        return;
      }
      
      if (error.message === 'Request still in progress') {
        res.status(202).json({
          status: 'IN_PROGRESS',
          message: 'Request still processing'
        });
        return;
      }
      
      logger.error({ error: error.message }, 'FAL result error');
      next(error);
    }
  }
}
