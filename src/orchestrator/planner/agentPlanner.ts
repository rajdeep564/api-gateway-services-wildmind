/**
 * WildMind AI Planner — Agent Planner Service
 *
 * Converts a raw user prompt into a fully-validated ExecutionPlan.
 *
 * LLM Fallback Chain (all via Replicate — no OpenAI API key needed):
 *   1. GPT-5 via Replicate             → highest reasoning, schema-valid JSON
 *   2. Gemini 1.5 Pro via Google AI   → free tier, fast
 *   3. GPT-5 Nano via Replicate       → lightweight fallback
 *   4. Rule-based static plan factory → always succeeds (no LLM)
 *
 * Output is always validated and repaired by planValidator before returning.
 */

import { env } from "../../config/env";
import { completeText, completeTextGemini } from "../../modelGateway/modelGateway";
import { PROMPT_VERSIONS } from "../../modelGateway/promptVersions";
import { GPT_5_MODEL, GPT_5_NANO_MODEL } from "../../services/genai/gpt5NanoService";
import { enhanceOrchestratorPrompt } from "../promptEnhancer";
import { validateAndRepairPlan } from "./planValidator";
import { PLANNER_SYSTEM_PROMPT } from "./plannerSystemPrompt";
import type { ExecutionPlan, PlannerInput, PlanTaskType, PlanComplexity } from "./plannerTypes";

// ---------------------------------------------------------------------------
// Attempt 1: GPT-5 via Replicate (primary — strongest reasoning, via Replicate)
// ---------------------------------------------------------------------------

async function planWithGpt5(input: PlannerInput): Promise<ExecutionPlan> {
  const userMessage = input.hints
    ? `${input.prompt}\n\n[Hints: ${JSON.stringify(input.hints)}]`
    : input.prompt;

  const raw = await completeText(
    userMessage,
    {
      systemPrompt:
        PLANNER_SYSTEM_PROMPT +
        "\n\nIMPORTANT: Return ONLY raw JSON. No markdown. No code fences. No explanation.",
      maxCompletionTokens: 4000,
      reasoningEffort: "medium",
      verbosity: "low",
      promptTemplateVersion: `PLANNER=${PROMPT_VERSIONS.PLANNER}`,
    },
    GPT_5_MODEL,
  );

  const cleaned = raw
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  parsed.generatedBy = "openai/gpt-5";
  return parsed;
}


// ---------------------------------------------------------------------------
// Attempt 2: Gemini 1.5 Pro (free tier, no OpenAI key needed)
// ---------------------------------------------------------------------------

async function planWithGemini(input: PlannerInput): Promise<ExecutionPlan> {
  const userMessage = input.hints
    ? `${input.prompt}\n\n[Hints: ${JSON.stringify(input.hints)}]`
    : input.prompt;

  const raw = await completeTextGemini(userMessage, {
    systemInstruction:
      PLANNER_SYSTEM_PROMPT +
      "\n\nIMPORTANT: Return ONLY raw JSON. No markdown. No code fences.",
    maxOutputTokens: 4000,
    enableThinking: false,
    enableGoogleSearchTool: false,
    promptTemplateVersion: `PLANNER=${PROMPT_VERSIONS.PLANNER}`,
  });

  const cleaned = raw
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  parsed.generatedBy = "gemini-1.5-pro";
  return parsed;
}

// ---------------------------------------------------------------------------
// Attempt 3: GPT-5 Nano via Replicate (lightweight fallback)
// ---------------------------------------------------------------------------

async function planWithGpt5Nano(input: PlannerInput): Promise<ExecutionPlan> {
  const userMessage = input.hints
    ? `${input.prompt}\n\n[Hints: ${JSON.stringify(input.hints)}]`
    : input.prompt;

  const raw = await completeText(
    userMessage,
    {
      systemPrompt:
        PLANNER_SYSTEM_PROMPT +
        "\n\nIMPORTANT: Return ONLY raw JSON. No markdown. No code fences.",
      maxCompletionTokens: 4000,
      reasoningEffort: "low",
      verbosity: "low",
      promptTemplateVersion: `PLANNER=${PROMPT_VERSIONS.PLANNER}`,
    },
    GPT_5_NANO_MODEL,
  );

  const cleaned = raw
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  parsed.generatedBy = "openai/gpt-5-nano";
  return parsed;
}

// ---------------------------------------------------------------------------
// Attempt 4: Rule-based static plan factory (always succeeds)
// Uses keyword heuristics to pick the right task type & services
// ---------------------------------------------------------------------------

