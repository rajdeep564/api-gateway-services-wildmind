/**
 * WildMind AI Orchestrator — Prompt Enhancer
 *
 * Wraps the existing `promptEnhancerService` with orchestrator context awareness.
 * Injects style, tone, and complexity information before calling the LLM enhancement chain.
 *
 * Enhancement Chain (handled by promptEnhancerService):
 *   1. Replicate (GPT-5) → 2. Gemini → 3. Python FastAPI service
 */

import {
  enhancePrompt,
  type MediaType,
} from "../services/promptEnhancerService";
import type {
  OrchestratorPlan,
  ClassificationResult,
} from "./types/orchestratorTypes";

// ---------------------------------------------------------------------------
// Media type mapper
// ---------------------------------------------------------------------------

function toMediaType(
  plan: Partial<OrchestratorPlan> | Partial<ClassificationResult>,
): MediaType {
  const category = (plan as any).category;
  const taskType = (plan as any).taskType;

  if (category === "music" || taskType === "music") return "music";
  if (
    category === "video" ||
    category === "advertisement" ||
    taskType === "video" ||
    taskType === "video_ad" ||
    taskType === "multimodal"
  ) {
    return "video";
  }
  return "image";
}

// ---------------------------------------------------------------------------
// Context prefix builder
// ---------------------------------------------------------------------------

function buildContextPrefix(
  plan: Partial<OrchestratorPlan> | Partial<ClassificationResult>,
): string {
  const parts: string[] = [];

  const style = (plan as any).style;
  const tone = (plan as any).tone;
  const complexity = (plan as any).complexity;

  if (style) parts.push(`[Style: ${style}]`);
  if (tone) parts.push(`[Tone: ${tone}]`);
  if (complexity) parts.push(`[Complexity: ${complexity}]`);

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enhances a user prompt using orchestrator context (style, tone, complexity).
 *
 * Returns just the enhanced prompt string.
 * Falls back to the original prompt trimmed if enhancement fails.
 */
export async function enhanceOrchestratorPrompt(
  originalPrompt: string,
  plan: Partial<OrchestratorPlan> | Partial<ClassificationResult>,
): Promise<string> {
  if (!originalPrompt?.trim()) return "";

  const prefix = buildContextPrefix(plan);
  const contextualPrompt = prefix
    ? `${prefix}\n${originalPrompt.trim()}`
    : originalPrompt.trim();

  const mediaType = toMediaType(plan);

  try {
    console.log(`[PromptEnhancer] Enhancing for mediaType="${mediaType}"`);
    const result = await enhancePrompt(contextualPrompt, { mediaType });
    console.log(`[PromptEnhancer] ✅ Enhanced via ${result.model}`);
    return result.enhancedPrompt;
  } catch (err: any) {
    // Non-fatal: return original prompt if enhancement fails
    console.warn(
      "[PromptEnhancer] ⚠️ Enhancement failed, using original:",
      err?.message,
    );
    return originalPrompt.trim();
  }
}
