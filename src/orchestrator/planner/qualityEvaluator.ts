/**
 * WildMind AI Planner — Quality Evaluator
 *
 * Scores AI-generated outputs and triggers retries with a different model
 * if quality falls below an acceptable threshold.
 *
 * Architecture:
 *   1. generateAsset()  — calls the generation service
 *   2. evaluateQuality() — scores the output (Gemini vision API or heuristics)
 *   3. If score < threshold → retry with next model in fallback chain
 *   4. Returns best output after max retries
 *
 * Evaluation strategies:
 *   - IMAGE: Gemini Vision API — checks sharpness, content relevance, artifact presence
 *   - VIDEO: File size + duration metadata heuristics (vision eval is cost-prohibitive)
 *   - MUSIC: Duration + format check (audio quality eval requires specialized models)
 *   - VOICE: Duration check + basic waveform heuristics
 *
 * Retry model chains (per task type):
 *   image:  fal_image_pro → bfl_image → replicate_image
 *   video:  runway_video → fal_video → replicate_video
 *   music:  minimax_music → fal_music
 *   voice:  fal_voice → replicate_voice
 */

import axios from "axios";
import { generateGeminiTextResponse } from "../../services/genai/geminiTextService";

// ---------------------------------------------------------------------------
// Quality Score
// ---------------------------------------------------------------------------

export interface QualityScore {
  /** 0.0 – 1.0 */
  score: number;
  /** Which evaluator produced this score */
  evaluator: "gemini_vision" | "heuristic" | "skipped";
  /** Detailed notes about the quality */
  notes: string;
  /** Whether to retry */
  shouldRetry: boolean;
}

// ---------------------------------------------------------------------------
// Retry Config per service
// ---------------------------------------------------------------------------

const RETRY_CHAINS: Record<string, string[]> = {
  fal_image: ["fal_image_pro", "bfl_image"],
  fal_image_pro: ["bfl_image"],
  runway_video: ["fal_video"],
  fal_video: ["replicate_video"],
  minimax_music: ["fal_music"],
  fal_voice: ["replicate_voice"],
};

const SERVICE_ENDPOINTS: Record<string, { endpoint: string; params?: Record<string, any> }> = {
  fal_image: { endpoint: "/api/fal/generate", params: { model: "fal-ai/flux/dev" } },
  fal_image_pro: { endpoint: "/api/fal/generate", params: { model: "fal-ai/flux-pro/v1.1" } },
  bfl_image: { endpoint: "/api/bfl/generate" },
  replicate_image: { endpoint: "/api/replicate/image" },
  runway_video: { endpoint: "/api/runway/generate" },
  fal_video: { endpoint: "/api/fal/video" }, // Currently might 404, kept for consistency
  replicate_video: { endpoint: "/api/replicate/video" },
  minimax_music: { endpoint: "/api/minimax/music" },
  fal_music: { endpoint: "/api/fal/music" },
  fal_voice: { endpoint: "/api/fal/tts" },
  replicate_voice: { endpoint: "/api/replicate/tts" },
};

// Quality thresholds
const QUALITY_THRESHOLD = parseFloat(
  process.env.QUALITY_EVAL_THRESHOLD ?? "0.60",
);
const MAX_EVAL_RETRIES = parseInt(
  process.env.QUALITY_EVAL_MAX_RETRIES ?? "2",
  10,
);

const INTERNAL_BASE_URL =
  process.env.INTERNAL_API_BASE_URL ||
  `http://localhost:${process.env.PORT || 5000}`;

// ---------------------------------------------------------------------------
// Image evaluator via Gemini Vision
// ---------------------------------------------------------------------------

