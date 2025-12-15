import { Request } from 'express';
import { computeFalImageCost } from './falPricing';
import { computeMinimaxImageCost, computeMinimaxVideoCost, computeMinimaxMusicCost } from './minimaxPricing';
import { computeRunwayImageCost, computeRunwayVideoCost } from './runwayPricing';
import { computeBflCost } from './bflPricing';
import { logger } from '../logger';

/**
 * Calculate credit cost for queue item using existing pricing functions
 * This ensures pricing accuracy and consistency with existing generation flows
 */
export async function computeQueueItemCost(
  provider: string,
  generationType: string,
  payload: any,
  req?: Request
): Promise<{ cost: number; pricingVersion: string; meta: Record<string, any> }> {
  try {
    // Create a mock request object if not provided
    const mockReq = req || ({
      body: payload,
      uid: (payload as any).uid || 'queue',
    } as any);

    switch (provider) {
      case 'fal':
        if (generationType === 'text-to-image' || generationType === 'image-to-image') {
          return await computeFalImageCost(mockReq);
        } else if (generationType === 'text-to-video' || generationType === 'image-to-video') {
          // For video, we'd need to determine which FAL video pricing function to use
          // For now, use a default - this should be expanded based on model
          const model = (payload.model || '').toLowerCase();
          if (model.includes('veo')) {
            // Would need to call appropriate Veo pricing function
            // For now, return a default
            return { cost: 100, pricingVersion: 'fal-v1', meta: { model, note: 'Default video cost' } };
          }
          return { cost: 100, pricingVersion: 'fal-v1', meta: { model, note: 'Default video cost' } };
        } else if (generationType === 'text-to-speech' || generationType === 'tts') {
          // Would need TTS pricing function
          return { cost: 10, pricingVersion: 'fal-v1', meta: { model: payload.model, note: 'Default TTS cost' } };
        }
        // Default to image pricing
        return await computeFalImageCost(mockReq);

      case 'minimax':
        if (generationType === 'text-to-music') {
          return await computeMinimaxMusicCost(mockReq);
        } else if (generationType === 'text-to-video' || generationType === 'image-to-video') {
          return await computeMinimaxVideoCost(mockReq);
        } else {
          return await computeMinimaxImageCost(mockReq);
        }

      case 'runway':
        if (generationType === 'text-to-video' || generationType === 'image-to-video') {
          return await computeRunwayVideoCost(mockReq);
        } else {
          return await computeRunwayImageCost(mockReq);
        }

      case 'bfl':
        return await computeBflCost(mockReq);

      default:
        logger.warn({ provider, generationType }, '[QueuePricing] Unknown provider, using default cost');
        return { cost: 10, pricingVersion: 'default-v1', meta: { provider, generationType, note: 'Default cost' } };
    }
  } catch (error: any) {
    logger.error({ provider, generationType, error: error.message }, '[QueuePricing] Failed to compute cost');
    // Return a safe default cost
    return { cost: 10, pricingVersion: 'error-v1', meta: { provider, generationType, error: error.message } };
  }
}

