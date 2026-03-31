import Replicate from 'replicate';
import { env } from '../../config/env';

export type ChatModeModelId =
    | 'google/gemini-3.1-pro'
    | 'anthropic/claude-opus-4.6'
    | 'openai/gpt-5.2'
    | 'deepseek-ai/deepseek-v3.1';

export interface AssistantConversationMessage {
    role: 'user' | 'assistant';
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
    thinking_level?: 'low' | 'medium' | 'high';
    max_output_tokens?: number;
    system_instruction?: string | null;
}

const APPROX_CHARS_PER_TOKEN = 4;
const GEMINI_DEFAULT_MAX_OUTPUT_TOKENS = 65535;
const GEMINI_MAX_IMAGES = 10;
const GEMINI_MAX_VIDEOS = 10;

let cachedReplicate: Replicate | null = null;

function getReplicateClient(): Replicate {
    if (cachedReplicate) return cachedReplicate;
    if (!env.replicateApiKey) throw new Error('REPLICATE_API_TOKEN is required');
    cachedReplicate = new Replicate({ auth: env.replicateApiKey });
    return cachedReplicate;
}

function normalizeReplicateOutput(output: unknown): string {
    if (Array.isArray(output)) {
        return output.map((x) => String(x ?? '')).join('').trim();
    }
    return String(output ?? '').trim();
}

export function buildPromptWithHistory(message: string, history: AssistantConversationMessage[]): string {
    const serializedHistory = history
        .map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`)
        .join('\n');

    return serializedHistory
        ? `${serializedHistory}\nUser: ${message}`
        : message;
}

export function estimateTextTokens(text: string): number {
    const normalized = (text || '').trim();
    if (!normalized) return 1;
    return Math.max(1, Math.ceil(normalized.length / APPROX_CHARS_PER_TOKEN));
}

export function getAssistantChatValidationPricingParams(
    modelId: ChatModeModelId,
    message: string,
    history: AssistantConversationMessage[],
    geminiInput?: GeminiChatModeInput
): AssistantChatPricingParams | undefined {
    switch (modelId) {
        case 'google/gemini-3.1-pro':
            return {
                inputTokens: estimateTextTokens(buildPromptWithHistory(message, history)),
                outputTokens: geminiInput?.max_output_tokens ?? GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
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
    geminiInput?: GeminiChatModeInput
): AssistantChatPricingParams | undefined {
    switch (modelId) {
        case 'google/gemini-3.1-pro':
            return {
                inputTokens: estimateTextTokens(buildPromptWithHistory(message, history)),
                outputTokens: Math.min(geminiInput?.max_output_tokens ?? GEMINI_DEFAULT_MAX_OUTPUT_TOKENS, estimateTextTokens(reply)),
            };
        default:
            return undefined;
    }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
}

function sanitizeUriList(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === 'string' && !!item.trim())
        .slice(0, limit);
}

function buildGeminiInput(
    prompt: string,
    geminiInput?: GeminiChatModeInput,
    systemPrompt?: string
): Record<string, unknown> {
    const input: Record<string, unknown> = {
        prompt,
        images: sanitizeUriList(geminiInput?.images, GEMINI_MAX_IMAGES),
        videos: sanitizeUriList(geminiInput?.videos, GEMINI_MAX_VIDEOS),
        thinking_level: geminiInput?.thinking_level ?? 'high',
        temperature: clampNumber(geminiInput?.temperature, 0, 2, 1),
        top_p: clampNumber(geminiInput?.top_p, 0, 1, 0.95),
        max_output_tokens: Math.round(clampNumber(geminiInput?.max_output_tokens, 1, 65535, GEMINI_DEFAULT_MAX_OUTPUT_TOKENS)),
    };

    if (typeof geminiInput?.audio === 'string' && geminiInput.audio.trim()) {
        input.audio = geminiInput.audio.trim();
    }

    const systemInstruction = geminiInput?.system_instruction ?? systemPrompt;
    if (typeof systemInstruction === 'string' && systemInstruction.trim()) {
        input.system_instruction = systemInstruction.trim();
    }

    return input;
}

export async function generateAssistantChatModeResponse(params: {
    modelId: ChatModeModelId;
    message: string;
    history: AssistantConversationMessage[];
    systemPrompt?: string;
    geminiInput?: GeminiChatModeInput;
}): Promise<string> {
    const { modelId, message, history, systemPrompt, geminiInput } = params;
    const replicate = getReplicateClient();
    const promptWithHistory = buildPromptWithHistory(message, history);

    let input: Record<string, unknown>;

    switch (modelId) {
        case 'google/gemini-3.1-pro':
            input = buildGeminiInput(promptWithHistory, geminiInput, systemPrompt);
            break;
        case 'anthropic/claude-opus-4.6':
            input = {
                prompt: promptWithHistory,
                max_tokens: 1200,
                max_image_resolution: 0.5,
            };
            if (systemPrompt) {
                input.system_prompt = systemPrompt;
            }
            break;
        case 'openai/gpt-5.2':
            input = {
                messages: [
                    ...history.map((h) => ({ role: h.role, content: h.content })),
                    { role: 'user', content: message },
                ],
                reasoning_effort: 'low',
                verbosity: 'low',
                max_completion_tokens: 300,
            };
            if (systemPrompt) {
                input.messages = [
                    { role: 'system', content: systemPrompt },
                    ...history.map((h) => ({ role: h.role, content: h.content })),
                    { role: 'user', content: message },
                ];
            }
            break;
        case 'deepseek-ai/deepseek-v3.1':
            input = {
                prompt: promptWithHistory,
                thinking: 'None',
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