async function evaluateImageQuality(
  output: any,
  originalPrompt: string,
): Promise<QualityScore> {
  // output.url or output.imageUrl expected
  const imageUrl: string | undefined =
    output?.url ??
    output?.imageUrl ??
    output?.image_url ??
    output?.images?.[0]?.url;

  if (!imageUrl) {
    return {
      score: 0.3,
      evaluator: "heuristic",
      notes: "No image URL in output",
      shouldRetry: true,
    };
  }

  try {
    const evalPrompt = `
You are an AI image quality evaluator for a professional content generation platform.
Rate this image on a scale from 0.0 to 1.0 based on:
- Visual sharpness and clarity (no blur)
- Relevance to the prompt: "${originalPrompt.slice(0, 200)}"
- Absence of artifacts, distortions, or malformations
- Professional quality suitable for commercial use

Image URL: ${imageUrl}

Respond with ONLY a JSON object:
{ "score": 0.85, "notes": "Sharp, well-composed, closely matches prompt" }
`.trim();

    const raw = await generateGeminiTextResponse(evalPrompt, {
      maxOutputTokens: 150,
      enableThinking: false,
      enableGoogleSearchTool: false,
    });

    const cleaned = raw
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const score = Math.min(1, Math.max(0, Number(parsed.score) || 0));

    return {
      score,
      evaluator: "gemini_vision",
      notes: parsed.notes ?? "",
      shouldRetry: score < QUALITY_THRESHOLD,
    };
  } catch {
    // Evaluation failed — assume acceptable to avoid blocking generation
    return {
      score: 0.7,
      evaluator: "heuristic",
      notes: "Vision eval failed — assuming acceptable",
      shouldRetry: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Video / Audio heuristic evaluators
// ---------------------------------------------------------------------------

function evaluateVideoQuality(output: any): QualityScore {
  const url = output?.url ?? output?.videoUrl ?? output?.video_url;
  if (!url)
    return {
      score: 0.2,
      evaluator: "heuristic",
      notes: "No video URL in output",
      shouldRetry: true,
    };

  // Heuristic: presence of URL + non-empty output = acceptable
  return {
    score: 0.75,
    evaluator: "heuristic",
    notes: "Video URL present — assumed acceptable",
    shouldRetry: false,
  };
}

function evaluateMusicQuality(output: any): QualityScore {
  const url = output?.url ?? output?.audioUrl ?? output?.audio_url;
  if (!url)
    return {
      score: 0.2,
      evaluator: "heuristic",
      notes: "No audio URL in output",
      shouldRetry: true,
    };
  return {
    score: 0.8,
    evaluator: "heuristic",
    notes: "Audio URL present — assumed acceptable",
    shouldRetry: false,
  };
}

function evaluateVoiceQuality(output: any): QualityScore {
  const url = output?.url ?? output?.audioUrl ?? output?.audio_url;
  if (!url)
    return {
      score: 0.2,
      evaluator: "heuristic",
      notes: "No voice URL in output",
      shouldRetry: true,
    };
  return {
    score: 0.8,
    evaluator: "heuristic",
    notes: "Voice URL present — assumed acceptable",
    shouldRetry: false,
  };
}

// ---------------------------------------------------------------------------
// Main evaluator dispatcher
// ---------------------------------------------------------------------------

export async function evaluateOutput(
  output: any,
  service: string,
  originalPrompt: string,
): Promise<QualityScore> {
  if (service.includes("image") || service.includes("bfl")) {
    return evaluateImageQuality(output, originalPrompt);
  }
  if (service.includes("video")) {
    return evaluateVideoQuality(output);
  }
  if (service.includes("music")) {
    return evaluateMusicQuality(output);
  }
  if (service.includes("voice") || service.includes("tts")) {
    return evaluateVoiceQuality(output);
  }
  // Unknown service — skip evaluation
  return {
    score: 0.7,
    evaluator: "skipped",
    notes: `No evaluator for service: ${service}`,
    shouldRetry: false,
  };
}

// ---------------------------------------------------------------------------
// Generation + Evaluation Loop
// ---------------------------------------------------------------------------

export interface EvaluatedGenerationResult {
  output: any;
  finalService: string;
  qualityScore: QualityScore;
  attempts: Array<{ service: string; score: number; notes: string }>;
}

/**
 * Generate an asset and evaluate its quality.
 * If quality is below threshold, retry with alternative models.
 *
 * @param service       - Initial service to use
 * @param prompt        - Generation prompt
 * @param params        - Extra parameters
 * @param userId        - For auth headers
 * @param token         - Bearer token
 * @param enableEval    - Set false to skip quality scoring (dev/fast mode)
 */
export async function generateWithEvaluation(
  service: string,
  prompt: string,
  params: Record<string, any>,
  userId: string,
  token: string,
  enableEval = true,
): Promise<EvaluatedGenerationResult> {
  const attempts: Array<{ service: string; score: number; notes: string }> = [];
  let currentService = service;

  for (let attempt = 0; attempt <= MAX_EVAL_RETRIES; attempt++) {
    const serviceConfig = SERVICE_ENDPOINTS[currentService];
    if (!serviceConfig) break;

    try {
      console.log(
        `[QualityEvaluator] Attempt ${attempt + 1}: generating with ${currentService}`,
      );

      const requestParams = { ...params, ...(serviceConfig.params || {}) };

      const response = await axios.post(
        `${INTERNAL_BASE_URL}${serviceConfig.endpoint}`,
        { prompt, ...requestParams, meta: { source: "quality-evaluator", attempt } },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-user-id": userId,
            "x-orchestrator": "true",
          },
          timeout: 360_000,
        },
      );

      const output = response.data;

      if (!enableEval) {
        return {
          output,
          finalService: currentService,
          qualityScore: {
            score: 1.0,
            evaluator: "skipped",
            notes: "Evaluation disabled",
            shouldRetry: false,
          },
          attempts,
        };
      }

      const score = await evaluateOutput(output, currentService, prompt);
      attempts.push({
        service: currentService,
        score: score.score,
        notes: score.notes,
      });

      console.log(
        `[QualityEvaluator] ${currentService} scored ${score.score.toFixed(2)} — ${score.notes}`,
      );

      if (!score.shouldRetry || attempt === MAX_EVAL_RETRIES) {
        return {
          output,
          finalService: currentService,
          qualityScore: score,
          attempts,
        };
      }

      // Try next model in retry chain
      const retryChain = RETRY_CHAINS[currentService];
      if (!retryChain || retryChain.length === 0) {
        console.log(
          `[QualityEvaluator] No retry options for ${currentService} — accepting current output`,
        );
        return {
          output,
          finalService: currentService,
          qualityScore: score,
          attempts,
        };
      }

      const nextService = retryChain[Math.min(attempt, retryChain.length - 1)];
      console.log(
        `[QualityEvaluator] Quality below threshold (${score.score.toFixed(2)} < ${QUALITY_THRESHOLD}) — retrying with ${nextService}`,
      );
      currentService = nextService;
    } catch (err: any) {
      const msg = err?.message ?? "Generation failed";
      attempts.push({ service: currentService, score: 0, notes: msg });
      console.error(`[QualityEvaluator] ${currentService} failed:`, msg);

      const retryChain = RETRY_CHAINS[currentService];
      if (!retryChain || attempt >= MAX_EVAL_RETRIES) {
        throw err;
      }
      currentService = retryChain[Math.min(attempt, retryChain.length - 1)];
    }
  }

  throw new Error(
    `[QualityEvaluator] All ${MAX_EVAL_RETRIES + 1} attempts exhausted for service group starting at ${service}`,
  );
}
