import { Request, Response, NextFunction } from 'express';
import '../types/http';

import { formatApiResponse } from '../utils/formatApiResponse';
import {falService, falQueueService} from '../services/falService';
import { creditsRepository } from '../repository/creditsRepository';
import { postSuccessDebit } from '../utils/creditDebit';
import { logger } from '../utils/logger';
import { uploadDataUriToZata } from '../utils/storage/zataUpload';
import { authRepository } from '../repository/auth/authRepository';
import { userAudioRepository } from '../repository/userAudioRepository';
import { deleteFile, extractKeyFromUrl } from '../utils/storage/zataDelete';
import { ApiError } from '../utils/errorHandler';

async function generate(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = req.body || {};
    const uid = req.uid;
    const ctx = (req as any).context || {};
    logger.info({ uid, ctx }, '[CREDITS][FAL] Enter generate with context');
    const result = await falService.generate(uid, payload);
    const debitOutcome = await postSuccessDebit(uid, result, ctx, 'fal', 'generate');
    
    // Determine appropriate message based on generation type
    const generationType = payload.generationType || '';
    const model = (payload.model || '').toLowerCase();
    let message = 'Images generated';
    if (generationType === 'text-to-speech' || generationType === 'tts' || model.includes('tts') || model.includes('elevenlabs') || model.includes('chatterbox') || model.includes('maya')) {
      message = 'Speech generated';
    } else if (generationType === 'text-to-dialogue' || generationType === 'dialogue' || model.includes('dialogue')) {
      message = 'Dialogue generated';
    } else if (generationType === 'text-to-music' || model.includes('music')) {
      message = 'Music generated';
    }
    
    res.json(formatApiResponse('success', message, { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
  } catch (err) {
    next(err);
  }
}

export const falController = {
  generate,
  async briaExpandImage(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falService.briaExpandImage(uid, req.body || {});
      const debitOutcome = await postSuccessDebit(uid, result, ctx, 'fal', 'bria.expand');
      res.json(formatApiResponse('success', 'Expanded', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
  async outpaintImage(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falService.outpaintImage(uid, req.body || {});
      const debitOutcome = await postSuccessDebit(uid, result, ctx, 'fal', 'outpaint');
      res.json(formatApiResponse('success', 'Outpainted', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
  async topazUpscaleImage(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falService.topazUpscaleImage(uid, req.body || {});
      const debitOutcome = await postSuccessDebit(uid, result, ctx, 'fal', 'topaz.upscale.image');
      res.json(formatApiResponse('success', 'Upscaled', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
  async seedvrUpscale(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falService.seedvrUpscale(uid, req.body || {});
      const debitOutcome = await postSuccessDebit(uid, result, ctx, 'fal', 'seedvr.upscale');
      res.json(formatApiResponse('success', 'Upscaled', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
  async birefnetVideo(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await (falService as any).birefnetVideo(uid, req.body || {});
      const debitOutcome = await postSuccessDebit(uid, result, ctx, 'fal', 'birefnet.video');
      res.json(formatApiResponse('success', 'Background removed', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
  async image2svg(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falService.image2svg(uid, req.body || {});
      const debitOutcome = await postSuccessDebit(uid, result, ctx, 'fal', 'image2svg');
      res.json(formatApiResponse('success', 'Converted to SVG', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
  async recraftVectorize(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falService.recraftVectorize(uid, req.body || {});
      const debitOutcome = await postSuccessDebit(uid, result, ctx, 'fal', 'recraft.vectorize');
      res.json(formatApiResponse('success', 'Vectorized to SVG', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
  async briaGenfill(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await (falService as any).briaGenfill(uid, req.body || {});
      const debitOutcome = await postSuccessDebit(uid, result, ctx, 'fal', 'bria.genfill');
      res.json(formatApiResponse('success', 'Generated', { ...result, debitedCredits: ctx.creditCost, debitStatus: debitOutcome }));
    } catch (err) { next(err); }
  },
  // Queue
  async veoTtvSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veoTtvSubmit(uid, req.body || {}, false);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veoTtvFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veoTtvSubmit(uid, req.body || {}, true);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31TtvSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31TtvSubmit(uid, req.body || {}, false);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31TtvFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31TtvSubmit(uid, req.body || {}, true);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veoI2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veoI2vSubmit(uid, req.body || {}, false);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31I2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31I2vSubmit(uid, req.body || {}, false);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31I2vFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31I2vSubmit(uid, req.body || {}, true);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31FirstLastFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31FirstLastFastSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31ReferenceToVideoSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31ReferenceToVideoSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veo31FirstLastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veo31FirstLastSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async sora2I2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.sora2I2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async sora2ProI2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.sora2ProI2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async sora2T2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.sora2T2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async sora2ProT2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.sora2ProT2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async sora2RemixV2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.sora2RemixV2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async ltx2ProI2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.ltx2ProI2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async ltx2FastI2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.ltx2FastI2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async ltx2ProT2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.ltx2ProT2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async ltx2FastT2vSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.ltx2FastT2vSubmit(uid, req.body || {});
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async veoI2vFastSubmit(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const ctx = (req as any).context || {};
      const result = await falQueueService.veoI2vSubmit(uid, req.body || {}, true);
      res.json(formatApiResponse('success', 'Submitted', { ...result, expectedDebit: ctx.creditCost }));
    } catch (err) { next(err); }
  },
  async queueStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const model = (req.query.model as string) || (req.body?.model as string);
      const requestId = (req.query.requestId as string) || (req.body?.requestId as string);
      // Disable caching for polling endpoints
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      const result = await falQueueService.queueStatus(uid, model, requestId);
      res.json(formatApiResponse('success', 'Status', result));
    } catch (err) { next(err); }
  },
  async queueResult(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const model = (req.query.model as string) || (req.body?.model as string);
      const requestId = (req.query.requestId as string) || (req.body?.requestId as string);
      // Disable caching for polling endpoints
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      const result = await falQueueService.queueResult(uid, model, requestId);
      res.json(formatApiResponse('success', 'Result', result));
    } catch (err) { next(err); }
  },
  async uploadVoice(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const { audioData, fileName } = req.body;
      
      if (!audioData || typeof audioData !== 'string') {
        return res.status(400).json(formatApiResponse('error', 'audioData is required and must be a data URI', null));
      }
      
      if (!audioData.startsWith('data:audio/')) {
        return res.status(400).json(formatApiResponse('error', 'Invalid audio data URI', null));
      }
      
      if (!fileName || typeof fileName !== 'string' || fileName.trim().length === 0) {
        return res.status(400).json(formatApiResponse('error', 'fileName is required', null));
      }
      
      const trimmedFileName = fileName.trim();
      
      // Check for duplicate file name
      const nameExists = await userAudioRepository.checkFileNameExists(uid, trimmedFileName);
      
      if (nameExists) {
        return res.status(400).json(formatApiResponse('error', `Name "${trimmedFileName}" is already taken. Please try a different name.`, null));
      }
      
      // Get user info for storage path
      const creator = await authRepository.getUserById(uid);
      const username = creator?.username || uid;
      const keyPrefix = `users/${username}/inputaudio`;
      
      // Upload to Zata storage
      const stored = await uploadDataUriToZata({
        dataUri: audioData,
        keyPrefix,
        fileName: trimmedFileName,
      });
      
      // Store in database with name (single entry)
      await userAudioRepository.createUserAudio(uid, {
        fileName: trimmedFileName,
        url: stored.publicUrl,
        storagePath: stored.key,
      });
      
      res.json(formatApiResponse('success', 'Voice file uploaded', { url: stored.publicUrl, storagePath: stored.key, fileName: trimmedFileName }));
    } catch (err) {
      next(err);
    }
  },
  async listUserAudioFiles(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const audioFiles = await userAudioRepository.getUserAudioFiles(uid);
      
      res.json(formatApiResponse('success', 'Audio files retrieved', { audioFiles }));
    } catch (err) {
      next(err);
    }
  },
  async deleteUserAudioFile(req: Request, res: Response, next: NextFunction) {
    try {
      const uid = req.uid;
      const audioId = req.params.audioId;
      if (!audioId) {
        throw new ApiError('audioId is required', 400);
      }
      
      const audioDoc = await userAudioRepository.getUserAudioById(uid, audioId);
      if (!audioDoc) {
        throw new ApiError('Audio file not found', 404);
      }
      
      const storageKey = audioDoc.storagePath || extractKeyFromUrl(audioDoc.url || '');
      if (storageKey) {
        await deleteFile(storageKey);
      }
      
      await userAudioRepository.deleteUserAudio(uid, audioId);
      
      res.json(formatApiResponse('success', 'Audio file deleted', { audioId }));
    } catch (err) {
      next(err);
    }
  },
};

