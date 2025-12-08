import { Request, Response, NextFunction } from 'express';
import { formatApiResponse } from '../utils/formatApiResponse';

type BlockCategory = 'nudity' | 'self-harm';

const BLOCK_CODE = 'CONTENT_BLOCKED';

// Lightweight term lists to keep false-positives low (explicit nudity only)
// Single-word terms checked with word boundaries
const nudityTerms = [
  // Explicit pornographic content
  'porn', 'porno', 'pornography', 'xxx', 'nsfw', 'hentai',
  'pornographic', 'camgirl', 'camboy', 'pornhub', 'xvideos',
  'redtube', 'youporn', 'sex tape', 'nude leak', 'leaked nudes',
  
  // Explicit sexual acts (the acts themselves, not just mentions)
  'blowjob', 'handjob', 'footjob', 'titjob', 'rimjob', 'boobjob',
  'deepthroat', 'face fuck', 'throatfuck', 'gangbang', 'gang bang',
  'bukkake', 'creampie', 'money shot', 'facial', 'golden shower',
  'anal sex', 'butt sex', 'buttfuck', 'assfuck',
  'doggystyle', 'doggy style', '69', 'sixty nine',
  'threesome', 'foursome', 'orgy', 'swingers', 'swinging',
  
  // Sexual acts with explicit intent
  'jerk off', 'jerking off', 'jack off', 'jacking off',
  'beat off', 'wank', 'wanking', 'fap', 'fapping',
  'rub one out', 'stroke it', 'touch myself',
  'finger myself', 'fingering', 'finger bang',
  'eat out', 'eating out', 'munch', 'go down on',
  
  // Sexual fluids/ejaculation in sexual context
  'cum', 'cumming', 'cumshot', 'cum shot', 'jizz', 'jizzed',
  'semen', 'sperm', 'ejaculate', 'ejaculation', 'nut', 'nutting',
  'cream', 'creaming', 'squirt', 'squirting', 'wet', 'wetness',
  
  // Sexually explicit body references
  'dick pic', 'cock pic', 'nude pic', 'nudes', 'send nudes',
  'tit pic', 'boob pic', 'ass pic', 'pussy pic',
  'dick pic', 'dick shot', 'nude selfie', 'naked selfie',
  
  // Sexual arousal in explicit context
  'horny', 'turned on', 'hard on', 'boner', 'erection',
  'wet pussy', 'dripping', 'soaking wet', 'rock hard',
  
  // Sex work related to explicit content
  'stripper', 'strip club', 'lap dance', 'pole dancer',
  'escort', 'prostitute', 'hooker', 'call girl',
  'sex worker', 'brothel', 'pimp',
  
  // Explicit sexual requests/solicitation
  'wanna fuck', 'lets fuck', 'dtf', 'netflix and chill',
  'send pics', 'send photos', 'show me', 'let me see',
  'sext', 'sexting', 'cyber sex', 'phone sex',
  
  // Adult content platforms/terms
  'only fans', 'onlyfans', 'patreon nsfw', 'fansly',
  'chaturbate', 'livejasmin', 'cam4', 'stripchat',
  
  // Fetish content (explicit)
  'bdsm', 'bondage', 'dominatrix', 'submissive', 'slave',
  'master', 'daddy dom', 'sugar daddy', 'findom',
  'feet pics', 'foot fetish', 'panty', 'panties', 'underwear pics',
  
  // Voyeurism/non-consensual
  'upskirt', 'downblouse', 'peeping', 'voyeur', 'creepshot',
  'hidden cam', 'spy cam', 'revenge porn',
  
  // Sexual body part slang (when used sexually)
  'titties', 'tiddies', 'boobies', 'knockers', 'jugs', 'melons',
  'ass cheeks', 'butt cheeks', 'booty', 'thicc', 'thick ass',
  'big tits', 'big boobs', 'small tits',
  
  // Genital slang in sexual context
  'pussy', 'cunt', 'twat', 'snatch', 'cooch', 'vag',
  'dick', 'cock', 'penis', 'schlong', 'dong', 'tool', 'member',
  'balls', 'nuts', 'sack', 'testicles', 'package',
  
  // Sexual positions/activities
  'cowgirl', 'reverse cowgirl', 'spooning', 'standing sex',
  'car sex', 'public sex', 'beach sex', 'shower sex',
  
  // Sexual invitations/propositions
  'hook up', 'one night stand', 'fwb', 'fuck buddy',
  'booty call', 'late night', 'come over',
  
  // Explicit sexual content descriptors
  'explicit', 'uncensored', 'uncut', 'raw', 'hardcore',
  'softcore', 'x rated', 'r rated', 'adult content',
  'mature content', '18+', '21+', 'adults only'

  ,'sex' , 'sexual'
];

