/**
 * Model Gateway — single abstraction over LLM (and later generation) calls.
 * Planner, OpenClaw, and requirement extractor should call the gateway.
 * Responsibilities: delegate to provider, log usage (no full prompt), cost tracking.
 */

import { generateReplicateLLMResponse, type ReplicateLLMOptions, type ReplicateGPTModel } from "../services/genai/gpt5NanoService";
import { generateGeminiTextResponse } from "../services/genai/geminiTextService";
import { safePromptMeta } from "../utils/safePromptLog";
import { logAiUsage } from "./aiUsageLogs";
import { isAllowedLLMModel } from "./modelRegistry";

export interface GatewayLLMOptions extends ReplicateLLMOptions {
  userId?: string;
  requestId?: string;
  /** AI governance: prompt template version for audit (e.g. "PLANNER=1.0") */
  promptTemplateVersion?: string;
}

export interface GatewayGeminiOptions {
  systemInstruction?: string;
  maxOutputTokens?: number;
  enableThinking?: boolean;
  enableGoogleSearchTool?: boolean;
  userId?: string;
  requestId?: string;
  promptTemplateVersion?: string;
}

const GEMINI_MODEL_ID = "gemini-1.5-pro";

/**
 * Complete text via LLM (Replicate) through the gateway. Logs usage to ai_usage_logs.
 */
export async function completeText(
  prompt: string,
  options: GatewayLLMOptions,
  model: ReplicateGPTModel = "openai/gpt-5-nano" as ReplicateGPTModel
): Promise<string> {
  if (!isAllowedLLMModel(model as string)) {
    throw new Error(`[ModelGateway] LLM model "${model}" is not in the allowed registry. Allowed: ${["openai/gpt-5", "openai/gpt-5-nano"].join(", ")}.`);
  }
  const result = await generateReplicateLLMResponse(prompt, options, model);
  logAiUsage({
    userId: options.userId ?? "system",
    requestId: options.requestId ?? "",
    provider: "replicate",
    model,
    inputTokens: undefined,
    outputTokens: undefined,
    cost: undefined,
    promptTemplateVersion: options.promptTemplateVersion,
  });
  return result;
}

/**
 * Complete text via Gemini through the gateway. Logs usage to ai_usage_logs.
 */
export async function completeTextGemini(
  prompt: string,
  options: GatewayGeminiOptions = {}
): Promise<string> {
  const result = await generateGeminiTextResponse(prompt, {
    systemInstruction: options.systemInstruction,
    maxOutputTokens: options.maxOutputTokens,
    enableThinking: options.enableThinking,
    enableGoogleSearchTool: options.enableGoogleSearchTool,
  });
  logAiUsage({
    userId: options.userId ?? "system",
    requestId: options.requestId ?? "",
    provider: "google",
    model: GEMINI_MODEL_ID,
    inputTokens: undefined,
    outputTokens: undefined,
    cost: undefined,
    promptTemplateVersion: options.promptTemplateVersion,
  });
  return result;
}