const STATIC_PLANS: Record<PlanTaskType, () => Partial<ExecutionPlan>> = {
  image: () => ({
    taskType: "image",
    steps: [
      {
        stepId: "fal_image",
        label: "Generate Image",
        service: "fal_image",
        endpoint: "/api/fal/generate",
        order: 1,
        prompt: "",
        params: {
          model: "google/nano-banana-pro",
          aspect_ratio: "1:1",
          resolution: "1K",
          output_format: "png",
        },
        creditCost: 100,
        estimatedDurationSeconds: 20,
        critical: true,
      },
    ],
    totalEstimatedCredits: 100,
    totalEstimatedDurationSeconds: 20,
  }),
  video: () => ({
    taskType: "video",
    steps: [
      {
        stepId: "runway_video",
        label: "Generate Video",
        service: "runway_video",
        endpoint: "/api/runway/generate",
        order: 1,
        prompt: "",
        params: {},
        creditCost: 500,
        estimatedDurationSeconds: 60,
        critical: true,
      },
    ],
    totalEstimatedCredits: 500,
    totalEstimatedDurationSeconds: 60,
  }),
  music: () => ({
    taskType: "music",
    steps: [
      {
        stepId: "minimax_music",
        label: "Generate Music",
        service: "minimax_music",
        endpoint: "/api/minimax/music",
        order: 1,
        prompt: "",
        params: {},
        creditCost: 200,
        estimatedDurationSeconds: 30,
        critical: true,
      },
    ],
    totalEstimatedCredits: 200,
    totalEstimatedDurationSeconds: 30,
  }),
  voice: () => ({
    taskType: "voice",
    steps: [
      {
        stepId: "fal_voice",
        label: "Generate Voice",
        service: "fal_voice",
        endpoint: "/api/fal/tts",
        order: 1,
        prompt: "",
        params: {},
        creditCost: 150,
        estimatedDurationSeconds: 10,
        critical: true,
      },
    ],
    totalEstimatedCredits: 150,
    totalEstimatedDurationSeconds: 10,
  }),
  video_ad: () => ({
    taskType: "video_ad",
    steps: [
      {
        stepId: "script_gen",
        label: "Generate Script",
        service: "script_gen",
        endpoint: "/api/orchestrator/internal/script",
        order: 1,
        prompt: "",
        params: { maxWords: 150 },
        creditCost: 50,
        estimatedDurationSeconds: 15,
        critical: true,
      },
      {
        stepId: "runway_video",
        label: "Generate Video",
        service: "runway_video",
        endpoint: "/api/runway/generate",
        order: 2,
        dependsOn: "script_gen",
        prompt: "",
        params: {},
        creditCost: 500,
        estimatedDurationSeconds: 60,
        critical: true,
      },
      {
        stepId: "minimax_music",
        label: "Generate Music",
        service: "minimax_music",
        endpoint: "/api/minimax/music",
        order: 2,
        prompt: "",
        params: {},
        creditCost: 200,
        estimatedDurationSeconds: 30,
        critical: false,
      },
      {
        stepId: "fal_voice",
        label: "Generate Voice",
        service: "fal_voice",
        endpoint: "/api/fal/tts",
        order: 3,
        dependsOn: "script_gen",
        prompt: "",
        params: {},
        creditCost: 150,
        estimatedDurationSeconds: 10,
        critical: false,
      },
    ],
    totalEstimatedCredits: 900,
    totalEstimatedDurationSeconds: 85,
  }),
  image_ad: () => ({
    taskType: "image_ad",
    steps: [
      {
        stepId: "fal_image_pro",
        label: "Generate Ad Image",
        service: "fal_image_pro",
        endpoint: "/api/fal/generate",
        order: 1,
        prompt: "",
        params: { model: "fal-ai/flux-pro/v1.1" },
        creditCost: 200,
        estimatedDurationSeconds: 25,
        critical: true,
      },
      {
        stepId: "fal_voice",
        label: "Generate Voice",
        service: "fal_voice",
        endpoint: "/api/fal/tts",
        order: 1,
        prompt: "",
        params: {},
        creditCost: 150,
        estimatedDurationSeconds: 10,
        critical: false,
      },
    ],
    totalEstimatedCredits: 350,
    totalEstimatedDurationSeconds: 25,
  }),
  multimodal: () => ({
    taskType: "multimodal",
    steps: [
      {
        stepId: "scene_breakdown",
        label: "Scene Breakdown",
        service: "scene_breakdown",
        endpoint: "/api/orchestrator/internal/scenes",
        order: 1,
        prompt: "",
        params: {},
        creditCost: 30,
        estimatedDurationSeconds: 10,
        critical: true,
      },
      {
        stepId: "runway_video",
        label: "Generate Video",
        service: "runway_video",
        endpoint: "/api/runway/generate",
        order: 2,
        dependsOn: "scene_breakdown",
        prompt: "",
        params: {},
        creditCost: 500,
        estimatedDurationSeconds: 60,
        critical: true,
      },
      {
        stepId: "minimax_music",
        label: "Generate Music",
        service: "minimax_music",
        endpoint: "/api/minimax/music",
        order: 2,
        prompt: "",
        params: {},
        creditCost: 200,
        estimatedDurationSeconds: 30,
        critical: false,
      },
    ],
    totalEstimatedCredits: 730,
    totalEstimatedDurationSeconds: 70,
  }),
};

