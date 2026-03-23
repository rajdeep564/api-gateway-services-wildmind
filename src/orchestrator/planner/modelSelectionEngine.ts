/**
 * WildMind — Model Selection Engine (v2)
 *
 * Architecture: Multi-dimensional scoring engine
 * ──────────────────────────────────────────────
 *
 * Unlike the simple rule-table in modelSelector.ts (v1), this engine:
 *
 *   1. Maintains a PROVIDER REGISTRY — every model's full capability profile
 *      including quality scores, latency estimates, cost, and task support.
 *
 *   2. Scores every candidate model on 5 dimensions:
 *      quality  (0–1)  — output quality for this task/style
 *      latency  (0–1)  — how fast (inversely proportional to p50 latency)
 *      cost     (0–1)  — how cheap (inversely proportional to credit cost)
 *      match    (0–1)  — how well style keywords match provider strengths
 *      availability (0–1) — uptime / reliability score
 *
 *   3. Applies SELECTION WEIGHTS per user priority mode:
 *      "quality"  — maximize output quality (ignore cost)
 *      "balanced" — default: quality + cost + latency equally weighted
 *      "speed"    — minimize latency above all
 *      "economy"  — minimize cost above all
 *
 *   4. Enforces HARD CONSTRAINTS before scoring:
 *      - Provider must support the requested taskType
 *      - Provider must be within budget (if creditLimit provided)
 *      - Provider must support the requested duration (for video/music)
 *
 *   5. Has a FALLBACK HIERARCHY per provider:
 *      If the top-scored provider fails at runtime, the engine returns
 *      the ranked list so the caller can try the next one.
 *
 * Usage:
 *   const engine = new ModelSelectionEngine();
 *   const result = engine.select({ taskType, style, complexity, priority });
 *   // result.ranked[0] = best choice
 *   // result.ranked[1] = first fallback
 *   // etc.
 */

import type { PlanTaskType, PlanComplexity } from "./plannerTypes";

// ═══════════════════════════════════════════════════════════════════════════
// Provider Registry Types
// ═══════════════════════════════════════════════════════════════════════════

export type ProviderName = "FAL" | "Runway" | "MiniMax" | "Replicate" | "BFL";

export type SelectionPriority = "quality" | "balanced" | "speed" | "economy";

/** Tasks a provider can handle */
export type ProviderTaskSupport = Partial<Record<PlanTaskType, boolean>>;

/** Quality score (0–1) for a specific task type */
export type QualityProfile = Partial<Record<PlanTaskType, number>>;

