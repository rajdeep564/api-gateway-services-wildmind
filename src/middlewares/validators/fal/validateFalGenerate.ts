import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { ApiError } from '../../../utils/errorHandler';
import { probeVideoMeta } from '../../../utils/media/probe';
import { probeImageMeta } from '../../../utils/media/imageProbe';
import { uploadDataUriToZata } from '../../../utils/storage/zataUpload';

export const ALLOWED_FAL_MODELS = [
  'gemini-25-flash-image',
  'seedream-v4',
  'seedream-4.5',
  // Imagen 4 image generation variants (frontend model keys)
  'imagen-4-ultra',
  'imagen-4',
  'imagen-4-fast',
  // Flux 2 Pro
  'flux-2-pro',
  // Google Nano Banana Pro
  'google/nano-banana-pro',
  'nano-banana-pro',
  // ElevenLabs / text-to-dialogue variants // all will call same model 
  'eleven-v3',
  'elevenlabs-dialogue',
  'elevenlabs-text-to-dialogue',
  'elevenlabs-text-to-dialogue-eleven-v3',
  // ElevenLabs TTS variants // all will call same model but this is text to speech 
  'elevenlabs-tts',
  'elevenlabs-tts-eleven-v3',
  'elevenlabs-sfx',
  // Maya TTS variants
  'maya',
  'maya-tts',
  'maya-1-voice',
  // Chatterbox multilingual TTS
  'chatterbox-text-to-speech-multilingual',
  'chatterbox-multilingual',
  // Chatterbox speech-to-speech (resemble-ai)
  'resemble-ai/chatterboxhd/speech-to-speech',
  'chatterbox-sts',
];

export const validateFalGenerate = [
  // Make prompt optional at the base validator level; enforce conditionally below
  body('prompt').optional().isString(),
  body('generationType').optional().isIn(['text-to-image', 'logo', 'sticker-generation', 'text-to-video', 'text-to-music', 'mockup-generation', 'product-generation', 'ad-generation', 'live-chat', 'text-to-character']).withMessage('invalid generationType'),
  body('model').isString().isIn(ALLOWED_FAL_MODELS),
  body('aspect_ratio').optional().isIn(['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']),
  body('image_size').optional().custom((value) => {
    // Allow enum string or custom object with width/height
    if (typeof value === 'string') {
      return [
        'square_hd',
        'square',
        'portrait_4_3',
        'portrait_16_9',
        'landscape_4_3',
        'landscape_16_9',
        'auto_2K',
        'auto_4K',
      ].includes(value);
    }
    if (typeof value === 'object' && value !== null) {
      const width = Number(value.width);
      const height = Number(value.height);
      return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    }
    return false;
  }).withMessage('image_size must be a valid enum string or object with width and height'),
  body('safety_tolerance').optional().isIn(['1', '2', '3', '4', '5']),
  body('enable_safety_checker').optional().isBoolean(),
  body('n').optional().isInt({ min: 1, max: 10 }),
  body('num_images').optional().isInt({ min: 1, max: 10 }),
  body('uploadedImages').optional().isArray(),
  body('output_format').optional().isIn(['jpeg', 'png', 'webp']),
  body('resolution').optional().isIn(['1K', '2K', '4K']),
  body('seed').optional().isInt(),
  body('negative_prompt').optional().isString(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));

    // Conditional prompt requirement: only certain generation types require a textual `prompt`.
    // Make a whitelist of generation types that must include `prompt`.
    const genType: string | undefined = req.body?.generationType;
    const requiresPrompt = new Set([
      'text-to-image',
      'logo',
      'sticker-generation',
      'text-to-video',
      'mockup-generation',
      'product-generation',
      'ad-generation',
      'live-chat',
      'text-to-character'
    ]);

    // If generationType is not provided, keep backward compatibility and require prompt.
    if (!genType) {
      if (!req.body?.prompt || typeof req.body.prompt !== 'string' || req.body.prompt.trim().length === 0) {
        return next(new ApiError('prompt is required', 400));
      }
    } else {
      // If the chosen generation type requires a prompt, enforce it.
      if (requiresPrompt.has(genType)) {
        if (!req.body?.prompt || typeof req.body.prompt !== 'string' || req.body.prompt.trim().length === 0) {
          return next(new ApiError(`prompt is required for generationType ${genType}`, 400));
        }
      }
      // For generation types such as `text-to-music` we allow other fields and do not force `prompt`.
    }

    next();
  }
];

