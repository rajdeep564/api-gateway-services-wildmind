import { Request, Response, NextFunction } from 'express';
import '../types/http';
import { formatApiResponse } from '../utils/formatApiResponse';
import { queueService } from '../services/queueService';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/errorHandler';
import { computeQueueItemCost } from '../utils/pricing/queuePricing';

/**
 * POST /api/queue/add
 * Add generation to queue
 * Automatically calculates credit cost using existing pricing functions
 */
export async function addToQueue(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { generationType, provider, payload, metadata } = req.body;

    // Validation
    if (!generationType || !provider || !payload) {
      return res.status(400).json(
        formatApiResponse('error', 'Missing required fields: generationType, provider, payload', null)
      );
    }

    // Calculate credit cost using existing pricing functions
    // This ensures accuracy and consistency with existing generation flows
    let costResult;
    try {
      // Create a request-like object for pricing calculation
      const pricingReq = {
        ...req,
        body: payload,
        uid,
      } as Request;
      
      costResult = await computeQueueItemCost(provider, generationType, payload, pricingReq);
    } catch (pricingError: any) {
      logger.error({ uid, provider, generationType, error: pricingError.message }, '[Queue] Failed to calculate cost');
      return res.status(400).json(
        formatApiResponse('error', `Failed to calculate cost: ${pricingError.message}`, null)
      );
    }

    const creditsCost = costResult.cost;

    if (creditsCost < 0) {
      return res.status(400).json(
        formatApiResponse('error', 'Invalid credit cost calculated', null)
      );
    }

    const result = await queueService.addToQueue(uid, {
      generationType,
      provider,
      payload,
      creditsCost,
      metadata: {
        ...metadata,
        ...costResult.meta,
        pricingVersion: costResult.pricingVersion,
      },
    });

    logger.info({ 
      uid, 
      queueId: result.queueId, 
      generationType, 
      provider, 
      creditsCost,
      pricingVersion: costResult.pricingVersion,
    }, '[Queue] Added to queue');

    return res.json(
      formatApiResponse('success', 'Added to queue', {
        ...result,
        creditsCost,
        pricingVersion: costResult.pricingVersion,
      })
    );
  } catch (error: any) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json(
        formatApiResponse('error', error.message, null)
      );
    }
    next(error);
  }
}

/**
 * GET /api/queue/status/:queueId
 * Get queue item status
 */
export async function getQueueStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { queueId } = req.params;
    if (!queueId) {
      return res.status(400).json(
        formatApiResponse('error', 'Queue ID is required', null)
      );
    }

    const item = await queueService.getQueueItemStatus(uid, queueId);
    
    if (!item) {
      return res.status(404).json(
        formatApiResponse('error', 'Queue item not found', null)
      );
    }

    return res.json(
      formatApiResponse('success', 'Queue item status', item)
    );
  } catch (error: any) {
    next(error);
  }
}

/**
 * GET /api/queue/list
 * Get user's queue items
 */
export async function getQueueList(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const status = req.query.status as string | undefined;
    const items = await queueService.getUserQueue(uid, status as any);

    return res.json(
      formatApiResponse('success', 'Queue items retrieved', { items })
    );
  } catch (error: any) {
    next(error);
  }
}

/**
 * POST /api/queue/cancel/:queueId
 * Cancel queue item and refund credits
 */
export async function cancelQueueItem(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { queueId } = req.params;
    if (!queueId) {
      return res.status(400).json(
        formatApiResponse('error', 'Queue ID is required', null)
      );
    }

    const result = await queueService.cancelQueueItem(uid, queueId);

    logger.info({ uid, queueId, refunded: result.refunded }, '[Queue] Cancelled queue item');

    return res.json(
      formatApiResponse('success', 'Queue item cancelled', result)
    );
  } catch (error: any) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json(
        formatApiResponse('error', error.message, null)
      );
    }
    next(error);
  }
}

/**
 * POST /api/queue/deduct-credits
 * Deduct credits for queue item (called by frontend)
 */
export async function deductCreditsForQueue(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { queueId, creditsCost, generationType, provider } = req.body;

    if (!queueId || typeof creditsCost !== 'number') {
      return res.status(400).json(
        formatApiResponse('error', 'Missing required fields: queueId, creditsCost', null)
      );
    }

    // This endpoint is for frontend to sync credit deduction
    // The actual deduction happens in addToQueue, but this allows frontend to verify
    const item = await queueService.getQueueItemStatus(uid, queueId);
    
    if (!item) {
      return res.status(404).json(
        formatApiResponse('error', 'Queue item not found', null)
      );
    }

    return res.json(
      formatApiResponse('success', 'Credits deducted', {
        queueId,
        creditsDeducted: item.creditsDeducted,
        creditsCost: item.creditsCost,
      })
    );
  } catch (error: any) {
    next(error);
  }
}

/**
 * POST /api/queue/refund-credits
 * Refund credits for queue item (called by frontend on failure)
 */
export async function refundCreditsForQueue(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = (req as any).uid;
    if (!uid) {
      return res.status(401).json(
        formatApiResponse('error', 'Unauthorized', null)
      );
    }

    const { queueId, creditsCost } = req.body;

    if (!queueId || typeof creditsCost !== 'number') {
      return res.status(400).json(
        formatApiResponse('error', 'Missing required fields: queueId, creditsCost', null)
      );
    }

    // Mark as failed and refund
    await queueService.markQueueItemFailed(uid, queueId, 'Generation failed');

    return res.json(
      formatApiResponse('success', 'Credits refunded', {
        queueId,
        refunded: true,
      })
    );
  } catch (error: any) {
    next(error);
  }
}