// Multi-word phrases checked with whole-phrase regex (allows whitespace)
const nudityPhrases = [
  'sexual intercourse',
  'oral sex',
  'anal sex',
  'sex act',
  'hardcore sex',
  'softcore sex',
  'explicit sex',
  'hand job',
  'handjob',
  'jerk off',
  'sex tape',
  'adult video',
];

// const selfHarmTerms = [
//   'suicide',
//   'kill myself',
//   'self harm',
//   'self-harm',
//   'end my life',
//   'slit my wrists',
//   'overdose',
//   'hang myself',
// ];

// Common prompt keys to inspect
const promptKeys = [
  'prompt',
  'userPrompt',
  'negative_prompt',
  'negativePrompt',
  'title',
  'description',
  'story',
  'text',
  'query',
  'input',
  'lyrics',
  'caption',
  'question',
  'instruction',
  'instructions',
  'messages',
];

function collectStrings(value: any, depth = 0, bucket: string[] = []): string[] {
  if (value == null || depth > 3) return bucket;

  if (typeof value === 'string') {
    bucket.push(value);
    return bucket;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, depth + 1, bucket));
    return bucket;
  }

  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, val]) => {
      if (promptKeys.includes(key)) {
        collectStrings(val, depth + 1, bucket);
      } else if (depth < 2) {
        // Lightly scan nested objects/arrays but cap depth to avoid large payload traversal
        collectStrings(val, depth + 1, bucket);
      }
    });
  }

  return bucket;
}

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phraseToRegex(phrase: string): RegExp {
  // Allow flexible whitespace between words, match whole phrase with boundaries
  const parts = phrase.split(/\s+/).map(escapeRegex).join('\\s+');
  return new RegExp(`\\b${parts}\\b`, 'i');
}

function findViolation(texts: string[]): { category: BlockCategory; term: string } | null {
  // Use word-boundary regex to avoid substring hits (e.g., "specimen" vs "semen")
  const nudityWordPatterns = nudityTerms.map((t) => new RegExp(`\\b${escapeRegex(t)}\\b`, 'i'));
  const nudityPhrasePatterns = nudityPhrases.map((p) => phraseToRegex(p));

  for (const raw of texts) {
    const text = raw.toLowerCase();

    const wordIndex = nudityWordPatterns.findIndex((re) => re.test(text));
    if (wordIndex !== -1) return { category: 'nudity', term: nudityTerms[wordIndex] };

    const phraseIndex = nudityPhrasePatterns.findIndex((re) => re.test(text));
    if (phraseIndex !== -1) return { category: 'nudity', term: nudityPhrases[phraseIndex] };
  }
  return null;
}

export function contentModerationMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    // Only inspect POST/PUT/PATCH bodies where prompts are expected
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();

    const texts = collectStrings(req.body);
    if (!texts.length) return next();

    const violation = findViolation(texts);
    if (!violation) return next();

    const message =
      violation.category === 'nudity'
        ? 'This prompt was blocked for nudity. Please remove explicit content.'
        : 'This prompt was blocked for self-harm content. Please adjust and try again.';

    const payload = {
      code: BLOCK_CODE,
      category: violation.category,
      matchedTerm: violation.term,
    };

    return res.status(400).json(formatApiResponse('error', message, payload));
  } catch (err) {
    // Fail open (do not block generation) if moderation middleware errors
    return next();
  }
}