function detectTaskTypeFromKeywords(prompt: string): PlanTaskType {
  const lower = prompt.toLowerCase();
  if (
    ["ad", "advertisement", "commercial", "promo"].some((k) =>
      lower.includes(k),
    ) &&
    ["video", "film"].some((k) => lower.includes(k))
  )
    return "video_ad";
  if (["ad", "advertisement", "promo"].some((k) => lower.includes(k)))
    return "image_ad";
  if (
    ["video", "film", "animation", "reel", "cinematic"].some((k) =>
      lower.includes(k),
    )
  )
    return "video";
  if (
    ["music", "song", "beat", "melody", "soundtrack"].some((k) =>
      lower.includes(k),
    )
  )
    return "music";
  if (["voice", "narrate", "tts", "speech"].some((k) => lower.includes(k)))
    return "voice";
  if (["video", "music"].every((k) => lower.includes(k))) return "multimodal";
  return "image";
}

async function planWithStaticFallback(
  input: PlannerInput,
  enhancedPrompt: string,
): Promise<ExecutionPlan> {
  const taskType =
    input.hints?.taskType ?? detectTaskTypeFromKeywords(input.prompt);
  const factory = STATIC_PLANS[taskType] ?? STATIC_PLANS["image"];
  const base = factory();

  // Inject the enhanced prompt into every step
  const steps = (base.steps ?? []).map((s) => ({
    ...s,
    prompt: enhancedPrompt,
  }));

  return {
    taskType,
    summary: `Generate ${taskType.replace("_", " ")} content`,
    reasoning: "Generated by rule-based fallback (all LLMs unavailable)",
    style: input.hints?.style ?? "realistic",
    tone: input.hints?.tone ?? "neutral",
    complexity: input.hints?.complexity ?? "medium",
    contentDurationSeconds: taskType === "image" ? null : 30,
    enhancedPrompt,
    originalPrompt: input.prompt,
    steps,
    totalEstimatedCredits: base.totalEstimatedCredits ?? 100,
    totalEstimatedDurationSeconds: base.totalEstimatedDurationSeconds ?? 30,
    generatedBy: "static-fallback",
    schemaVersion: "1.0",
  };
}

// ---------------------------------------------------------------------------
// Main public entry point
// ---------------------------------------------------------------------------

/**
 * Generate a complete ExecutionPlan from a user prompt.
 *
 * Fast path: if input.hints.preBuiltPlan is provided (from approvePlan endpoint),
 * skip all LLM calls and validate+return the pre-built plan directly.
 *
 * Otherwise tries LLMs in order: GPT-5 (Replicate) → Gemini → GPT-5 Nano → static fallback.
 * Always returns a valid, repaired plan. Never throws.
 */
