/**
 * WildMind AI Orchestrator — Intent Classifier
 *
 * Analyzes a raw user prompt and returns a structured ClassificationResult.
 *
 * LLM Fallback Chain (all via Replicate — no OpenAI API key needed):
 *   1. GPT-5 via Replicate   (primary — strongest reasoning)
 *   2. Gemini 1.5 Pro        (free-tier fallback)
 *   3. Rule-based heuristic  (always succeeds)
 */

import { generateGeminiTextResponse } from "../services/genai/geminiTextService";
import {
  generateReplicateLLMResponse,
  GPT_5_MODEL,
  GPT_5_NANO_MODEL,
} from "../services/genai/gpt5NanoService";
import type {
  ClassificationResult,
  GenerationCategory,
  TaskType,
  Complexity,
} from "./types/orchestratorTypes";

// ---------------------------------------------------------------------------
// System prompt: forces LLM to return only valid JSON
// ---------------------------------------------------------------------------

const CLASSIFICATION_SYSTEM_PROMPT = `
You are a creative AI task classifier for the WildMind AI platform.
Your job is to analyze a user prompt and return a structured JSON classification.

VALID TASK TYPES: image, video, music, voice, video_ad, image_ad, multimodal, unknown

RULES:
1. Return ONLY a valid JSON object — no markdown, no explanation, no code fences.
2. "taskType" must be exactly one of the valid task types above.
3. "assetsNeeded" must be an array — valid values: "image", "video", "music", "voice", "script".
4. "complexity" must be: "low", "medium", or "high".
5. "duration" must be a number in seconds for video/music, or null for image/voice.
6. "confidence" is a float 0.0–1.0 indicating your certainty.
7. For any kind of advertisement: use "video_ad" or "image_ad" as taskType.
8. For prompts that combine multiple media types (e.g. video + music): use "multimodal".

RETURN FORMAT (strict):
{
  "taskType": "video_ad",
  "assetsNeeded": ["video", "music", "voice"],
  "style": "cinematic",
  "tone": "energetic",
  "complexity": "high",
  "subject": "fitness app product promotion",
  "duration": 30,
  "confidence": 0.95
}
`.trim();

// ---------------------------------------------------------------------------
// Keyword heuristic fallback — deterministic, never throws
// ---------------------------------------------------------------------------

const HEURISTIC_KEYWORDS: Array<{
  keywords: string[];
  taskType: TaskType;
  assetsNeeded: string[];
}> = [
  {
    keywords: [
      "ad",
      "advertisement",
      "commercial",
      "promo",
      "promotional",
      "marketing campaign",
    ],
    taskType: "video_ad",
    assetsNeeded: ["video", "music", "voice"],
  },
  {
    keywords: [
      "video",
      "film",
      "movie",
      "cinematic",
      "reel",
      "footage",
      "animate",
      "animation",
    ],
    taskType: "video",
    assetsNeeded: ["video"],
  },
  {
    keywords: [
      "music",
      "song",
      "audio",
      "sound",
      "beat",
      "melody",
      "soundtrack",
      "jingle",
    ],
    taskType: "music",
    assetsNeeded: ["music"],
  },
  {
    keywords: [
      "voice",
      "voiceover",
      "narrate",
      "narration",
      "tts",
      "speech",
      "speak",
      "read",
    ],
    taskType: "voice",
    assetsNeeded: ["voice"],
  },
  {
    keywords: [
      "image",
      "photo",
      "picture",
      "illustration",
      "artwork",
      "drawing",
      "poster",
    ],
    taskType: "image",
    assetsNeeded: ["image"],
  },
];

function heuristicClassify(prompt: string): ClassificationResult {
  const lower = prompt.toLowerCase();

  for (const rule of HEURISTIC_KEYWORDS) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return buildResult(
        rule.taskType,
        rule.assetsNeeded,
        "realistic",
        "neutral",
        "medium",
        prompt.slice(0, 60),
        null,
        "heuristic",
        0.4,
      );
    }
  }

  // Ultimate default: image
  return buildResult(
    "image",
    ["image"],
    "realistic",
    "neutral",
    "low",
    prompt.slice(0, 60),
    null,
    "default",
    0.1,
  );
}

// ---------------------------------------------------------------------------
// Parse & validate raw LLM JSON output
// ---------------------------------------------------------------------------

