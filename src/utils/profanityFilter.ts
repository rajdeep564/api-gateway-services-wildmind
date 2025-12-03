/**
 * Comprehensive Content Moderation System
 * Supports multiple languages, categories, and use cases
 */

// ============================================================================
// MODERATION CATEGORIES
// ============================================================================

export enum ModerationCategory {
  PROFANITY = 'profanity',
  RACISM = 'racism',
  HATE_SPEECH = 'hate_speech',
  SEXUAL = 'sexual',
  HARASSMENT = 'harassment',
  SELF_HARM = 'self_harm',
  ILLEGAL = 'illegal',
  SPAM = 'spam',
  PERSONAL_INFO = 'personal_info'
}

// ============================================================================
// WORD LISTS BY CATEGORY
// ============================================================================

// English Profanity
const ENGLISH_PROFANITY = new Set([
  'fuck', 'fucking', 'fucked', 'fucker', 'shit', 'shitting', 'shitter',
  'ass', 'asshole', 'bitch', 'bitches', 'bastard', 'damn', 'crap',
  'piss', 'pissed', 'dick', 'dickhead', 'cock', 'pussy', 'tits', 'titties'
]);

// Racism & Hate Speech
const RACISM_SLURS = new Set([
  'nigger', 'nigga', 'kike', 'chink', 'spic', 'wetback', 'beaner',
  'gook', 'jap', 'raghead', 'towelhead', 'camel jockey', 'paki',
  'curry muncher', 'sand nigger', 'abcd', 'oreo', 'coconut', 'coon'
]);

// Homophobic/Transphobic Slurs
const LGBTQ_SLURS = new Set([
  'fag', 'faggot', 'dyke', 'tranny', 'shemale', 'he-she',
  'homo', 'queer' // Context-dependent, but often used as slur
]);



// Sexual Content
const SEXUAL_TERMS = new Set([
  'porn', 'porno', 'pornography', 'nude', 'nudes', 'naked',
  'xxx', 'sex', 'intercourse', 'blowjob', 'handjob', 'masturbate',
  'cum', 'cumming', 'orgasm', 'horny', 'erotic', 'hentai'
]);

// Self-Harm
const SELF_HARM_TERMS = new Set([
  'suicide', 'suicidal', 'kill myself', 'end my life', 'cut myself',
  'self harm', 'want to die', 'better off dead', 'kms'
]);

// Illegal Activities
const ILLEGAL_TERMS = new Set([
  'cocaine', 'heroin', 'meth', 'crack', 'weed', 'marijuana',
  'drug dealer', 'trafficking', 'smuggle', 'counterfeit',
  'steal', 'rob', 'burglar', 'hack', 'pirate'
]);

// Hinglish Bad Words (Hindi + English transliteration)
const HINGLISH_PROFANITY = new Set([
  // Common Hindi profanity in Roman script
  'chutiya', 'chutiye', 'chodu', 'gandu', 'gand', 'gaandu',
  'madarchod', 'mc', 'bsdk', 'behenchod', 'bc', 'bhenchod',
  'lund', 'loda', 'lauda', 'lode', 'teri maa', 'teri ma',
  'bhen ki', 'maa ki', 'behen ki', 'chut', 'choot',
  'randi', 'rundi', 'saale', 'saala', 'kamina', 'kamine',
  'harami', 'haramzada', 'kutta', 'kutte', 'kuttiya',
  'bhosdi', 'bhosad', 'lavde', 'lawde', 'jhaat', 'jhaant'
]);

// Spanish Profanity
const SPANISH_PROFANITY = new Set([
  'puta', 'puto', 'mierda', 'joder', 'coño', 'carajo',
  'pendejo', 'cabrón', 'hijo de puta', 'chinga', 'verga',
  'culo', 'polla', 'marica', 'maricon', 'pinche'
]);

// French Profanity
const FRENCH_PROFANITY = new Set([
  'merde', 'putain', 'connard', 'salaud', 'enculé',
  'fils de pute', 'bordel', 'chier', 'bite', 'con'
]);

// German Profanity
const GERMAN_PROFANITY = new Set([
  'scheiße', 'scheisse', 'arschloch', 'fotze', 'hurensohn',
  'fick', 'ficken', 'wichser', 'schwanz', 'sau'
]);

// Arabic Profanity (transliterated)
const ARABIC_PROFANITY = new Set([
  'kos', 'koss', 'kus', 'khara', 'sharmoota', 'sharmoot',
  'ibn el sharmoota', 'kalb', 'ayre', 'neek', 'manuke'
]);

// Portuguese Profanity
const PORTUGUESE_PROFANITY = new Set([
  'porra', 'caralho', 'foda', 'merda', 'puta', 'filho da puta',
  'buceta', 'cacete', 'cu', 'fdp', 'desgraça'
]);

