/**
 * WildMind AI Orchestrator — Task Router
 *
 * Deterministic routing: maps a TaskType → an ordered list of RouteService entries.
 *
 * Design principles:
 * - Zero LLM calls — pure lookup table
 * - Parallel execution: services with the same `order` number run concurrently
 * - Sequential execution: services with different `order` numbers run in order
 * - Dependencies: a step can reference a prior step's output via `dependsOn`
 * - Extensible: adding a new model/service = one new entry in ROUTING_MAP
 *
 * Adding a new generation type:
 *   1. Add a TaskType to orchestratorTypes.ts
 *   2. Add a ROUTING_MAP entry here
 *   Done. No other changes needed.
 */

import type {
  RouteDecision,
  RouteService,
  TaskType,
} from "./types/orchestratorTypes";

// ---------------------------------------------------------------------------
// Internal route service definitions (base endpoints)
//
// These point to the existing generation routes already mounted in
// api-gateway-services-wildmind. The WorkflowEngine will HTTP POST to these
// internally with the enhanced prompt and any step context.
// ---------------------------------------------------------------------------

const ENDPOINTS = {
  // Image generation
  FAL_FLUX_DEV: "/api/fal/generate",
  FAL_FLUX_PRO: "/api/fal/generate",
  BFL_GENERATE: "/api/bfl/generate",
  REPLICATE_IMAGE: "/api/replicate/image",

  // Video generation
  RUNWAY_GENERATE: "/api/runway/generate",
  REPLICATE_VIDEO: "/api/replicate/video",
  FAL_VIDEO: "/api/fal/video",

  // Music generation
  MINIMAX_MUSIC: "/api/minimax/music",
  FAL_MUSIC: "/api/fal/music",

  // Voice / TTS
  FAL_TTS: "/api/fal/tts",
  REPLICATE_TTS: "/api/replicate/tts",

  // Orchestrator-internal utilities
  SCRIPT_GEN: "/api/orchestrator/internal/script",
  SCENE_BREAKDOWN: "/api/orchestrator/internal/scenes",
} as const;

// ---------------------------------------------------------------------------
// Routing Map
// ---------------------------------------------------------------------------

/**
 * ROUTING_MAP defines every supported generation task.
 *
 * Execution order rules (enforced by WorkflowEngine):
 *   order=1 → runs first (may be parallel within same order)
 *   order=2 → runs after all order=1 steps finish
 *   order=3 → runs after all order=2 steps finish
 *
 * dependsOn → the named step's output is passed as `context` to this step
 */
const ROUTING_MAP: Record<TaskType, RouteDecision> = {
  // ─── Single-asset types ──────────────────────────────────────────────────

  image: {
    taskType: "image",
    services: [
      {
        name: "fal_image",
        endpoint: ENDPOINTS.FAL_FLUX_DEV,
        order: 1,
        extraParams: { model: "fal-ai/flux/dev" },
      },
    ],
  },

  video: {
    taskType: "video",
    services: [
      {
        name: "runway_video",
        endpoint: ENDPOINTS.RUNWAY_GENERATE,
        order: 1,
      },
    ],
  },

  music: {
    taskType: "music",
    services: [
      {
        name: "minimax_music",
        endpoint: ENDPOINTS.MINIMAX_MUSIC,
        order: 1,
      },
    ],
  },

  voice: {
    taskType: "voice",
    services: [
      {
        name: "fal_voice",
        endpoint: ENDPOINTS.FAL_TTS,
        order: 1,
      },
    ],
  },

  // ─── Multi-asset: Video Advertisement ───────────────────────────────────
  // Workflow:
  //   [1] Script generation (sequential — everything depends on this)
  //   [2] Video + Music in PARALLEL (both use the script)
  //   [3] Voiceover (uses script, added after video+music complete)

  video_ad: {
    taskType: "video_ad",
    services: [
      {
        name: "script_gen",
        endpoint: ENDPOINTS.SCRIPT_GEN,
        order: 1,
        promptOverride: undefined, // uses the enhanced prompt as-is
        extraParams: { maxWords: 150 },
      },
      {
        name: "runway_video",
        endpoint: ENDPOINTS.RUNWAY_GENERATE,
        order: 2,
        dependsOn: "script_gen", // receives script output as context
      },
      {
        name: "minimax_music",
        endpoint: ENDPOINTS.MINIMAX_MUSIC,
        order: 2, // runs in PARALLEL with runway_video
        extraParams: { mood: "from_plan" }, // WorkflowEngine injects tone
      },
      {
        name: "fal_voice",
        endpoint: ENDPOINTS.FAL_TTS,
        order: 3,
        dependsOn: "script_gen", // reads the script for narration text
      },
    ],
  },

  // ─── Image Advertisement ────────────────────────────────────────────────
  // Workflow: [1] Image + Voice in PARALLEL

  image_ad: {
    taskType: "image_ad",
    services: [
      {
        name: "fal_image",
        endpoint: ENDPOINTS.FAL_FLUX_PRO, // use pro for ads
        order: 1,
        extraParams: { model: "fal-ai/flux-pro/v1.1" },
      },
      {
        name: "fal_voice",
        endpoint: ENDPOINTS.FAL_TTS,
        order: 1, // parallel with image
      },
    ],
  },

  // ─── Multi-modal ────────────────────────────────────────────────────────
  // Workflow: [1] Scene breakdown → [2] Video + Music in PARALLEL

  multimodal: {
    taskType: "multimodal",
    services: [
      {
        name: "scene_breakdown",
        endpoint: ENDPOINTS.SCENE_BREAKDOWN,
        order: 1,
      },
      {
        name: "runway_video",
        endpoint: ENDPOINTS.RUNWAY_GENERATE,
        order: 2,
        dependsOn: "scene_breakdown",
      },
      {
        name: "minimax_music",
        endpoint: ENDPOINTS.MINIMAX_MUSIC,
        order: 2, // parallel with video
      },
    ],
  },

  // ─── Unknown / fallback ─────────────────────────────────────────────────
  unknown: {
    taskType: "unknown",
    services: [
      {
        name: "fal_image",
        endpoint: ENDPOINTS.FAL_FLUX_DEV,
        order: 1,
        extraParams: { model: "fal-ai/flux/dev" },
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the RouteDecision for a given task type.
 * Falls back to image generation for unknown task types.
 */
export function routeTask(taskType: TaskType): RouteDecision {
  const decision = ROUTING_MAP[taskType];
  if (!decision) {
    console.warn(
      `[TaskRouter] Unknown taskType "${taskType}", falling back to image`,
    );
    return ROUTING_MAP["image"];
  }
  console.log(
    `[TaskRouter] Routing "${taskType}" → [${decision.services.map((s) => s.name).join(", ")}]`,
  );
  return decision;
}

/**
 * Returns all registered task types.
 */
export function getSupportedTaskTypes(): TaskType[] {
  return Object.keys(ROUTING_MAP) as TaskType[];
}

/**
 * Returns the estimated credit cost for a task type.
 */
export function estimateCredits(taskType: TaskType): number {
  const CREDIT_MAP: Record<TaskType, number> = {
    image: 100,
    video: 500,
    music: 200,
    voice: 150,
    video_ad: 1200,
    image_ad: 350,
    multimodal: 800,
    unknown: 100,
  };
  return CREDIT_MAP[taskType] ?? 100;
}