function parseLLMResponse(raw: string, model: string): ClassificationResult {
  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);

  const taskType: TaskType = VALID_TASK_TYPES.includes(parsed.taskType)
    ? parsed.taskType
    : "image";
  const complexity: Complexity = ["low", "medium", "high"].includes(
    parsed.complexity,
  )
    ? parsed.complexity
    : "medium";

  return buildResult(
    taskType,
    Array.isArray(parsed.assetsNeeded) ? parsed.assetsNeeded : [taskType],
    typeof parsed.style === "string" ? parsed.style : "realistic",
    typeof parsed.tone === "string" ? parsed.tone : "neutral",
    complexity,
    typeof parsed.subject === "string" ? parsed.subject : "",
    typeof parsed.duration === "number" ? parsed.duration : null,
    model,
    typeof parsed.confidence === "number"
      ? Math.min(1, Math.max(0, parsed.confidence))
      : null,
  );
}

const VALID_TASK_TYPES: TaskType[] = [
  "image",
  "video",
  "music",
  "voice",
  "video_ad",
  "image_ad",
  "multimodal",
  "unknown",
];

function buildResult(
  taskType: TaskType,
  assetsNeeded: string[],
  style: string,
  tone: string,
  complexity: Complexity,
  subject: string,
  duration: number | null,
  classifiedBy: string,
  confidence: number | null,
): ClassificationResult {
  const categoryMap: Record<TaskType, GenerationCategory> = {
    image: "image",
    video: "video",
    music: "music",
    voice: "voice",
    video_ad: "advertisement",
    image_ad: "advertisement",
    multimodal: "multimodal",
    unknown: "unknown",
  };

  return {
    taskType,
    assetsNeeded,
    style,
    tone,
    complexity,
    subject,
    duration,
    category: categoryMap[taskType],
    classifiedBy,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classifies a user prompt into a structured generation plan.
 *
 * Uses Gemini → GPT-5 Nano → heuristic fallback chain.
 * Never throws — always returns a ClassificationResult.
 */
export async function classifyIntent(
  prompt: string,
): Promise<ClassificationResult> {
  if (!prompt?.trim()) {
    return heuristicClassify("");
  }

  // --- Attempt 1: GPT-5 via Replicate (primary) ---
  try {
    console.log("[IntentClassifier] Attempting GPT-5 (Replicate) classification");
    const raw = await generateReplicateLLMResponse(
      prompt,
      {
        systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
        maxCompletionTokens: 512,
        reasoningEffort: "low",
        verbosity: "low",
      },
      GPT_5_MODEL,
    );
    const result = parseLLMResponse(raw, "openai/gpt-5");
    console.log(
      "[IntentClassifier] ✅ GPT-5 classified:",
      result.taskType,
      `(confidence: ${result.confidence})`,
    );
    return result;
  } catch (err: any) {
    console.warn(
      "[IntentClassifier] GPT-5 failed, trying Gemini:",
      err?.message,
    );
  }

  // --- Attempt 2: Gemini 1.5 Pro ---
  try {
    console.log("[IntentClassifier] Attempting Gemini classification");
    const raw = await generateGeminiTextResponse(prompt, {
      systemInstruction: CLASSIFICATION_SYSTEM_PROMPT,
      maxOutputTokens: 512,
      enableThinking: false,
      enableGoogleSearchTool: false,
    });
    const result = parseLLMResponse(raw, "gemini-1.5-pro");
    console.log(
      "[IntentClassifier] ✅ Gemini classified:",
      result.taskType,
      `(confidence: ${result.confidence})`,
    );
    return result;
  } catch (err: any) {
    console.warn(
      "[IntentClassifier] Gemini failed, trying GPT-5 Nano:",
      err?.message,
    );
  }

  // --- Attempt 3: GPT-5 Nano via Replicate (last LLM resort) ---
  try {
    console.log("[IntentClassifier] Attempting GPT-5 Nano classification");
    const raw = await generateReplicateLLMResponse(
      prompt,
      {
        systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
        maxCompletionTokens: 512,
        reasoningEffort: "minimal",
        verbosity: "low",
      },
      GPT_5_NANO_MODEL,
    );
    const result = parseLLMResponse(raw, "openai/gpt-5-nano");
    console.log(
      "[IntentClassifier] ✅ GPT-5 Nano classified:",
      result.taskType,
      `(confidence: ${result.confidence})`,
    );
    return result;
  } catch (err: any) {
    console.warn(
      "[IntentClassifier] GPT-5 Nano failed, using heuristic:",
      err?.message,
    );
  }

  // --- Fallback: Heuristic ---
  const result = heuristicClassify(prompt);
  console.log(
    "[IntentClassifier] ⚠️ Using heuristic fallback, taskType:",
    result.taskType,
  );
  return result;
}
