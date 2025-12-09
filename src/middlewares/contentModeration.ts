import { Request, Response, NextFunction } from "express";
import { formatApiResponse } from "../utils/formatApiResponse";

type BlockCategory = "nudity" | "self-harm";

const BLOCK_CODE = "CONTENT_BLOCKED";

// Lightweight term lists to keep false-positives low (explicit nudity only)
// Single-word terms checked with word boundaries
const nudityTerms = [
  // Explicit pornographic content
  "porn",
  "porno",
  "pornography",
  "xxx",
  "nsfw",
  "hentai",
  "pornographic",
  "camgirl",
  "camboy",
  "pornhub",
  "xvideos",
  "redtube",
  "youporn",
  "sex tape",
  "nude leak",
  "leaked nudes",

  // Explicit sexual acts (the acts themselves, not just mentions)
  "blowjob",
  "handjob",
  "footjob",
  "titjob",
  "rimjob",
  "boobjob",
  "deepthroat",
  "face fuck",
  "throatfuck",
  "gangbang",
  "gang bang",
  "bukkake",
  "anal sex",
  "butt sex",
  "buttfuck",
  "assfuck",
  "doggystyle",
  "doggy style",

  // Sexual acts with explicit intent
  "jerk off",
  "fap",
  "fapping",

  "finger myself",
  "fingering",

  // Sexual fluids/ejaculation in sexual context
  "cum",
  "cumming",
  "cumshot",
  "cum shot",
  "jizz",
  "jizzed",
  "semen",
  "sperm",
  "ejaculate",
  "ejaculation",
  "nut",
  "nutting",
  "creaming",
  "squirt",
  "squirting",

  // Sexually explicit body references
  "dick pic",
  "cock pic",
  "nude pic",
  "nudes",
  "send nudes",
  "tit pic",
  "boob pic",
  "ass pic",
  "pussy pic",
  "dick pic",
  "dick shot",
  "nude selfie",
  "naked selfie",

  // Sexual arousal in explicit context

  // Sex work related to explicit content

  "sex worker",

  // Explicit sexual requests/solicitation
  "wanna fuck",
  "lets fuck",
  "sexting",

  // Fetish content (explicit)

  // Voyeurism/non-consensual

  // Sexual body part slang (when used sexually)
  "titties",
  "boobies",
  "ass cheeks",
  "thicc",
  "thick ass",
  "big tits",
  "big boobs",
  "small tits",

  // Genital slang in sexual context
  "pussy",
  "dick",
  "cock",
  "penis",

  // Sexual positions/activities
  "reverse cowgirl",
  "spooning",
  "standing sex",
  "car sex",
  "public sex",
  "beach sex",
  "shower sex",

  // Sexual invitations/propositions
  "fuck",

  // Explicit sexual content descriptors
  "sex",
];

// Multi-word phrases checked with whole-phrase regex (allows whitespace)
const nudityPhrases = [
  "sexual intercourse",
  "oral sex",
  "anal sex",
  "sex act",
  "hardcore sex",
  "softcore sex",
  "explicit sex",
  "hand job",
  "handjob",
  "jerk off",
  "sex tape",
  "adult video",
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
  "prompt",
  "userPrompt",
  "negative_prompt",
  "negativePrompt",
  "title",
  "description",
  "story",
  "text",
  "query",
  "input",
  "lyrics",
  "caption",
  "question",
  "instruction",
  "instructions",
  "messages",
];

function collectStrings(
  value: any,
  depth = 0,
  bucket: string[] = []
): string[] {
  if (value == null || depth > 3) return bucket;

  if (typeof value === "string") {
    bucket.push(value);
    return bucket;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, depth + 1, bucket));
    return bucket;
  }

  if (typeof value === "object") {
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
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseToRegex(phrase: string): RegExp {
  // Allow flexible whitespace between words, match whole phrase with boundaries
  const parts = phrase.split(/\s+/).map(escapeRegex).join("\\s+");
  return new RegExp(`\\b${parts}\\b`, "i");
}

function findViolation(
  texts: string[]
): { category: BlockCategory; term: string } | null {
  const forbiddenTerms = [
    ...nudityTerms.filter((t): t is string => typeof t === "string"),
    ...nudityPhrases.filter((p): p is string => typeof p === "string"),
  ].map((t) => t.toLowerCase());

  for (const raw of texts) {
    const text = raw.toLowerCase();
    const hit = forbiddenTerms.find((term) => text.includes(term));
    if (hit) return { category: "nudity", term: hit };
  }
  return null;
}

export function contentModerationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Only inspect POST/PUT/PATCH bodies where prompts are expected
    if (!["POST", "PUT", "PATCH"].includes(req.method)) return next();

    const texts = collectStrings(req.body);
    if (!texts.length) return next();

    const violation = findViolation(texts);
    if (!violation) return next();

    const message =
      violation.category === "nudity"
        ? "This prompt was blocked for nudity. Please remove explicit content."
        : "This prompt was blocked for self-harm content. Please adjust and try again.";

    const payload = {
      code: BLOCK_CODE,
      category: violation.category,
      matchedTerm: violation.term,
    };

    return res.status(400).json(formatApiResponse("error", message, payload));
  } catch (err) {
    // Fail open (do not block generation) if moderation middleware errors
    return next();
  }
}