// Maya TTS validator (Maya-1-Voice)
export const validateFalMayaTts = [
  body('text').isString().notEmpty().withMessage('text is required').isLength({ max: 1000 }).withMessage('text must be at most 1000 characters'),
  body('prompt').optional().isString(),
  body('temperature').optional().isFloat({ min: 0, max: 2 }).withMessage('temperature must be a number'),
  body('top_p').optional().isFloat({ min: 0, max: 1 }).withMessage('top_p must be between 0 and 1'),
  body('max_tokens').optional().isInt({ min: 1 }).withMessage('max_tokens must be an integer'),
  body('repetition_penalty').optional().isFloat({ min: 0.1 }).withMessage('repetition_penalty must be a number'),
  body('output_format').optional().isIn(['wav', 'mp3']).withMessage('output_format must be wav or mp3'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Chatterbox Multilingual TTS validator
export const validateFalChatterboxMultilingual = [
  body('text').isString().notEmpty().isLength({ max: 2000 }).withMessage('text is required and must be <= 2000 characters'),
  body('voice').optional().isString().withMessage('voice must be a string'),
  body('custom_audio_language').optional().isIn(['english', 'arabic', 'danish', 'german', 'greek', 'spanish', 'finnish', 'french', 'hebrew', 'hindi', 'italian', 'japanese', 'korean', 'malay', 'dutch', 'norwegian', 'polish', 'portuguese', 'russian', 'swedish', 'swahili', 'turkish', 'chinese']).withMessage('custom_audio_language must be one of the allowed language codes'),
  body('voice_file_name').optional().isString().withMessage('voice_file_name must be a string if provided'),
  body('exaggeration').optional().isFloat({ min: 0.0, max: 2.0 }).withMessage('exaggeration must be between 0.0 and 2.0'),
  body('temperature').optional().isFloat({ min: 0.0, max: 2.0 }).withMessage('temperature must be between 0.0 and 2.0'),
  body('cfg_scale').optional().isFloat({ min: 0, max: 1 }).withMessage('cfg_scale must be between 0 and 1'),
  body('seed').optional().isInt().withMessage('seed must be an integer'),

  body('audio_url').optional().isString().withMessage('audio_url must be a string URL if provided'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));

    // If voice is a custom audio URL (starts with http:// or https://), require custom_audio_language
    const voice = req.body?.voice;
    const customAudioLanguage = req.body?.custom_audio_language;
    if (voice && typeof voice === 'string' && (voice.startsWith('http://') || voice.startsWith('https://'))) {
      if (!customAudioLanguage) {
        return next(new ApiError('custom_audio_language is required when voice is a custom audio URL', 400));
      }
    }

    next();
  }
];