// Russian Profanity (transliterated)
const RUSSIAN_PROFANITY = new Set([
  'blyat', 'suka', 'pizdec', 'pizda', 'ebat', 'hui',
  'govno', 'mudak', 'debil', 'zasranec'
]);

// Chinese Profanity (pinyin)
const CHINESE_PROFANITY = new Set([
  'cao', 'ma de', 'ta ma de', 'ni ma', 'sha bi',
  'bi yan', 'wang ba dan', 'hun dan', 'zhu tou'
]);

// ============================================================================
// PATTERN MATCHING
// ============================================================================

const PROFANITY_PATTERNS = [
  /f+u+c+k+/i, /s+h+i+t+/i, /a+s+s+h+o+l+e+/i, /b+i+t+c+h+/i,
  /d+i+c+k+/i, /c+o+c+k+/i, /p+u+s+s+y+/i, /n+i+g+g+e+r+/i,
  /n+i+g+g+a+/i, /f+a+g+g+o+t+/i
];

const LEETSPEAK_MAP: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
  '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i'
};

// ============================================================================
// MAIN MODERATION CLASS
// ============================================================================

export interface ModerationResult {
  isClean: boolean;
  categories: ModerationCategory[];
  matchedTerms: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  suggestions?: string;
}

export class ContentModerator {
  private categoryMap: Map<ModerationCategory, Set<string>>;

  constructor() {
    this.categoryMap = new Map([
      [ModerationCategory.PROFANITY, new Set([
        ...ENGLISH_PROFANITY,
        ...HINGLISH_PROFANITY,
        ...SPANISH_PROFANITY,
        ...FRENCH_PROFANITY,
        ...GERMAN_PROFANITY,
        ...ARABIC_PROFANITY,
        ...PORTUGUESE_PROFANITY,
        ...RUSSIAN_PROFANITY,
        ...CHINESE_PROFANITY
      ])],
      [ModerationCategory.RACISM, RACISM_SLURS],
      [ModerationCategory.HATE_SPEECH, new Set([...RACISM_SLURS, ...LGBTQ_SLURS])],
      [ModerationCategory.SEXUAL, SEXUAL_TERMS],
      [ModerationCategory.SELF_HARM, SELF_HARM_TERMS],
      [ModerationCategory.ILLEGAL, ILLEGAL_TERMS]
    ]);
  }

  /**
   * Normalize text for checking
   */
  private normalizeText(text: string): string {
    let normalized = text.toLowerCase().trim();
    
    // Convert leetspeak
    for (const [leet, normal] of Object.entries(LEETSPEAK_MAP)) {
      normalized = normalized.replace(new RegExp(leet, 'g'), normal);
    }
    
    // Remove common separators
    normalized = normalized.replace(/[\s\-_\.]+/g, ' ');
    
    return normalized;
  }

  /**
   * Check content against all moderation rules
   */
  public moderate(text: string): ModerationResult {
    if (!text || typeof text !== 'string') {
      return {
        isClean: true,
        categories: [],
        matchedTerms: [],
        severity: 'low'
      };
    }

    const normalized = this.normalizeText(text);
    const words = normalized.split(/\s+/);
    const categories = new Set<ModerationCategory>();
    const matchedTerms: string[] = [];

    // Check word lists
    for (const [category, wordSet] of this.categoryMap.entries()) {
      for (const word of words) {
        const cleanWord = word.replace(/[^a-z0-9]/g, '');
        if (wordSet.has(cleanWord)) {
          categories.add(category);
          matchedTerms.push(cleanWord);
        }
      }

      // Check phrases
      for (const badWord of wordSet) {
        if (badWord.includes(' ') && normalized.includes(badWord)) {
          categories.add(category);
          matchedTerms.push(badWord);
        }
      }
    }

    // Check patterns
    for (const pattern of PROFANITY_PATTERNS) {
      if (pattern.test(normalized)) {
        categories.add(ModerationCategory.PROFANITY);
        const matches = normalized.match(pattern);
        if (matches) matchedTerms.push(...matches);
      }
    }

    // Check for concatenated words
    const fullTextClean = normalized.replace(/[^a-z0-9]/g, '');
    for (const [category, wordSet] of this.categoryMap.entries()) {
      for (const word of wordSet) {
        if (word.length > 3 && fullTextClean.includes(word.replace(/\s/g, ''))) {
          categories.add(category);
          matchedTerms.push(word);
        }
      }
    }

    // Determine severity
    const severity = this.calculateSeverity(categories);

    return {
      isClean: categories.size === 0,
      categories: Array.from(categories),
      matchedTerms: [...new Set(matchedTerms)],
      severity
    };
  }

