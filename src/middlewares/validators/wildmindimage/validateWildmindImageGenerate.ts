import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../../utils/errorHandler';

const DEFAULT_BANNED_TERMS = [
  // User-requested examples
  "boob",
  "boobs",
  'penis',
  'nudity',
  'vagina',
  // Common variants
  
  'nude',
  'porn',
  
];

const getBannedTerms = (): string[] => {
  const raw = String(process.env.WILDMINDIMAGE_BANNED_TERMS || '').trim();
  if (!raw) return DEFAULT_BANNED_TERMS;
  return raw
    .split(/[,|\s]+/g)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
};

const findBannedTerms = (text: string): string[] => {
  const lowered = String(text || '').toLowerCase();
  if (!lowered) return [];

  const terms = getBannedTerms();
  const matches: string[] = [];
  for (const term of terms) {
    if (!term) continue;
    if (/^[a-z0-9]+$/.test(term)) {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(lowered)) matches.push(term);
    } else {
      if (lowered.includes(term)) matches.push(term);
    }
  }
  return Array.from(new Set(matches));
};

export function validateWildmindImageGenerate(req: Request, _res: Response, next: NextFunction) {
  const { prompt, model, n, num_images, seed } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return next(new ApiError('prompt is required', 400));
  }

  // Block NSFW keywords early so we don't call the python service.
  const bannedMatches = findBannedTerms(prompt);
  if (bannedMatches.length > 0) {
    return next(
      new ApiError(
        'NSFW content detected in prompt. Please remove disallowed terms.',
        400,
        { error: 'nsfw', terms: bannedMatches }
      )
    );
  }

  if (model != null && typeof model !== 'string') {
    return next(new ApiError('model must be a string', 400));
  }

  const resolvedModel = String(model || 'wildmindimage');
  if (resolvedModel !== 'wildmindimage') {
    return next(new ApiError('invalid model for WILDMINDIMAGE endpoint', 400));
  }

  const requested = num_images ?? n;
  if (requested != null) {
    const parsed = Number(requested);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 4) {
      return next(new ApiError('n/num_images must be an integer between 1 and 4', 400));
    }
  }

  if (seed != null) {
    const parsedSeed = Number(seed);
    if (!Number.isFinite(parsedSeed) || !Number.isInteger(parsedSeed)) {
      return next(new ApiError('seed must be an integer', 400));
    }
  }

  return next();
}