export interface ModelProfile {
  /** Canonical model name */
  modelId: string;
  /** Display label */
  label: string;
  /** Which provider owns this model */
  provider: ProviderName;
  /** Internal API service name (used in PlanStep.service) */
  service: string;
  /** Internal routing endpoint */
  endpoint: string;
  /** Additional params required for the /generate endpoint */
  modelParams?: Record<string, any>;
  /** Estimated cost per generation */
  creditCost: number;
  /** Which task types this model handles */
  tasks: ProviderTaskSupport;
  /** Output quality per task (0–1, where 1 = best in class) */
  quality: QualityProfile;
  /** P50 latency in seconds (lower = better) */
  latencyP50Seconds: number;
  /** Keywords describing this model's stylistic strengths */
  styleStrengths: string[];
  /** Keywords this model handles poorly */
  styleWeaknesses: string[];
  /** Maximum supported video/music duration in seconds (null = no limit) */
  maxDurationSeconds: number | null;
  /** Whether this model is currently enabled */
  enabled: boolean;
  /** Uptime/reliability score 0–1 (based on historical SLA) */
  availability: number;
  /** Complexity tiers this model is optimal for */
  complexityFit: PlanComplexity[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Provider Registry — Ground Truth for all available models
// ═══════════════════════════════════════════════════════════════════════════

export const MODEL_REGISTRY: ModelProfile[] = [
  // ─── FAL ──────────────────────────────────────────────────────────────────

  {
    modelId: "fal/flux-dev",
    label: "FAL Flux Dev",
    provider: "FAL",
    service: "fal_image",
    endpoint: "/api/fal/generate",
    modelParams: { model: "fal-ai/flux/dev" },
    creditCost: 100,
    tasks: { image: true, image_ad: true },
    quality: { image: 0.75, image_ad: 0.7 },
    latencyP50Seconds: 12,
    styleStrengths: [
      "artistic",
      "illustration",
      "cartoon",
      "anime",
      "sketch",
      "watercolor",
      "abstract",
      "fantasy",
      "creative",
    ],
    styleWeaknesses: [
      "photorealistic",
      "hyperrealistic",
      "product",
      "corporate",
    ],
    maxDurationSeconds: null,
    enabled: true,
    availability: 0.97,
    complexityFit: ["low", "medium"],
  },
  {
    modelId: "fal/flux-pro",
    label: "FAL Flux Pro",
    provider: "FAL",
    service: "fal_image_pro",
    endpoint: "/api/fal/generate",
    modelParams: { model: "fal-ai/flux-pro/v1.1" },
    creditCost: 200,
    tasks: { image: true, image_ad: true },
    quality: { image: 0.87, image_ad: 0.85 },
    latencyP50Seconds: 18,
    styleStrengths: [
      "photorealistic",
      "portrait",
      "product",
      "realistic",
      "commercial",
      "professional",
    ],
    styleWeaknesses: ["abstract", "surreal"],
    maxDurationSeconds: null,
    enabled: true,
    availability: 0.96,
    complexityFit: ["medium", "high"],
  },
  {
    modelId: "fal/video",
    label: "FAL Video",
    provider: "FAL",
    service: "fal_video",
    endpoint: "/api/fal/video",
    creditCost: 400,
    tasks: { video: true, multimodal: true },
    quality: { video: 0.74, multimodal: 0.7 },
    latencyP50Seconds: 45,
    styleStrengths: [
      "short",
      "social",
      "reel",
      "tiktok",
      "instagram",
      "fast",
      "quick",
      "animated",
    ],
    styleWeaknesses: ["cinematic", "film", "dramatic", "ultra-hd"],
    maxDurationSeconds: 15,
    enabled: true,
    availability: 0.95,
    complexityFit: ["low", "medium"],
  },
  {
    modelId: "fal/music",
    label: "FAL Music",
    provider: "FAL",
    service: "fal_music",
    endpoint: "/api/fal/music",
    creditCost: 180,
    tasks: { music: true },
    quality: { music: 0.76 },
    latencyP50Seconds: 20,
    styleStrengths: [
      "electronic",
      "edm",
      "pop",
      "upbeat",
      "energetic",
      "dance",
      "hip-hop",
    ],
    styleWeaknesses: ["orchestral", "classical", "jazz", "acoustic"],
    maxDurationSeconds: 120,
    enabled: true,
    availability: 0.94,
    complexityFit: ["low", "medium"],
  },
  {
    modelId: "fal/tts",
    label: "FAL TTS",
    provider: "FAL",
    service: "fal_voice",
    endpoint: "/api/fal/tts",
    creditCost: 150,
    tasks: { voice: true },
    quality: { voice: 0.85 },
    latencyP50Seconds: 8,
    styleStrengths: [
      "professional",
      "narration",
      "documentary",
      "corporate",
      "formal",
      "expressive",
    ],
    styleWeaknesses: ["casual", "whisper"],
    maxDurationSeconds: 600,
    enabled: true,
    availability: 0.98,
    complexityFit: ["low", "medium", "high"],
  },

  // ─── Runway ───────────────────────────────────────────────────────────────

  {
    modelId: "runway/gen3",
    label: "Runway Gen-3 Alpha",
    provider: "Runway",
    service: "runway_video",
    endpoint: "/api/runway/generate",
    creditCost: 500,
    tasks: { video: true, video_ad: true, multimodal: true },
    quality: { video: 0.95, video_ad: 0.94, multimodal: 0.9 },
    latencyP50Seconds: 65,
    styleStrengths: [
      "cinematic",
      "film",
      "movie",
      "dramatic",
      "professional",
      "commercial",
      "documentary",
      "ultra-hd",
      "slow-motion",
      "luxury",
      "editorial",
    ],
    styleWeaknesses: ["fast", "quick", "cheap", "lo-fi"],
    maxDurationSeconds: 30,
    enabled: true,
    availability: 0.93,
    complexityFit: ["medium", "high"],
  },

  // ─── MiniMax ──────────────────────────────────────────────────────────────

  {
    modelId: "minimax/music",
    label: "MiniMax Music",
    provider: "MiniMax",
    service: "minimax_music",
    endpoint: "/api/minimax/music",
    creditCost: 200,
    tasks: { music: true },
    quality: { music: 0.9 },
    latencyP50Seconds: 25,
    styleStrengths: [
      "orchestral",
      "cinematic",
      "epic",
      "ambient",
      "classical",
      "film score",
      "atmospheric",
      "jazz",
      "acoustic",
      "emotional",
    ],
    styleWeaknesses: ["edm", "electronic", "trap"],
    maxDurationSeconds: 240,
    enabled: true,
    availability: 0.95,
    complexityFit: ["low", "medium", "high"],
  },

  // ─── Replicate ────────────────────────────────────────────────────────────

  {
    modelId: "replicate/image",
    label: "Replicate Image",
    provider: "Replicate",
    service: "replicate_image",
    endpoint: "/api/replicate/image",
    creditCost: 150,
    tasks: { image: true, image_ad: true },
    quality: { image: 0.8, image_ad: 0.78 },
    latencyP50Seconds: 20,
    styleStrengths: [
      "photorealistic",
      "portrait",
      "realistic",
      "nature",
      "landscape",
      "diverse",
    ],
    styleWeaknesses: ["artistic", "abstract"],
    maxDurationSeconds: null,
    enabled: true,
    availability: 0.92,
    complexityFit: ["low", "medium", "high"],
  },
  {
    modelId: "replicate/video",
    label: "Replicate Video",
    provider: "Replicate",
    service: "replicate_video",
    endpoint: "/api/replicate/video",
    creditCost: 450,
    tasks: { video: true, multimodal: true },
    quality: { video: 0.78, multimodal: 0.75 },
    latencyP50Seconds: 55,
    styleStrengths: [
      "animation",
      "cartoon",
      "3d",
      "artistic",
      "diverse-models",
    ],
    styleWeaknesses: ["cinematic", "photorealistic"],
    maxDurationSeconds: 20,
    enabled: true,
    availability: 0.91,
    complexityFit: ["low", "medium"],
  },
  {
    modelId: "replicate/tts",
    label: "Replicate TTS",
    provider: "Replicate",
    service: "replicate_voice",
    endpoint: "/api/replicate/tts",
    creditCost: 130,
    tasks: { voice: true },
    quality: { voice: 0.76 },
    latencyP50Seconds: 6,
    styleStrengths: ["casual", "conversational", "friendly", "fast", "natural"],
    styleWeaknesses: ["professional", "dramatic", "expressive"],
    maxDurationSeconds: 300,
    enabled: true,
    availability: 0.93,
    complexityFit: ["low", "medium"],
  },

  // ─── BFL ──────────────────────────────────────────────────────────────────

  {
    modelId: "bfl/flux-1-pro",
    label: "BFL FLUX.1 Pro",
    provider: "BFL",
    service: "bfl_image",
    endpoint: "/api/bfl/generate",
    creditCost: 300,
    tasks: { image: true, image_ad: true },
    quality: { image: 0.97, image_ad: 0.95 },
    latencyP50Seconds: 25,
    styleStrengths: [
      "photorealistic",
      "hyperrealistic",
      "product",
      "commercial",
      "portrait",
      "fashion",
      "architectural",
      "ultra-hd",
      "professional",
    ],
    styleWeaknesses: ["cartoon", "anime", "illustration"],
    maxDurationSeconds: null,
    enabled: true,
    availability: 0.94,
    complexityFit: ["high"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Selection Weights per Priority Mode
// ═══════════════════════════════════════════════════════════════════════════

interface ScoringWeights {
  quality: number; // 0–1, output quality
  cost: number; // 0–1, inversely proportional to creditCost
  latency: number; // 0–1, inversely proportional to p50 latency
  styleMatch: number; // 0–1, keyword overlap with styleStrengths
  availability: number; // 0–1, provider uptime reliability
}

const PRIORITY_WEIGHTS: Record<SelectionPriority, ScoringWeights> = {
  quality: {
    quality: 0.55,
    styleMatch: 0.25,
    availability: 0.1,
    latency: 0.05,
    cost: 0.05,
  },
  balanced: {
    quality: 0.35,
    styleMatch: 0.25,
    cost: 0.2,
    latency: 0.12,
    availability: 0.08,
  },
  speed: {
    latency: 0.5,
    quality: 0.25,
    styleMatch: 0.12,
    cost: 0.08,
    availability: 0.05,
  },
  economy: {
    cost: 0.5,
    quality: 0.25,
    latency: 0.12,
    styleMatch: 0.08,
    availability: 0.05,
  },
};

// Reference points for normalisation
const MAX_CREDIT_COST = 600; // above this → cost score 0
const MAX_LATENCY_SECONDS = 120; // above this → latency score 0

// ═══════════════════════════════════════════════════════════════════════════
// Selection Input / Output
// ═══════════════════════════════════════════════════════════════════════════

export interface ModelSelectionInput {
  taskType: PlanTaskType;
  style: string;
  complexity: PlanComplexity;
  /** User preference mode */
  priority: SelectionPriority;
  /** Hard upper bound on credit cost (optional) */
  creditLimit?: number;
  /** Required output duration in seconds (video / music) */
  durationSeconds?: number;
}

export interface ScoredModel {
  profile: ModelProfile;
  /** Composite score 0–1 */
  score: number;
  /** Breakdown of individual dimension scores */
  breakdown: {
    quality: number;
    cost: number;
    latency: number;
    styleMatch: number;
    availability: number;
  };
  /** Why this model scored well */
  reasoning: string;
}

export interface ModelSelectionResult {
  /** Best model (use this one) */
  primary: ScoredModel;
  /** Ranked list including primary (use [1], [2]... as fallbacks) */
  ranked: ScoredModel[];
  /** Selection input echoed back */
  input: ModelSelectionInput;
  /** Total candidates evaluated */
  evaluated: number;
  /** Total candidates filtered out by hard constraints */
  filtered: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Scoring Functions
// ═══════════════════════════════════════════════════════════════════════════

function scoreQuality(model: ModelProfile, taskType: PlanTaskType): number {
  return model.quality[taskType] ?? 0.5;
}

function scoreCost(model: ModelProfile): number {
  return Math.max(0, 1 - model.creditCost / MAX_CREDIT_COST);
}

function scoreLatency(model: ModelProfile): number {
  return Math.max(0, 1 - model.latencyP50Seconds / MAX_LATENCY_SECONDS);
}

function scoreStyleMatch(model: ModelProfile, style: string): number {
  if (!style) return 0.5;
  const words = style
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (words.length === 0) return 0.5;

  let strengthHits = 0;
  let weaknessHits = 0;

  for (const word of words) {
    if (model.styleStrengths.some((s) => s.includes(word) || word.includes(s)))
      strengthHits++;
    if (model.styleWeaknesses.some((w) => w.includes(word) || word.includes(w)))
      weaknessHits++;
  }

  const strengthScore = strengthHits / words.length;
  const weaknessPenalty = (weaknessHits / words.length) * 0.5;

  return Math.max(0, Math.min(1, strengthScore - weaknessPenalty));
}

function scoreAvailability(model: ModelProfile): number {
  return model.availability;
}

// ═══════════════════════════════════════════════════════════════════════════
// Hard Constraint Filters
// ═══════════════════════════════════════════════════════════════════════════

function passesHardConstraints(
  model: ModelProfile,
  input: ModelSelectionInput,
): { pass: boolean; reason?: string } {
  if (!model.enabled) {
    return { pass: false, reason: "Model is disabled" };
  }
  if (!model.tasks[input.taskType]) {
    return {
      pass: false,
      reason: `Does not support task type: ${input.taskType}`,
    };
  }
  if (input.creditLimit !== undefined && model.creditCost > input.creditLimit) {
    return {
      pass: false,
      reason: `Exceeds credit limit (${model.creditCost} > ${input.creditLimit})`,
    };
  }
  if (
    input.durationSeconds !== undefined &&
    model.maxDurationSeconds !== null &&
    input.durationSeconds > model.maxDurationSeconds
  ) {
    return {
      pass: false,
      reason: `Duration ${input.durationSeconds}s exceeds max ${model.maxDurationSeconds}s`,
    };
  }
  return { pass: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Complexity fit bonus
// ═══════════════════════════════════════════════════════════════════════════

function complexityBonus(
  model: ModelProfile,
  complexity: PlanComplexity,
): number {
  return model.complexityFit.includes(complexity) ? 0.05 : -0.1;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Selection Engine
// ═══════════════════════════════════════════════════════════════════════════

export class ModelSelectionEngine {
  private registry: ModelProfile[];

  constructor(registry: ModelProfile[] = MODEL_REGISTRY) {
    this.registry = registry;
  }

  /**
   * Select the optimal model for a given task + constraints.
   *
   * Returns a ranked list of candidates. The primary (ranked[0]) is the
   * best choice. Use ranked[1], [2], etc. as fallbacks if primary fails.
   */
  select(input: ModelSelectionInput): ModelSelectionResult {
    const weights = PRIORITY_WEIGHTS[input.priority];
    const candidates: ScoredModel[] = [];
    let filtered = 0;

    for (const model of this.registry) {
      const constraint = passesHardConstraints(model, input);
      if (!constraint.pass) {
        filtered++;
        continue;
      }

      const qs = scoreQuality(model, input.taskType);
      const cs = scoreCost(model);
      const ls = scoreLatency(model);
      const ss = scoreStyleMatch(model, input.style);
      const avs = scoreAvailability(model);
      const bonus = complexityBonus(model, input.complexity);

      const composite = Math.min(
        1,
        Math.max(
          0,
          qs * weights.quality +
            cs * weights.cost +
            ls * weights.latency +
            ss * weights.styleMatch +
            avs * weights.availability +
            bonus,
        ),
      );

      // Build a human-readable reasoning string
      const topStrength = model.styleStrengths.slice(0, 2).join(", ");
      const reasoning = [
        `Quality: ${(qs * 100).toFixed(0)}%`,
        `Cost: ${model.creditCost}cr`,
        `Latency: ~${model.latencyP50Seconds}s`,
        topStrength ? `Strengths: ${topStrength}` : "",
        model.complexityFit.includes(input.complexity)
          ? `✓ optimal for ${input.complexity} complexity`
          : "",
      ]
        .filter(Boolean)
        .join(" | ");

      candidates.push({
        profile: model,
        score: composite,
        breakdown: {
          quality: qs,
          cost: cs,
          latency: ls,
          styleMatch: ss,
          availability: avs,
        },
        reasoning,
      });
    }

    // Sort descending by composite score
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      throw new Error(
        `[ModelSelectionEngine] No suitable model found for task=${input.taskType}, priority=${input.priority}. Filtered: ${filtered}`,
      );
    }

    return {
      primary: candidates[0],
      ranked: candidates,
      input,
      evaluated: candidates.length,
      filtered,
    };
  }

  /**
   * Get the full fallback chain for a given task.
   * Returns services in priority order for use in qualityEvaluator retry chains.
   */
  getFallbackChain(input: ModelSelectionInput): string[] {
    try {
      const result = this.select(input);
      return result.ranked.map((r) => r.profile.service);
    } catch {
      return [];
    }
  }

  /**
   * Apply selection result to a PlanStep in-place.
   * Returns a diff log for auditing.
   */
  applyToStep(
    step: {
      service: string;
      endpoint: string;
      creditCost: number;
      [key: string]: any;
    },
    input: ModelSelectionInput,
  ): { applied: boolean; selection?: ScoredModel; reason?: string } {
    try {
      const result = this.select(input);
      const best = result.primary;

      if (best.profile.service === step.service) {
        return {
          applied: false,
          selection: best,
          reason: "Already using optimal model",
        };
      }

      step.service = best.profile.service;
      step.endpoint = best.profile.endpoint;
      step.creditCost = best.profile.creditCost;

      if (best.profile.modelParams) {
        step.params = { ...(step.params || {}), ...best.profile.modelParams };
      }

      return { applied: true, selection: best };
    } catch (err: any) {
      return { applied: false, reason: err?.message };
    }
  }

  /**
   * List all models for a given task type.
   * Useful for admin UIs and debugging.
   */
  listModels(taskType?: PlanTaskType): ModelProfile[] {
    if (!taskType) return this.registry.filter((m) => m.enabled);
    return this.registry.filter((m) => m.enabled && m.tasks[taskType]);
  }
}

// Singleton export for use throughout the orchestrator
export const modelSelectionEngine = new ModelSelectionEngine();