// Chatterbox Speech-to-Speech (STS) validator
export const validateFalChatterboxSts = [
  body('source_audio_url').isString().notEmpty().withMessage('source_audio_url is required'),
  body('target_voice').optional().isString().withMessage('target_voice must be a string'),
  body('target_voice_audio_url').optional().isString().withMessage('target_voice_audio_url must be a string'),
  body('high_quality_audio').optional().isBoolean().withMessage('high_quality_audio must be boolean'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];
// Veo3 Text-to-Video (standard and fast)
export const validateFalVeoTextToVideo = [
  body('prompt').isString().notEmpty(),
  body('aspect_ratio').optional().isIn(['16:9', '9:16', '1:1']),
  body('duration').optional().isIn(['4s', '6s', '8s']),
  body('negative_prompt').optional().isString(),
  body('enhance_prompt').optional().isBoolean(),
  body('seed').optional().isInt(),
  body('auto_fix').optional().isBoolean(),
  body('resolution').optional().isIn(['720p', '1080p']),
  body('generate_audio').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

export const validateFalVeoTextToVideoFast = validateFalVeoTextToVideo;

// Veo3 Image-to-Video (standard and fast)
export const validateFalVeoImageToVideo = [
  body('prompt').isString().notEmpty(),
  body('image_url').isString().notEmpty(),
  body('aspect_ratio').optional().isIn(['auto', '16:9', '9:16']),
  // Allow 4s, 6s or 8s durations (was only '8s')
  body('duration').optional().isIn(['4s', '6s', '8s']),
  body('generate_audio').optional().isBoolean(),
  body('resolution').optional().isIn(['720p', '1080p']),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

export const validateFalVeoImageToVideoFast = validateFalVeoImageToVideo;

// ElevenLabs Text-to-Dialogue validator
export const validateFalElevenDialogue = [
  body('inputs').isArray({ min: 1 }).withMessage('inputs must be a non-empty array'),
  body('inputs.*.text').isString().notEmpty().withMessage('each input must contain text').isLength({ max: 1000 }).withMessage('each input text must be at most 1000 characters'),
  body('inputs.*.voice').optional().isString(),
  body('stability').optional().isFloat({ min: 0, max: 1 }).withMessage('stability must be between 0 and 1'),
  body('use_speaker_boost').optional().isBoolean(),
  body('pronunciation_dictionary_locators').optional().isArray({ max: 3 }),
  body('seed').optional().isInt(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// ElevenLabs Text-to-Speech (TTS) validator
export const validateFalElevenTts = [
  body('text').isString().notEmpty().withMessage('text is required').isLength({ max: 1000 }).withMessage('text must be at most 1000 characters'),
  body('model').optional().isString().withMessage('model must be a string'),
  body('voice').optional().isString().withMessage('voice must be a string'),
  body('custom_audio_language').optional().isIn(['english', 'arabic', 'danish', 'german', 'greek', 'spanish', 'finnish', 'french', 'hebrew', 'hindi', 'italian', 'japanese', 'korean', 'malay', 'dutch', 'norwegian', 'polish', 'portuguese', 'russian', 'swedish', 'swahili', 'turkish', 'chinese']).withMessage('custom_audio_language must be one of the allowed values'),
  body('exaggeration').optional().isFloat({ min: 0.25, max: 2.0 }).withMessage('exaggeration must be between 0.25 and 2.0'),
  body('stability').optional().isFloat({ min: 0, max: 1 }).withMessage('stability must be between 0 and 1'),
  body('similarity_boost').optional().isFloat({ min: 0, max: 1 }).withMessage('similarity_boost must be between 0 and 1'),
  body('style').optional().isFloat({ min: 0, max: 1 }).withMessage('style must be between 0 and 1'),
  body('speed').optional().isFloat({ min: 0.5, max: 2.5 }).withMessage('speed must be between 0.5 and 2.5'), // Relaxed backend limit to allow UI 0.0-1.2 and potential future expansion
  body('temperature').optional().isFloat({ min: 0.05, max: 5.0 }).withMessage('temperature must be between 0.05 and 5.0'),
  body('cfg_scale').optional().isFloat({ min: 0.0, max: 1.0 }).withMessage('cfg_scale must be between 0.0 and 1.0'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('[validateFalElevenTts] ❌ Validation failed:', JSON.stringify(errors.array(), null, 2));
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];

// ElevenLabs Sound Effects (SFX) validator
export const validateFalElevenSfx = [
  body('text').isString().notEmpty().withMessage('text is required'),
  body('duration_seconds').optional().isFloat({ min: 0.5, max: 22 }).withMessage('duration_seconds must be between 0.5 and 22 seconds'),
  body('prompt_influence').optional().isFloat({ min: 0, max: 1 }).withMessage('prompt_influence must be between 0 and 1'),
  body('output_format').optional().isIn(['mp3_22050_32', 'mp3_44100_32', 'mp3_44100_64', 'mp3_44100_96', 'mp3_44100_128', 'mp3_44100_192', 'pcm_8000', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'ulaw_8000', 'alaw_8000', 'opus_48000_32', 'opus_48000_64', 'opus_48000_96', 'opus_48000_128', 'opus_48000_192']).withMessage('output_format must be one of the allowed audio formats'),
  body('loop').optional().isBoolean().withMessage('loop must be a boolean'),
  body('fileName').optional().isString().withMessage('fileName must be a string'),
  body('lyrics').optional().isString().withMessage('lyrics must be a string'),
  body('generationType').optional().isIn(['sfx']).withMessage('generationType must be sfx'),
  body('model').optional().isString().withMessage('model must be a string'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Queue validators
export const validateFalQueueStatus = [
  body('requestId').optional().isString(), // in case of POST body
  (req: Request, _res: Response, next: NextFunction) => {
    const requestId = (req.query.requestId as string) || (req.body?.requestId as string);
    if (!requestId) return next(new ApiError('requestId is required', 400));
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

export const validateFalQueueResult = validateFalQueueStatus;

// Kling 2.6 Pro Text-to-Video validator
export const validateFalKling26ProT2v = [
  body('prompt').isString().notEmpty(),
  body('aspect_ratio').optional().isIn(['16:9', '9:16', '1:1']),
  body('duration').optional().custom((value) => {
    // Accept "5", "10", "5s", "10s", or numbers 5, 10
    if (value == null) return true; // Optional field
    const normalized = typeof value === 'number' ? String(value) : String(value).replace(/s$/i, '');
    return ['5', '10'].includes(normalized);
  }).withMessage('duration must be 5 or 10'),
  body('negative_prompt').optional().isString(),
  body('cfg_scale').optional().isFloat({ min: 0, max: 1 }),
  body('generate_audio').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    // Normalize duration: ensure it's a string "5" or "10"
    const d = (req.body as any)?.duration;
    if (typeof d === 'number') {
      (req.body as any).duration = d === 10 ? '10' : '5';
    } else if (d && typeof d === 'string') {
      // Remove "s" suffix if present and normalize
      const normalized = d.replace(/s$/i, '');
      (req.body as any).duration = normalized === '10' ? '10' : '5';
    } else if (!d) {
      (req.body as any).duration = '5'; // Default to 5
    }
    next();
  }
];

// Kling 2.6 Pro Image-to-Video validator
export const validateFalKling26ProI2v = [
  body('prompt').isString().notEmpty(),
  body('image_url').isString().notEmpty(),
  body('duration').optional().custom((value) => {
    // Accept "5", "10", "5s", "10s", or numbers 5, 10
    if (value == null) return true; // Optional field
    const normalized = typeof value === 'number' ? String(value) : String(value).replace(/s$/i, '');
    return ['5', '10'].includes(normalized);
  }).withMessage('duration must be 5 or 10'),
  body('negative_prompt').optional().isString(),
  body('cfg_scale').optional().isFloat({ min: 0, max: 1 }),
  body('generate_audio').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    // Normalize duration: ensure it's a string "5" or "10"
    const d = (req.body as any)?.duration;
    if (typeof d === 'number') {
      (req.body as any).duration = d === 10 ? '10' : '5';
    } else if (d && typeof d === 'string') {
      // Remove "s" suffix if present and normalize
      const normalized = d.replace(/s$/i, '');
      (req.body as any).duration = normalized === '10' ? '10' : '5';
    } else if (!d) {
      (req.body as any).duration = '5'; // Default to 5
    }
    next();
  }
];

export const validateFalVeoTextToVideoSubmit = validateFalVeoTextToVideo;
export const validateFalVeoTextToVideoFastSubmit = validateFalVeoTextToVideoFast;
export const validateFalVeoImageToVideoSubmit = validateFalVeoImageToVideo;
// Allow 4s/6s/8s for fast I2V and coerce numeric durations to the expected string format
export const validateFalVeoImageToVideoFastSubmit = [
  ...validateFalVeoImageToVideoFast,
  (req: Request, _res: Response, next: NextFunction) => {
    const d = (req.body as any)?.duration;
    if (typeof d === 'number') {
      const mapped = d === 4 || d === 6 || d === 8 ? `${d}s` : '8s';
      (req.body as any).duration = mapped;
    }
    // If duration is not in allowed list, default to 8s
    if (req.body.duration && !['4s', '6s', '8s'].includes(req.body.duration)) {
      req.body.duration = '8s';
    }
    next();
  }
];

// NanoBanana uses unified generate/queue; no separate validators

// Veo 3.1 First/Last Frame to Video (Fast)
export const validateFalVeo31FirstLastFast = [
  body('prompt').isString().notEmpty(),
  // Accept either our previous naming or FAL's canonical keys
  body('start_image_url').optional().isString(),
  body('last_frame_image_url').optional().isString(),
  body('first_frame_url').optional().isString(),
  body('last_frame_url').optional().isString(),
  body('aspect_ratio').optional().isIn(['auto', '16:9', '9:16']),
  body('duration').optional().isIn(['4s', '6s', '8s']),
  body('generate_audio').optional().isBoolean(),
  body('resolution').optional().isIn(['720p', '1080p']),
  (req: Request, _res: Response, next: NextFunction) => {
    // Require at least a first frame; last frame optional (if provided we treat as FLF2V)
    const hasFirst = typeof (req.body?.start_image_url) === 'string' || typeof (req.body?.first_frame_url) === 'string';
    if (!hasFirst) {
      return next(new ApiError('first_frame_url is required (alias: start_image_url)', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Veo 3.1 Reference-to-Video (Standard)
export const validateFalVeo31ReferenceToVideo = [
  body('prompt').isString().notEmpty(),
  body('image_urls').isArray({ min: 1 }).withMessage('image_urls must be a non-empty array of URLs'),
  body('image_urls.*').isString().notEmpty(),
  body('duration').optional().isIn(['8s']),
  body('resolution').optional().isIn(['720p', '1080p']),
  body('generate_audio').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Kling o1 First/Last Frame to Video (standard model - requires both images)
export const validateFalKlingO1FirstLastSubmit = [
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('start_image_url').optional().isString(),
  body('first_frame_url').optional().isString(),
  body('end_image_url').optional().isString(),
  body('last_frame_url').optional().isString(),
  body('duration').optional().custom((value) => {
    // Accept both string and number, but validate as "5" or "10"
    const str = typeof value === 'string' ? value : String(value);
    return str === '5' || str === '10';
  }).withMessage('duration must be "5" or "10"'),
  (req: Request, _res: Response, next: NextFunction) => {
    // Normalize aliases
    if (!req.body.start_image_url && typeof req.body.first_frame_url === 'string') {
      req.body.start_image_url = req.body.first_frame_url;
    }
    if (!req.body.end_image_url && typeof req.body.last_frame_url === 'string') {
      req.body.end_image_url = req.body.last_frame_url;
    }

    const hasFirst = typeof req.body?.start_image_url === 'string' && req.body.start_image_url.length > 0;
    const hasLast = typeof req.body?.end_image_url === 'string' && req.body.end_image_url.length > 0;

    if (!hasFirst) {
      return next(new ApiError('start_image_url is required (alias: first_frame_url)', 400));
    }
    if (!hasLast) {
      return next(new ApiError('end_image_url is required (alias: last_frame_url)', 400));
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Kling o1 Reference to Video (single image or multiple images)
export const validateFalKlingO1ReferenceSubmit = [
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('image_urls').isArray().withMessage('image_urls must be an array'),
  body('image_urls').custom((value) => {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error('image_urls must contain at least one image URL');
    }
    if (value.length > 7) {
      throw new Error('image_urls must contain at most 7 images');
    }
    return true;
  }).withMessage('image_urls must contain 1-7 image URLs'),
  body('image_urls.*').isString().withMessage('Each image_urls item must be a string'),
  body('duration').optional().custom((value) => {
    const str = typeof value === 'string' ? value : String(value);
    return str === '5' || str === '10';
  }).withMessage('duration must be "5" or "10"'),
  body('aspect_ratio').optional().isIn(['16:9', '9:16', '1:1']).withMessage('aspect_ratio must be "16:9", "9:16", or "1:1"'),
  body('elements').optional().isArray().withMessage('elements must be an array'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Sora 2 Image-to-Video (Standard)
export const validateFalSora2I2v = [
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('image_url').isString().notEmpty().withMessage('image_url is required'),
  body('resolution').optional({ nullable: true, checkFalsy: false }).isIn(['auto', '720p']).withMessage('resolution must be auto or 720p'),
  body('aspect_ratio').optional({ nullable: true, checkFalsy: false }).isIn(['auto', '16:9', '9:16']).withMessage('aspect_ratio must be auto, 16:9, or 9:16'),
  body('duration').optional({ nullable: true, checkFalsy: false }).custom((value) => {
    // Accept both number and string, but validate the value
    const numValue = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (isNaN(numValue)) return false;
    return [4, 8, 12].includes(numValue);
  }).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional({ nullable: true, checkFalsy: false }).isString(),
  body('originalPrompt').optional({ nullable: true, checkFalsy: false }).isString(), // Allow for history display
  body('isPublic').optional({ nullable: true, checkFalsy: false }).isBoolean(), // Allow for history visibility
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('[validateFalSora2I2v] Validation errors:', errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];

// Sora 2 Image-to-Video (Pro)
export const validateFalSora2ProI2v = [
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('image_url').isString().notEmpty().withMessage('image_url is required'),
  body('resolution').optional({ nullable: true, checkFalsy: false }).isIn(['auto', '720p', '1080p']).withMessage('resolution must be auto, 720p, or 1080p'),
  body('aspect_ratio').optional({ nullable: true, checkFalsy: false }).isIn(['auto', '16:9', '9:16']).withMessage('aspect_ratio must be auto, 16:9, or 9:16'),
  body('duration').optional({ nullable: true, checkFalsy: false }).custom((value) => {
    // Accept both number and string, but validate the value
    const numValue = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (isNaN(numValue)) return false;
    return [4, 8, 12].includes(numValue);
  }).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional({ nullable: true, checkFalsy: false }).isString(),
  body('originalPrompt').optional({ nullable: true, checkFalsy: false }).isString(), // Allow for history display
  body('isPublic').optional({ nullable: true, checkFalsy: false }).isBoolean(), // Allow for history visibility
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('[validateFalSora2ProI2v] Validation errors:', errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];

// Veo 3.1 First/Last Frame to Video (Standard)
export const validateFalVeo31FirstLast = [
  body('prompt').isString().notEmpty(),
  body('first_frame_url').optional().isString(),
  body('last_frame_url').optional().isString(),
  // Support alias keys as well for flexibility
  body('start_image_url').optional().isString(),
  body('last_frame_image_url').optional().isString(),
  body('aspect_ratio').optional().isIn(['auto', '16:9', '9:16']),
  body('duration').optional().isIn(['8s', '4s', '6s']),
  body('generate_audio').optional().isBoolean(),
  body('resolution').optional().isIn(['720p', '1080p']),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasFirst = typeof (req.body?.first_frame_url) === 'string' || typeof (req.body?.start_image_url) === 'string';
    if (!hasFirst) {
      return next(new ApiError('first_frame_url is required (aliases: start_image_url)', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// LTX V2 Image-to-Video (Pro)
// LTX V2 I2V (shared)
const validateFalLtx2I2vBase = [
  body('prompt').isString().notEmpty(),
  body('image_url').isString().notEmpty(),
  body('resolution').optional().isIn(['1080p', '1440p', '2160p']),
  body('aspect_ratio').optional().isIn(['auto', '16:9', '9:16']),
  body('duration').optional().isIn([6, 8, 10]).withMessage('duration must be 6, 8, or 10'),
  body('fps').optional().isIn([25, 50]),
  body('generate_audio').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];
export const validateFalLtx2ProI2v = validateFalLtx2I2vBase;

// LTX V2 Image-to-Video (Fast)
export const validateFalLtx2FastI2v = validateFalLtx2I2vBase;

// Sora 2 Text-to-Video (Standard)
export const validateFalSora2T2v = [
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('resolution').optional({ nullable: true, checkFalsy: false }).isIn(['720p']).withMessage('resolution must be 720p'),
  body('aspect_ratio').optional({ nullable: true, checkFalsy: false }).isIn(['16:9', '9:16']).withMessage('aspect_ratio must be 16:9 or 9:16'),
  body('duration').optional({ nullable: true, checkFalsy: false }).custom((value) => {
    // Accept both number and string, but validate the value
    const numValue = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (isNaN(numValue)) return false;
    return [4, 8, 12].includes(numValue);
  }).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional({ nullable: true, checkFalsy: false }).isString(),
  body('originalPrompt').optional({ nullable: true, checkFalsy: false }).isString(), // Allow for history display
  body('isPublic').optional({ nullable: true, checkFalsy: false }).isBoolean(), // Allow for history visibility
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('[validateFalSora2T2v] Validation errors:', errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];

// Sora 2 Text-to-Video (Pro)
export const validateFalSora2ProT2v = [
  body('prompt').isString().notEmpty().withMessage('prompt is required'),
  body('resolution').optional({ nullable: true, checkFalsy: false }).isIn(['720p', '1080p']).withMessage('resolution must be 720p or 1080p'),
  body('aspect_ratio').optional({ nullable: true, checkFalsy: false }).isIn(['16:9', '9:16']).withMessage('aspect_ratio must be 16:9 or 9:16'),
  body('duration').optional({ nullable: true, checkFalsy: false }).custom((value) => {
    // Accept both number and string, but validate the value
    const numValue = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (isNaN(numValue)) return false;
    return [4, 8, 12].includes(numValue);
  }).withMessage('duration must be 4, 8, or 12'),
  body('api_key').optional({ nullable: true, checkFalsy: false }).isString(),
  body('originalPrompt').optional({ nullable: true, checkFalsy: false }).isString(), // Allow for history display
  body('isPublic').optional({ nullable: true, checkFalsy: false }).isBoolean(), // Allow for history visibility
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('[validateFalSora2ProT2v] Validation errors:', errors.array());
      return next(new ApiError('Validation failed', 400, errors.array()));
    }
    next();
  }
];

// Sora 2 Video-to-Video Remix
export const validateFalSora2Remix = [
  body('prompt').isString().notEmpty(),
  body('video_id').optional().isString(),
  body('source_history_id').optional().isString(),
  body('api_key').optional().isString(),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasVideoId = typeof req.body?.video_id === 'string' && req.body.video_id.length > 0;
    const hasSource = typeof req.body?.source_history_id === 'string' && req.body.source_history_id.length > 0;
    if (!hasVideoId && !hasSource) {
      return next(new ApiError('Either video_id or source_history_id is required', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Sora 2 Video-to-Video Remix (by history only)
export const validateFalSora2RemixByHistory = [
  body('prompt').isString().notEmpty(),
  body('source_history_id').isString().notEmpty(),
  body('api_key').optional().isString(),
  (req: Request, _res: Response, next: NextFunction) => {
    if (req.body?.video_id) {
      return next(new ApiError('Do not provide video_id on this route; it resolves from source_history_id', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// LTX V2 T2V (shared)
const validateFalLtx2T2vBase = [
  body('prompt').isString().notEmpty(),
  body('resolution').optional().isIn(['1080p', '1440p', '2160p']),
  body('aspect_ratio').optional().isIn(['16:9']).withMessage('Only 16:9 is supported'),
  body('duration').optional().isIn([6, 8, 10]).withMessage('duration must be 6, 8, or 10'),
  body('fps').optional().isIn([25, 50]),
  body('generate_audio').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];
export const validateFalLtx2ProT2v = validateFalLtx2T2vBase;
export const validateFalLtx2FastT2v = validateFalLtx2T2vBase;

// Image to SVG (fal-ai/image2svg)
export const validateFalImage2Svg = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  body('colormode').optional().isIn(['color', 'binary']),
  body('hierarchical').optional().isIn(['stacked', 'cutout']),
  body('mode').optional().isIn(['spline', 'polygon']),
  body('filter_speckle').optional().isInt(),
  body('color_precision').optional().isInt(),
  body('layer_difference').optional().isInt(),
  body('corner_threshold').optional().isInt(),
  body('length_threshold').optional().isFloat(),
  body('max_iterations').optional().isInt(),
  body('splice_threshold').optional().isInt(),
  body('path_precision').optional().isInt(),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasUrl = typeof req.body?.image_url === 'string' && req.body.image_url.length > 0;
    const hasImage = typeof req.body?.image === 'string' && req.body.image.length > 0;
    if (!hasUrl && !hasImage) return next(new ApiError('image_url or image is required', 400));
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

export const validateFalOutpaint = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  body('expand_left').optional().isInt({ min: 0, max: 700 }),
  body('expand_right').optional().isInt({ min: 0, max: 700 }),
  body('expand_top').optional().isInt({ min: 0, max: 700 }),
  body('expand_bottom').optional().isInt({ min: 0, max: 700 }),
  body('zoom_out_percentage').optional().isFloat({ min: 0, max: 100 }),
  body('prompt').optional().isString(),
  body('num_images').optional().isInt({ min: 1, max: 4 }),
  body('enable_safety_checker').optional().isBoolean(),
  body('sync_mode').optional().isBoolean(),
  body('output_format').optional().isIn(['png', 'jpeg', 'jpg', 'webp']),
  body('aspect_ratio').optional().isIn(['1:1', '16:9', '9:16', '4:3', '3:4']),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasUrl = typeof req.body?.image_url === 'string' && req.body.image_url.length > 0;
    const hasImage = typeof req.body?.image === 'string' && req.body.image.length > 0;
    if (!hasUrl && !hasImage) return next(new ApiError('image_url or image is required', 400));
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Bria Expand (fal-ai/bria/expand)
export const validateFalBriaExpand = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  body('canvas_size').optional().isArray({ min: 2, max: 2 }),
  body('canvas_size.*').optional().isInt({ min: 1, max: 5000 }),
  body('aspect_ratio').optional().isIn(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9']),
  body('original_image_size').optional().isArray({ min: 2, max: 2 }),
  body('original_image_size.*').optional().isInt({ min: 1, max: 5000 }),
  body('original_image_location').optional().isArray({ min: 2, max: 2 }),
  body('original_image_location.*').optional().isInt({ min: -10000, max: 10000 }),
  body('prompt').optional().isString(),
  body('seed').optional().isInt(),
  body('negative_prompt').optional().isString(),
  body('sync_mode').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasUrl = typeof req.body?.image_url === 'string' && req.body.image_url.length > 0;
    const hasImage = typeof req.body?.image === 'string' && req.body.image.length > 0;
    if (!hasUrl && !hasImage) return next(new ApiError('image_url or image is required', 400));
    // Optional safety: if canvas_size is given, enforce area <= 5000x5000
    if (Array.isArray(req.body?.canvas_size) && req.body.canvas_size.length === 2) {
      const w = Number(req.body.canvas_size[0]);
      const h = Number(req.body.canvas_size[1]);
      if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0 || w > 5000 || h > 5000) {
        return next(new ApiError('canvas_size must be [width,height] each <= 5000', 400));
      }
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Bria GenFill (fal-ai/bria/genfill)
export const validateFalBriaGenfill = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  body('mask_url').optional().isString().notEmpty(),
  body('mask').optional().isString().notEmpty(),
  body('prompt').isString().notEmpty(),
  body('negative_prompt').optional().isString(),
  body('seed').optional().isInt(),
  body('num_images').optional().isInt({ min: 1, max: 4 }),
  body('sync_mode').optional().isBoolean(),
  (req: Request, _res: Response, next: NextFunction) => {
    const hasImageUrl = typeof req.body?.image_url === 'string' && req.body.image_url.length > 0;
    const hasImage = typeof req.body?.image === 'string' && req.body.image.length > 0;
    if (!hasImageUrl && !hasImage) {
      return next(new ApiError('image_url or image is required', 400));
    }
    const hasMaskUrl = typeof req.body?.mask_url === 'string' && req.body.mask_url.length > 0;
    const hasMask = typeof req.body?.mask === 'string' && req.body.mask.length > 0;
    if (!hasMaskUrl && !hasMask) {
      return next(new ApiError('mask_url or mask is required', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Recraft Vectorize (fal-ai/recraft/vectorize)
export const validateFalRecraftVectorize = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  (req: Request, _res: Response, next: NextFunction) => {
    // Require either a public URL or a data URI/image string
    const hasUrl = typeof req.body?.image_url === 'string' && req.body.image_url.length > 0;
    const hasImage = typeof req.body?.image === 'string' && req.body.image.length > 0;
    if (!hasUrl && !hasImage) {
      return next(new ApiError('image_url or image is required', 400));
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// SeedVR2 Video Upscaler (fal-ai/seedvr/upscale/video)
export const validateFalSeedvrUpscale = [
  // Only validate video_url if it's provided AND video (data URI) is not provided
  body('video_url').optional().custom((value, { req }) => {
    const hasVideo = typeof (req.body as any)?.video === 'string' && String((req.body as any).video).startsWith('data:');
    // If video (data URI) is provided, video_url is optional
    if (hasVideo) return true;
    // If video_url is provided, it must be a non-empty string
    if (value !== undefined && value !== null) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('video_url must be a non-empty string if provided');
      }
    }
    return true;
  }),
  body('video').optional().isString().withMessage('video must be a string if provided'), // allow data URI video as fallback
  body('upscale_mode').optional().isIn(['target', 'factor']).withMessage('upscale_mode must be target or factor'),
  body('upscale_factor').optional().isFloat({ gt: 0.1, lt: 10 }).withMessage('upscale_factor must be between 0.1 and 10'),
  body('target_resolution').optional().isIn(['720p', '1080p', '1440p', '2160p']),
  body('seed').optional().isInt(),
  body('noise_scale').optional().isFloat({ min: 0, max: 2 }),
  body('output_format').optional().isIn(['X264 (.mp4)', 'VP9 (.webm)', 'PRORES4444 (.mov)', 'GIF (.gif)']),
  body('output_quality').optional().isIn(['low', 'medium', 'high', 'maximum']),
  body('output_write_mode').optional().isIn(['fast', 'balanced', 'small']),
  async (req: Request, _res: Response, next: NextFunction) => {
    // Ensure either video_url or video (data URI) is provided
    const hasVideoUrl = typeof req.body?.video_url === 'string' && req.body.video_url.trim().length > 0;
    const hasVideoData = typeof (req.body as any)?.video === 'string' && String((req.body as any).video).startsWith('data:');

    if (!hasVideoUrl && !hasVideoData) {
      return next(new ApiError('Either video_url or video (data URI) is required', 400));
    }

    // If caller sent a data URI under 'video', upload and convert to video_url
    if (hasVideoData && !hasVideoUrl) {
      try {
        const uid = (req as any)?.uid || 'anon';
        const stored = await uploadDataUriToZata({
          dataUri: (req.body as any).video,
          keyPrefix: `users/${uid}/input/seedvr/${Date.now()}`,
          fileName: 'seedvr-source'
        });
        (req.body as any).video_url = stored.publicUrl;
      } catch (e) {
        return next(new ApiError('Failed to upload video data URI to storage', 400));
      }
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    // Validate 30s max video duration by probing the URL
    try {
      const url: string = req.body?.video_url;
      let meta: any;
      try {
        meta = await probeVideoMeta(url);
      } catch (probeErr: any) {
        // If probing fails, log but don't block - FAL will handle validation
        console.warn('[validateFalSeedvrUpscale] Video probe failed:', probeErr?.message || probeErr);
        // Still set defaults and continue
        if (!req.body.upscale_mode) req.body.upscale_mode = 'factor';
        if (req.body.upscale_mode === 'factor' && (req.body.upscale_factor == null)) req.body.upscale_factor = 2;
        if (req.body.upscale_mode === 'target' && !req.body.target_resolution) req.body.target_resolution = '1080p';
        return next();
      }

      const duration = Number(meta?.durationSec || 0);
      if (!isFinite(duration) || duration <= 0) {
        console.warn('[validateFalSeedvrUpscale] Could not read video duration, but continuing - FAL will validate');
        // Don't block - let FAL handle it
      } else if (duration > 30.5) {
        return next(new ApiError('Input video too long. Maximum allowed duration is 30 seconds.', 400));
      }

      // Normalize body defaults
      if (!req.body.upscale_mode) req.body.upscale_mode = 'factor';
      if (req.body.upscale_mode === 'factor' && (req.body.upscale_factor == null)) req.body.upscale_factor = 2;
      if (req.body.upscale_mode === 'target' && !req.body.target_resolution) req.body.target_resolution = '1080p';
      // Stash probed meta for pricing
      (req as any).seedvrProbe = meta;
      next();
    } catch (e: any) {
      console.error('[validateFalSeedvrUpscale] Validation error:', e?.message || e);
      // Don't block on validation errors - let FAL API handle it
      if (!req.body.upscale_mode) req.body.upscale_mode = 'factor';
      if (req.body.upscale_mode === 'factor' && (req.body.upscale_factor == null)) req.body.upscale_factor = 2;
      if (req.body.upscale_mode === 'target' && !req.body.target_resolution) req.body.target_resolution = '1080p';
      next();
    }
  }
];

// BiRefNet v2 Video Background Removal (fal-ai/birefnet/v2/video)
export const validateFalBirefnetVideo = [
  body('video_url').optional().isString().notEmpty(),
  body('video').optional().isString(), // data URI allowed
  body('model').optional().isIn(['General Use (Light)', 'General Use (Light 2K)', 'General Use (Heavy)', 'Matting', 'Portrait', 'General Use (Dynamic)']),
  body('operating_resolution').optional().isIn(['1024x1024', '2048x2048', '2304x2304']),
  body('output_mask').optional().isBoolean(),
  body('refine_foreground').optional().isBoolean(),
  body('sync_mode').optional().isBoolean(),
  body('video_output_type').optional().isIn(['X264 (.mp4)', 'VP9 (.webm)', 'PRORES4444 (.mov)', 'GIF (.gif)']),
  body('video_quality').optional().isIn(['low', 'medium', 'high', 'maximum']),
  body('video_write_mode').optional().isIn(['fast', 'balanced', 'small']),
  async (req: Request, _res: Response, next: NextFunction) => {
    const hasVideoUrl = typeof req.body?.video_url === 'string' && req.body.video_url.trim().length > 0;
    const hasVideoData = typeof (req.body as any)?.video === 'string' && String((req.body as any).video).startsWith('data:');
    if (!hasVideoUrl && !hasVideoData) {
      return next(new ApiError('Either video_url or video (data URI) is required', 400));
    }
    // If client sent a data URI, upload to Zata and set video_url
    if (hasVideoData && !hasVideoUrl) {
      try {
        const uid = (req as any)?.uid || 'anon';
        const stored = await uploadDataUriToZata({
          dataUri: (req.body as any).video,
          keyPrefix: `users/${uid}/input/birefnet/${Date.now()}`,
          fileName: 'birefnet-source'
        });
        (req.body as any).video_url = stored.publicUrl;
      } catch (e) {
        return next(new ApiError('Failed to upload video data URI to storage', 400));
      }
    }
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    next();
  }
];

// Google Nano Banana Pro validator
export const validateFalNanoBananaPro = [
  body('prompt').optional().isString().withMessage('prompt must be a string'),
  body('num_images').optional().isInt({ min: 1 }).withMessage('num_images must be an integer >= 1'),
  body('aspect_ratio').optional().isIn(['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']).withMessage('aspect_ratio must be one of the allowed values'),
  body('output_format').optional().isIn(['jpeg', 'png', 'webp']).withMessage('output_format must be jpeg, png, or webp'),
  body('sync_mode').optional().isBoolean().withMessage('sync_mode must be boolean'),
  body('image_urls').optional().isArray().withMessage('image_urls must be an array'),
  body('image_urls.*').optional().isString().withMessage('image_urls must contain strings'),
  body('resolution').optional().isIn(['1K', '2K', '4K']).withMessage('resolution must be 1K, 2K, or 4K'),
  body('limit_generations').optional().isBoolean().withMessage('limit_generations must be boolean'),
  body('enable_web_search').optional().isBoolean().withMessage('enable_web_search must be boolean'),
  (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));

    // For text-to-image (no image_urls), prompt is required
    // For image-to-image (with image_urls), prompt is optional
    const hasImageUrls = Array.isArray(req.body?.image_urls) && req.body.image_urls.length > 0;
    if (!hasImageUrls && (!req.body?.prompt || typeof req.body.prompt !== 'string' || req.body.prompt.trim().length === 0)) {
      return next(new ApiError('prompt is required for text-to-image generation', 400));
    }

    // Validate image_urls array elements
    if (hasImageUrls) {
      for (const url of req.body.image_urls) {
        if (typeof url !== 'string' || url.trim().length === 0) {
          return next(new ApiError('image_urls must contain non-empty URL strings', 400));
        }
      }
    }

    next();
  }
];

// Topaz Image Upscaler (fal-ai/topaz/upscale/image) - dynamic per-MP pricing precheck
export const validateFalTopazUpscaleImage = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  body('upscale_factor').optional().isFloat({ gt: 0.1, lt: 10 }),
  body('model').optional().isIn(['Low Resolution V2', 'Standard V2', 'CGI', 'High Fidelity V2', 'Text Refine', 'Recovery', 'Redefine', 'Recovery V2']),
  body('output_format').optional().isIn(['jpeg', 'png']),
  async (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));
    // If client provided a public URL, probe it; if data URI is provided, skip probe and let service upload/handle
    const url: string | undefined = req.body?.image_url;
    const dataImage: string | undefined = req.body?.image;
    if (typeof url === 'string' && url.length > 0) {
      try {
        const meta = await probeImageMeta(url);
        const w = Number(meta?.width || 0);
        const h = Number(meta?.height || 0);
        if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
          return next(new ApiError('Unable to read image dimensions. Ensure the URL is public and accessible.', 400));
        }
        if (req.body.upscale_factor == null) req.body.upscale_factor = 2;
        (req as any).topazImageProbe = { width: w, height: h };
      } catch {
        return next(new ApiError('Failed to validate image URL for Topaz upscale', 400));
      }
    } else if (typeof dataImage === 'string' && dataImage.startsWith('data:')) {
      // Accept data URI; service will upload to get a public URL. Ensure default factor.
      if (req.body.upscale_factor == null) req.body.upscale_factor = 2;
    } else {
      return next(new ApiError('image_url or data URI image is required', 400));
    }
    next();
  }
];

// SeedVR Image Upscaler (fal-ai/seedvr/upscale/image) - factor-only
export const validateFalSeedvrUpscaleImage = [
  body('image_url').optional().isString().notEmpty(),
  body('image').optional().isString().notEmpty(),
  // Factor-only: allow client to pass, but must be 'factor' if present
  body('upscale_mode').optional().isIn(['factor']).withMessage('upscale_mode must be factor'),
  // Explicitly forbid target mode fields
  body('target_resolution').not().exists().withMessage('target_resolution is not supported'),
  body('upscale_factor').optional().isFloat({ gt: 0.1, lt: 10 }).withMessage('upscale_factor must be between 0.1 and 10'),
  body('noise_scale').optional().isFloat({ min: 0, max: 2 }).withMessage('noise_scale must be between 0 and 2'),
  body('output_format').optional().isIn(['jpg', 'png', 'webp']).withMessage('output_format must be jpg, png, or webp'),
  body('seed').optional().isInt().withMessage('seed must be an integer'),
  async (req: Request, _res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ApiError('Validation failed', 400, errors.array()));

    const url: string | undefined = req.body?.image_url;
    const dataImage: string | undefined = req.body?.image;

    const hasUrl = typeof url === 'string' && url.length > 0;
    const hasDataUri = typeof dataImage === 'string' && dataImage.startsWith('data:');

    if (!hasUrl && !hasDataUri) {
      return next(new ApiError('image_url or data URI image is required', 400));
    }

    // Force factor-only defaults
    req.body.upscale_mode = 'factor';
    if (req.body.upscale_factor == null) req.body.upscale_factor = 2;
    if (req.body.noise_scale == null) req.body.noise_scale = 0.1;
    if (req.body.output_format == null) req.body.output_format = 'jpg';

    // If client provided a public URL, probe it for pricing. If data URI is provided, pricing can upload+probe later.
    if (hasUrl) {
      try {
        const meta = await probeImageMeta(url as string);
        const w = Number(meta?.width || 0);
        const h = Number(meta?.height || 0);
        if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
          return next(new ApiError('Unable to read image dimensions. Ensure the URL is public and accessible.', 400));
        }
        (req as any).seedvrImageProbe = { width: w, height: h };
      } catch {
        return next(new ApiError('Failed to validate image URL for SeedVR image upscale', 400));
      }
    }

    next();
  }
];