export async function generateExecutionPlan(
  input: PlannerInput,
): Promise<ExecutionPlan> {
  // ── Fast path: pre-built plan from approval gate ──────────────────────────
  if ((input.hints as any)?.preBuiltPlan) {
    const preBuilt = (input.hints as any).preBuiltPlan as ExecutionPlan;
    console.log(
      `[AgentPlanner] ⚡ Using pre-built plan (taskType=${preBuilt.taskType}, steps=${preBuilt.steps?.length})`,
    );
    const validation = validateAndRepairPlan(preBuilt);
    if (validation.repairedPlan) {
      validation.repairedPlan.generatedBy = validation.repairedPlan.generatedBy ?? "pre-approved";
      return validation.repairedPlan;
    }
    return preBuilt;
  }

  // ── Fast path: Generate static plan directly from structured spec ─────────
  if (input.hints?.spec) {
    const spec = input.hints.spec;
    // Map 'logo' to 'image' for underlying service resolution
    const taskType: PlanTaskType = spec.taskType === "logo" ? "image" : (spec.taskType as PlanTaskType);
    
    if (STATIC_PLANS[taskType]) {
      console.log(`[AgentPlanner] ⚡ Bypassing LLM: Generating plan directly from structured spec (${taskType})`);
      
      try {
        const base = STATIC_PLANS[taskType]();
        const referenceUrl = spec.reference_image_url && typeof spec.reference_image_url === "string" ? spec.reference_image_url.trim() : undefined;

        // Simple enhanced prompt construction from the pre-built `input.prompt`
        const enhancedPrompt = input.prompt;

        const steps = (base.steps ?? []).map((s) => {
          const stepParams = { ...(s.params || {}) };
          // Pass reference image into first image step so workflow engine sends it (e.g. image_urls for FAL I2I)
          if (referenceUrl && (s.service === "fal_image" || s.service === "fal_image_pro" || s.stepId === "fal_image" || s.stepId === "fal_image_pro")) {
            stepParams.image_urls = [referenceUrl];
          }
          return {
            ...s,
            prompt: enhancedPrompt,
            params: stepParams,
          };
        });
        
        const plan: ExecutionPlan = {
          taskType,
          summary: `Generate ${taskType.replace("_", " ")} content`,
          reasoning: "Generated directly from fully structured user spec",
          style: spec.style ?? input.hints?.style ?? "realistic",
          tone: spec.brand_tone ?? spec.mood ?? input.hints?.tone ?? "neutral",
          complexity: (spec.complexity as PlanComplexity) ?? input.hints?.complexity ?? "medium",
          targetAudience: spec.target_audience ?? input.hints?.targetAudience,
          contentDurationSeconds: spec.duration ?? input.hints?.durationSeconds ?? (taskType === "image" ? null : 30),
          enhancedPrompt,
          originalPrompt: input.prompt,
          steps,
          totalEstimatedCredits: base.totalEstimatedCredits ?? 100,
          totalEstimatedDurationSeconds: base.totalEstimatedDurationSeconds ?? 30,
          generatedBy: "static-from-spec",
          schemaVersion: "1.0",
        };
        
        return plan;
      } catch (err: any) {
        console.warn(`[AgentPlanner] Spec-to-plan failed, falling back to LLM:`, err?.message);
      }
    }
  }

  if (!input.prompt?.trim()) {
    const emptyPlan = await planWithStaticFallback(
      { prompt: "generate an image" },
      "generate an image",
    );
    return emptyPlan;
  }

  // Data minimization: cap prompt length before sending to any LLM (SOC2)
  const MAX_PLANNER_PROMPT_CHARS = 8000;
  const promptForLLM =
    input.prompt.length > MAX_PLANNER_PROMPT_CHARS
      ? input.prompt.slice(0, MAX_PLANNER_PROMPT_CHARS) + "\n[truncated]"
      : input.prompt;
  const inputForLLM = { ...input, prompt: promptForLLM };

  // Pre-enhance the prompt to pass as base context to the LLM planner
  const enhancedPrompt = await enhanceOrchestratorPrompt(promptForLLM, {
    taskType: input.hints?.taskType,
    style: input.hints?.style,
    tone: input.hints?.tone,
    complexity: input.hints?.complexity,
  } as any).catch(() => promptForLLM);

  const attempts: Array<{ name: string; fn: () => Promise<ExecutionPlan> }> = [
    { name: "GPT-5 (Replicate)",      fn: () => planWithGpt5(inputForLLM) },
    { name: "GPT-5 Nano (Replicate)", fn: () => planWithGpt5Nano(inputForLLM) },
  ];

  for (const attempt of attempts) {
    try {
      console.log(`[AgentPlanner] Trying ${attempt.name}...`);
      const rawPlan = await attempt.fn();

      // Inject originalPrompt (full, untruncated) + enhancedPrompt so validator can repair missing prompts
      rawPlan.originalPrompt = input.prompt;
      if (!rawPlan.enhancedPrompt) rawPlan.enhancedPrompt = enhancedPrompt;

      const validation = validateAndRepairPlan(rawPlan);

      if (validation.warnings.length > 0) {
        console.warn(
          `[AgentPlanner] Plan repaired (${validation.warnings.length} warnings):`,
          validation.warnings,
        );
      }

      if (validation.valid && validation.repairedPlan) {
        console.log(`[AgentPlanner] ✅ Plan generated by ${attempt.name}`, {
          taskType: validation.repairedPlan.taskType,
          steps: validation.repairedPlan.steps.length,
          totalCredits: validation.repairedPlan.totalEstimatedCredits,
        });
        return validation.repairedPlan;
      }

      if (validation.errors.length > 0) {
        console.warn(
          `[AgentPlanner] ${attempt.name} produced invalid plan:`,
          validation.errors,
        );
        // Try next LLM
        continue;
      }

      if (validation.repairedPlan) return validation.repairedPlan;
    } catch (err: any) {
      console.warn(`[AgentPlanner] ${attempt.name} failed:`, err?.message);
    }
  }

  // All LLMs failed — use static fallback (pass full input so originalPrompt is preserved)
  console.warn("[AgentPlanner] All LLMs failed — using static plan fallback");
  const staticPlan = await planWithStaticFallback(input, enhancedPrompt);
  const validation = validateAndRepairPlan(staticPlan);
  return validation.repairedPlan ?? staticPlan;
}
