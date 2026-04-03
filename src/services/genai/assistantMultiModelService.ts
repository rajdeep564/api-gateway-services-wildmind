import Replicate from "replicate";
import { env } from "../../config/env";

export type ChatModeModelId =
  | "google/gemini-3.1-pro"
  | "anthropic/claude-opus-4.6"
  | "openai/gpt-5.2"
  | "deepseek-ai/deepseek-v3.1";

export interface AssistantConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantChatPricingParams {
  inputTokens: number;
  outputTokens: number;
}

export interface GeminiChatModeInput {
  audio?: string | null;
  images?: string[];
  videos?: string[];
  temperature?: number;
  top_p?: number;
  thinking_level?: "low" | "medium" | "high";
  max_output_tokens?: number;
  system_instruction?: string | null;
}

export interface ClaudeChatModeInput {
  image?: string | null;
  images?: string[];
  max_tokens?: number;
  system_prompt?: string | null;
  max_image_resolution?: number;
}

const APPROX_CHARS_PER_TOKEN = 4;
const GEMINI_DEFAULT_MAX_OUTPUT_TOKENS = 65535;
const GEMINI_MAX_IMAGES = 10;
const GEMINI_MAX_VIDEOS = 10;
const CLAUDE_DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const CLAUDE_MAX_IMAGES = 2;

let cachedReplicate: Replicate | null = null;

function getReplicateClient(): Replicate {
  if (cachedReplicate) return cachedReplicate;
  if (!env.replicateApiKey) throw new Error("REPLICATE_API_TOKEN is required");
  cachedReplicate = new Replicate({ auth: env.replicateApiKey });
  return cachedReplicate;
}

function normalizeReplicateOutput(output: unknown): string {
  if (Array.isArray(output)) {
    return output
      .map((x) => String(x ?? ""))
      .join("")
      .trim();
  }
  return String(output ?? "").trim();
}

