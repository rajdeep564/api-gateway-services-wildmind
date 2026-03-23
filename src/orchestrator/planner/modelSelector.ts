/**
 * WildMind AI Planner — Model Selector
 *
 * Dynamically chooses the best AI model for a given task based on
 * three signal dimensions:
 *   1. taskType   — what kind of content: image, video, music, voice
 *   2. style      — aesthetic descriptor: cinematic, photorealistic, artistic, ambient
 *   3. complexity — low | medium | high (maps to quality/cost tier)
 *
 * Design principles:
 * - Zero LLM calls — pure deterministic lookup table (O(1))
 * - Each rule maps to a concrete service name + endpoint from the existing routes
 * - Rules sorted by specificity (most specific first, general last)
 * - Returns a ModelSelection with endpoint, creditCost, and reasoning
 * - Exportable for use in plannerSystemPrompt to inform the LLM of options
 *
 * Extending: Add a new ModelRule entry. Nothing else to change.
 */

import type { PlanTaskType, PlanComplexity } from "./plannerTypes";

// ---------------------------------------------------------------------------
// Model Selection Output
// ---------------------------------------------------------------------------

export interface ModelSelection {
  /** Service name used as PlanStep.service */
  service: string;
  /** Internal API endpoint */
  endpoint: string;
  /** Estimated credit cost for one generation */
  creditCost: number;
  /** Human-readable reason this model was chosen */
  reasoning: string;
  /** Tier label for UI display */
  tier: "economy" | "standard" | "pro" | "ultra";
  /** Required params (e.g. model) to inject into the step body */
  params?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Model Rule — used to build deterministic selection table
// ---------------------------------------------------------------------------

interface ModelRule {
  taskType: PlanTaskType | "*";
  /** Substring match against the style string (case-insensitive), or '*' */
  styleKeywords: string[];
  complexity?: PlanComplexity | PlanComplexity[];
  result: Omit<ModelSelection, "reasoning">;
  reasoningTemplate: string;
}

// ---------------------------------------------------------------------------
// Master Selection Table
// Priority: top entries win (first match wins)
// ---------------------------------------------------------------------------

const MODEL_RULES: ModelRule[] = [
  // ─── IMAGE ────────────────────────────────────────────────────────────────

  // Photorealistic + high complexity → BFL FLUX.1 Pro (best quality)
  {
    taskType: "image",
    styleKeywords: [
      "photorealistic",
      "photo",
      "realistic",
      "hyperrealistic",
      "product",
    ],
    complexity: "high",
    result: {
      service: "bfl_image",
      endpoint: "/api/bfl/generate",
      creditCost: 300,
      tier: "ultra",
    },
    reasoningTemplate:
      "High-complexity photorealistic image → BFL FLUX.1 Pro (ultra HD)",
  },
  // Photorealistic + medium → FAL Flux Pro
  {
    taskType: "image",
    styleKeywords: [
      "photorealistic",
      "photo",
      "realistic",
      "product",
      "portrait",
    ],
    complexity: ["medium", "high"],
    result: {
      service: "fal_image_pro",
      endpoint: "/api/fal/generate",
      params: { model: "fal-ai/flux-pro/v1.1" },
      creditCost: 200,
      tier: "pro",
    },
    reasoningTemplate: "Photorealistic image → FAL Flux Pro (high quality)",
  },
  // Artistic / illustrative → FAL Flux Dev (creative models)
  {
    taskType: "image",
    styleKeywords: [
      "artistic",
      "illustration",
      "cartoon",
      "anime",
      "painting",
      "sketch",
      "watercolor",
      "abstract",
    ],
    result: {
      service: "fal_image",
      endpoint: "/api/fal/generate",
      params: { model: "fal-ai/flux/dev" },
      creditCost: 100,
      tier: "standard",
    },
    reasoningTemplate:
      "Artistic/illustrated style → FAL Flux Dev (creative, cost-efficient)",
  },
  // Ad image (always use pro for brand quality)
  {
    taskType: "image_ad",
    styleKeywords: ["*"],
    complexity: ["medium", "high"],
    result: {
      service: "fal_image_pro",
      endpoint: "/api/fal/generate",
      params: { model: "fal-ai/flux-pro/v1.1" },
      creditCost: 200,
      tier: "pro",
    },
    reasoningTemplate:
      "Image advertisement → FAL Flux Pro (brand-quality output)",
  },
  // Generic image (low complexity or unrecognized style)
  {
    taskType: "image",
    styleKeywords: ["*"],
    result: {
      service: "fal_image",
      endpoint: "/api/fal/generate",
      params: { model: "fal-ai/flux/dev" },
      creditCost: 100,
      tier: "standard",
    },
    reasoningTemplate: "Standard image → FAL Flux Dev (balanced quality/cost)",
  },

  // ─── VIDEO ────────────────────────────────────────────────────────────────

  // Cinematic / high complexity → Runway Gen-3 (premium)
  {
    taskType: "video",
    styleKeywords: [
      "cinematic",
      "film",
      "movie",
      "dramatic",
      "professional",
      "commercial",
    ],
    complexity: ["medium", "high"],
    result: {
      service: "runway_video",
      endpoint: "/api/runway/generate",
      creditCost: 500,
      tier: "ultra",
    },
    reasoningTemplate:
      "Cinematic/professional video → Runway Gen-3 (highest motion quality)",
  },
  // Fast / social / low complexity → MiniMax video (cheaper, faster)
  {
    taskType: "video",
    styleKeywords: [
      "fast",
      "quick",
      "social",
      "short",
      "reel",
      "story",
      "tiktok",
      "instagram",
    ],
    result: {
      service: "fal_video",
      endpoint: "/api/fal/video",
      creditCost: 400,
      tier: "standard",
    },
    reasoningTemplate:
      "Short-form/social video → FAL Video (fast turnaround, lower cost)",
  },
  // Low complexity video → FAL Video
  {
    taskType: "video",
    styleKeywords: ["*"],
    complexity: "low",
    result: {
      service: "fal_video",
      endpoint: "/api/fal/video",
      creditCost: 400,
      tier: "standard",
    },
    reasoningTemplate: "Low-complexity video → FAL Video (economical choice)",
  },
  // Default video
  {
    taskType: "video",
    styleKeywords: ["*"],
    result: {
      service: "runway_video",
      endpoint: "/api/runway/generate",
      creditCost: 500,
      tier: "ultra",
    },
    reasoningTemplate: "Standard video → Runway Gen-3 (default premium)",
  },
  // Video Ad (always Runway for quality)
  {
    taskType: "video_ad",
    styleKeywords: ["*"],
    result: {
      service: "runway_video",
      endpoint: "/api/runway/generate",
      creditCost: 500,
      tier: "ultra",
    },
    reasoningTemplate:
      "Video advertisement → Runway Gen-3 (ad-grade quality required)",
  },

  // ─── MUSIC ────────────────────────────────────────────────────────────────

  // Complex / orchestral / high quality → MiniMax Music
  {
    taskType: "music",
    styleKeywords: [
      "orchestral",
      "cinematic",
      "epic",
      "classical",
      "ambient",
      "film",
      "score",
    ],
    result: {
      service: "minimax_music",
      endpoint: "/api/minimax/music",
      creditCost: 200,
      tier: "pro",
    },
    reasoningTemplate:
      "Cinematic/orchestral music → MiniMax Music (richest audio quality)",
  },
  // Pop / electronic / upbeat → FAL Music (faster generation)
  {
    taskType: "music",
    styleKeywords: [
      "pop",
      "electronic",
      "edm",
      "hip-hop",
      "upbeat",
      "energetic",
      "dance",
    ],
    result: {
      service: "fal_music",
      endpoint: "/api/fal/music",
      creditCost: 180,
      tier: "standard",
    },
    reasoningTemplate:
      "Electronic/pop music → FAL Music (faster, cost-efficient)",
  },
  // Default music
  {
    taskType: "music",
    styleKeywords: ["*"],
    result: {
      service: "minimax_music",
      endpoint: "/api/minimax/music",
      creditCost: 200,
      tier: "pro",
    },
    reasoningTemplate: "Standard music → MiniMax Music (default best quality)",
  },

  // ─── VOICE ────────────────────────────────────────────────────────────────

  // Professional / narration → FAL TTS (high quality)
  {
    taskType: "voice",
    styleKeywords: [
      "professional",
      "narration",
      "documentary",
      "corporate",
      "formal",
    ],
    result: {
      service: "fal_voice",
      endpoint: "/api/fal/tts",
      creditCost: 150,
      tier: "pro",
    },
    reasoningTemplate:
      "Professional narration → FAL TTS (natural, expressive voice)",
  },
  // Conversational / casual → Replicate TTS (cheaper)
  {
    taskType: "voice",
    styleKeywords: ["casual", "conversational", "friendly", "fast"],
    result: {
      service: "replicate_voice",
      endpoint: "/api/replicate/tts",
      creditCost: 130,
      tier: "standard",
    },
    reasoningTemplate: "Casual voice → Replicate TTS (economical)",
  },
  // Default voice
  {
    taskType: "voice",
    styleKeywords: ["*"],
    result: {
      service: "fal_voice",
      endpoint: "/api/fal/tts",
      creditCost: 150,
      tier: "pro",
    },
    reasoningTemplate: "Standard voice → FAL TTS (default)",
  },

  // ─── MULTIMODAL ───────────────────────────────────────────────────────────
  {
    taskType: "multimodal",
    styleKeywords: ["*"],
    result: {
      service: "runway_video",
      endpoint: "/api/runway/generate",
      creditCost: 500,
      tier: "ultra",
    },
    reasoningTemplate:
      "Multimodal primary asset → Runway (highest quality for mixed media)",
  },
];

// ---------------------------------------------------------------------------
// Matching logic
// ---------------------------------------------------------------------------

function styleMatches(ruleKeywords: string[], style: string): boolean {
  if (ruleKeywords.includes("*")) return true;
  const lower = style.toLowerCase();
  return ruleKeywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function complexityMatches(
  rule: ModelRule,
  complexity: PlanComplexity,
): boolean {
  if (!rule.complexity) return true; // no complexity constraint = matches all
  if (Array.isArray(rule.complexity))
    return rule.complexity.includes(complexity);
  return rule.complexity === complexity;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select the optimal AI model for a generation step.
 *
 * @param taskType    - The generation task type
 * @param style       - Style descriptor from the plan
 * @param complexity  - Task complexity tier
 * @returns           - ModelSelection with service, endpoint, creditCost, reasoning
 */
export function selectModel(
  taskType: PlanTaskType,
  style: string,
  complexity: PlanComplexity,
): ModelSelection {
  for (const rule of MODEL_RULES) {
    const taskMatches = rule.taskType === "*" || rule.taskType === taskType;
    if (!taskMatches) continue;
    if (!styleMatches(rule.styleKeywords, style)) continue;
    if (!complexityMatches(rule, complexity)) continue;

    return {
      ...rule.result,
      reasoning: rule.reasoningTemplate,
    };
  }

  // Ultimate fallback (should never reach here given wildcard rules)
  return {
    service: "fal_image",
    endpoint: "/api/fal/generate",
    params: { model: "fal-ai/flux/dev" },
    creditCost: 100,
    tier: "standard",
    reasoning: "Ultimate fallback — unrecognized task/style combination",
  };
}

/**
 * Given a partial plan step (with taskType + style + complexity),
 * mutates the step in-place to use the optimal model.
 * Returns the original model name for logging.
 */
export function applyModelSelection(
  step: {
    service: string;
    endpoint: string;
    creditCost: number;
    [key: string]: any;
  },
  taskType: PlanTaskType,
  style: string,
  complexity: PlanComplexity,
): { original: string; selected: ModelSelection } {
  const original = step.service;
  const selection = selectModel(taskType, style, complexity);

  step.service = selection.service;
  step.endpoint = selection.endpoint;
  step.creditCost = selection.creditCost;
  
  if (selection.params) {
    step.params = { ...(step.params || {}), ...selection.params };
  }

  return { original, selected: selection };
}

/**
 * Returns all available models for a given task type.
 * Useful for admin UI / debugging.
 */
export function getAvailableModels(taskType: PlanTaskType): ModelSelection[] {
  const seen = new Set<string>();
  const results: ModelSelection[] = [];

  for (const rule of MODEL_RULES) {
    if (
      (rule.taskType === taskType || rule.taskType === "*") &&
      !seen.has(rule.result.service)
    ) {
      seen.add(rule.result.service);
      results.push({ ...rule.result, reasoning: rule.reasoningTemplate });
    }
  }

  return results;
}