  /**
   * Calculate severity based on categories
   */
  private calculateSeverity(categories: Set<ModerationCategory>): 'low' | 'medium' | 'high' | 'critical' {
    if (categories.has(ModerationCategory.RACISM)  ||
        categories.has(ModerationCategory.SELF_HARM)) {
      return 'critical';
    }
    if (categories.has(ModerationCategory.HATE_SPEECH) ||
        categories.has(ModerationCategory.SEXUAL)) {
      return 'high';
    }
    if (categories.has(ModerationCategory.HARASSMENT) ||
        categories.has(ModerationCategory.ILLEGAL)) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Get user-friendly error message based on categories
   */
  public getErrorMessage(result: ModerationResult, context: 'username' | 'prompt' | 'comment' | 'post'): string {
    if (result.isClean) return '';

    const messages: Record<string, Record<string, string>> = {
      username: {
        [ModerationCategory.PROFANITY]: 'Username contains inappropriate language. Please choose a different username.',
        [ModerationCategory.RACISM]: 'Username contains offensive terms. Please choose a respectful username.',
        [ModerationCategory.HATE_SPEECH]: 'Username violates our community guidelines. Please choose a different username.',
        [ModerationCategory.SEXUAL]: 'Username contains inappropriate content. Please choose a different username.'
      },
      prompt: {
        [ModerationCategory.PROFANITY]: 'Your input contains inappropriate language. Please revise and try again.',
        [ModerationCategory.RACISM]: 'Your input contains offensive content. Please be respectful.',
        [ModerationCategory.HATE_SPEECH]: 'Your input violates our community guidelines. Please revise.',
        [ModerationCategory.SEXUAL]: 'Your input contains inappropriate content. Please revise.',
        [ModerationCategory.SELF_HARM]: 'We noticed concerning content in your message. If you need support, please reach out to a mental health professional.',
        [ModerationCategory.ILLEGAL]: 'Your input references illegal activities. Please revise.'
      },
      comment: {
        [ModerationCategory.PROFANITY]: 'Comment contains inappropriate language and cannot be posted.',
        [ModerationCategory.RACISM]: 'Comment contains offensive terms and violates our community standards.',
        [ModerationCategory.HATE_SPEECH]: 'Comment contains hate speech and cannot be posted.',
        [ModerationCategory.HARASSMENT]: 'Comment appears to be harassment and cannot be posted.'
      },
      post: {
        [ModerationCategory.PROFANITY]: 'Post contains inappropriate language. Please edit before publishing.',
        [ModerationCategory.RACISM]: 'Post contains offensive content and cannot be published.',
        [ModerationCategory.HATE_SPEECH]: 'Post violates our community guidelines.',
        [ModerationCategory.SEXUAL]: 'Post contains inappropriate sexual content.',
        [ModerationCategory.SPAM]: 'Post appears to be spam and cannot be published.'
      }
    };

    // Get the most severe category
    const primaryCategory = result.categories[0];
    return messages[context]?.[primaryCategory] || 
           `Content violates our community guidelines. Please revise.`;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

const moderator = new ContentModerator();

/**
 * Validate username
 */
export function validateUsername(username: string): { isValid: boolean; error?: string } {
  const result = moderator.moderate(username);
  
  if (!result.isClean) {
    return {
      isValid: false,
      error: moderator.getErrorMessage(result, 'username')
    };
  }

  return { isValid: true };
}

/**
 * Validate prompt/input
 */
export function validatePrompt(prompt: string): { isValid: boolean; error?: string; result?: ModerationResult } {
  const result = moderator.moderate(prompt);
  
  if (!result.isClean) {
    return {
      isValid: false,
      error: moderator.getErrorMessage(result, 'prompt'),
      result
    };
  }

  return { isValid: true, result };
}

/**
 * Validate comment
 */
export function validateComment(comment: string): { isValid: boolean; error?: string; result?: ModerationResult } {
  const result = moderator.moderate(comment);
  
  if (!result.isClean) {
    return {
      isValid: false,
      error: moderator.getErrorMessage(result, 'comment'),
      result
    };
  }

  return { isValid: true, result };
}

/**
 * Validate post
 */
export function validatePost(post: string): { isValid: boolean; error?: string; result?: ModerationResult } {
  const result = moderator.moderate(post);
  
  if (!result.isClean) {
    return {
      isValid: false,
      error: moderator.getErrorMessage(result, 'post'),
      result
    };
  }

  return { isValid: true, result };
}

/**
 * Check if content needs human review (for borderline cases)
 */
export function needsHumanReview(text: string): boolean {
  const result = moderator.moderate(text);
  return result.severity === 'medium' && result.categories.length === 1;
}

// Example usage:
/*
const usernameCheck = validateUsername("user123");
console.log(usernameCheck); // { isValid: true }

const promptCheck = validatePrompt("Hello, how are you?");
console.log(promptCheck); // { isValid: true }

const badUsername = validateUsername("racist_slur_here");
console.log(badUsername); // { isValid: false, error: "..." }
*/