export function buildPromptWithHistory(
  message: string,
  history: AssistantConversationMessage[],
): string {
  const serializedHistory = history
    .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`)
    .join("\n");

  return serializedHistory ? `${serializedHistory}\nUser: ${message}` : message;
}

export function estimateTextTokens(text: string): number {
  const normalized = (text || "").trim();
  if (!normalized) return 1;
  return Math.max(1, Math.ceil(normalized.length / APPROX_CHARS_PER_TOKEN));
}

export function getAssistantChatValidationPricingParams(
  modelId: ChatModeModelId,
  message: string,
  history: AssistantConversationMessage[],
  geminiInput?: GeminiChatModeInput,
): AssistantChatPricingParams | undefined {
  switch (modelId) {
    case "google/gemini-3.1-pro":
      return {
        inputTokens: estimateTextTokens(
          buildPromptWithHistory(message, history),
        ),
        outputTokens:
          geminiInput?.max_output_tokens ?? GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
      };
    case "anthropic/claude-opus-4.6":
      return {
        inputTokens: estimateTextTokens(
          buildPromptWithHistory(message, history),
        ),
        outputTokens: CLAUDE_DEFAULT_MAX_OUTPUT_TOKENS,
      };
    default:
      return undefined;
  }
}

export function getAssistantChatFinalPricingParams(
  modelId: ChatModeModelId,
  message: string,
  history: AssistantConversationMessage[],
  reply: string,
  geminiInput?: GeminiChatModeInput,
): AssistantChatPricingParams | undefined {
  switch (modelId) {
    case "google/gemini-3.1-pro":
      return {
        inputTokens: estimateTextTokens(
          buildPromptWithHistory(message, history),
        ),
        outputTokens: Math.min(
          geminiInput?.max_output_tokens ?? GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
          estimateTextTokens(reply),
        ),
      };
    case "anthropic/claude-opus-4.6":
      return {
        inputTokens: estimateTextTokens(
          buildPromptWithHistory(message, history),
        ),
        outputTokens: Math.min(
          CLAUDE_DEFAULT_MAX_OUTPUT_TOKENS,
          estimateTextTokens(reply),
        ),
      };
    default:
      return undefined;
  }
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function sanitizeUriList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .slice(0, limit);
}

function buildGeminiInput(
  prompt: string,
  geminiInput?: GeminiChatModeInput,
  systemPrompt?: string,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt,
    images: sanitizeUriList(geminiInput?.images, GEMINI_MAX_IMAGES),
    videos: sanitizeUriList(geminiInput?.videos, GEMINI_MAX_VIDEOS),
    thinking_level: geminiInput?.thinking_level ?? "high",
    temperature: clampNumber(geminiInput?.temperature, 0, 2, 1),
    top_p: clampNumber(geminiInput?.top_p, 0, 1, 0.95),
    max_output_tokens: Math.round(
      clampNumber(
        geminiInput?.max_output_tokens,
        1,
        65535,
        GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
      ),
    ),
  };

  if (typeof geminiInput?.audio === "string" && geminiInput.audio.trim()) {
    input.audio = geminiInput.audio.trim();
  }

  const systemInstruction = geminiInput?.system_instruction ?? systemPrompt;
  if (typeof systemInstruction === "string" && systemInstruction.trim()) {
    input.system_instruction = systemInstruction.trim();
  }

  return input;
}

function buildClaudeInput(
  prompt: string,
  claudeInput?: ClaudeChatModeInput,
  systemPrompt?: string,
): Record<string, unknown> {
  const imageUrls = sanitizeUriList(claudeInput?.images, CLAUDE_MAX_IMAGES);
  const primaryImage =
    typeof claudeInput?.image === "string" && claudeInput.image.trim()
      ? claudeInput.image.trim()
      : imageUrls[0];
  const extraImages = primaryImage
    ? imageUrls
        .filter((url) => url !== primaryImage)
        .slice(0, CLAUDE_MAX_IMAGES - 1)
    : imageUrls.slice(1, CLAUDE_MAX_IMAGES);

  let promptWithImageContext = prompt;
  if (extraImages.length > 0) {
    promptWithImageContext = `${prompt}\n\nAdditional image context URLs:\n${extraImages.map((url, index) => `${index + 1}. ${url}`).join("\n")}`;
  }

  const input: Record<string, unknown> = {
    prompt: promptWithImageContext,
    max_tokens: Math.round(
      clampNumber(
        claudeInput?.max_tokens,
        1024,
        128000,
        CLAUDE_DEFAULT_MAX_OUTPUT_TOKENS,
      ),
    ),
    max_image_resolution: clampNumber(
      claudeInput?.max_image_resolution,
      0.001,
      2,
      0.5,
    ),
  };

  if (primaryImage) {
    input.image = primaryImage;
  }

  const resolvedSystemPrompt = claudeInput?.system_prompt ?? systemPrompt;
  if (typeof resolvedSystemPrompt === "string" && resolvedSystemPrompt.trim()) {
    input.system_prompt = resolvedSystemPrompt.trim();
  }

  return input;
}

export async function generateAssistantChatModeResponse(params: {
  modelId: ChatModeModelId;
  message: string;
  history: AssistantConversationMessage[];
  systemPrompt?: string;
  geminiInput?: GeminiChatModeInput;
  claudeInput?: ClaudeChatModeInput;
}): Promise<string> {
  const { modelId, message, history, systemPrompt, geminiInput, claudeInput } =
    params;
  const replicate = getReplicateClient();
  const promptWithHistory = buildPromptWithHistory(message, history);

  let input: Record<string, unknown>;

  switch (modelId) {
    case "google/gemini-3.1-pro":
      input = buildGeminiInput(promptWithHistory, geminiInput, systemPrompt);
      break;
    case "anthropic/claude-opus-4.6":
      input = buildClaudeInput(promptWithHistory, claudeInput, systemPrompt);
      break;
    case "openai/gpt-5.2":
      input = {
        messages: [
          ...history.map((h) => ({ role: h.role, content: h.content })),
          { role: "user", content: message },
        ],
        reasoning_effort: "low",
        verbosity: "low",
        max_completion_tokens: 300,
      };
      if (systemPrompt) {
        input.messages = [
          { role: "system", content: systemPrompt },
          ...history.map((h) => ({ role: h.role, content: h.content })),
          { role: "user", content: message },
        ];
      }
      break;
    case "deepseek-ai/deepseek-v3.1":
      input = {
        prompt: promptWithHistory,
        thinking: "None",
        max_tokens: 1024,
        temperature: 0.2,
        top_p: 1,
        presence_penalty: 0,
        frequency_penalty: 0,
      };
      break;
    default:
      throw new Error(`Unsupported modelId: ${modelId}`);
  }

  const output = await replicate.run(modelId, { input });
  return normalizeReplicateOutput(output);
}
