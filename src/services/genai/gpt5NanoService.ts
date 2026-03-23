/**
 * WildMind — GPT-5 via Replicate
 *
 * Exposes two model tiers, both accessed through Replicate (no OpenAI API key needed):
 *
 *   GPT_5_MODEL      = "openai/gpt-5"        ← full GPT-5, for planning / reasoning
 *   GPT_5_NANO_MODEL = "openai/gpt-5-nano"   ← nano, for classification / chat
 *
 * The primary export `generateReplicateLLMResponse` accepts a `model` parameter.
 * Legacy `generateGpt5NanoResponse` is kept for backward compatibility.
 */

import Replicate from 'replicate';
import { env } from '../../config/env';

// ── Model IDs on Replicate ────────────────────────────────────────────────────
export const GPT_5_MODEL      = 'openai/gpt-5' as const;
export const GPT_5_NANO_MODEL = 'openai/gpt-5-nano' as const;

export type ReplicateGPTModel = typeof GPT_5_MODEL | typeof GPT_5_NANO_MODEL;

// ── Replicate singleton ───────────────────────────────────────────────────────
let _replicate: Replicate | null = null;

function getReplicateClient(): Replicate {
    if (_replicate) return _replicate;
    const auth = env.replicateApiKey;
    if (!auth) throw new Error('REPLICATE_API_TOKEN is required');
    _replicate = new Replicate({ auth });
    return _replicate;
}

// ── Shared types ──────────────────────────────────────────────────────────────
export interface Gpt5NanoChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface ReplicateLLMOptions {
    /** System prompt prepended to the conversation */
    systemPrompt?: string;
    /** Prior conversation turns (for multi-turn chat) */
    messages?: Gpt5NanoChatMessage[];
    /** Controls response verbosity on the model side */
    verbosity?: 'low' | 'medium' | 'high';
    /** Controls chain-of-thought depth */
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
    /** Hard token limit for the response */
    maxCompletionTokens?: number;
}

// Keep old name as alias for backward compat
export type Gpt5NanoOptions = ReplicateLLMOptions;

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Call any Replicate-hosted GPT-5 model (gpt-5 or gpt-5-nano).
 *
 * @param userMessage  The latest user turn
 * @param options      System prompt, history, token limits, etc.
 * @param model        Which model to use. Defaults to GPT_5_MODEL (full GPT-5).
 */
export async function generateReplicateLLMResponse(
    userMessage: string,
    options: ReplicateLLMOptions = {},
    model: ReplicateGPTModel = GPT_5_MODEL,
): Promise<string> {
    if (!userMessage?.trim()) throw new Error('userMessage must be a non-empty string');

    const replicate = getReplicateClient();

    // Build ordered messages array
    const messages: Gpt5NanoChatMessage[] = [];

    if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
    }
    if (options.messages && options.messages.length > 0) {
        messages.push(...options.messages);
    }
    messages.push({ role: 'user', content: userMessage.trim() });

    const input: Record<string, any> = {
        messages,
        verbosity: options.verbosity ?? 'medium',
        reasoning_effort: options.reasoningEffort ?? 'minimal',
    };

    if (options.maxCompletionTokens) {
        input.max_completion_tokens = options.maxCompletionTokens;
    }

    console.log(`[ReplicateLLM] Calling ${model} via Replicate`, {
        messageCount: messages.length,
        verbosity: input.verbosity,
        reasoningEffort: input.reasoning_effort,
        maxTokens: input.max_completion_tokens ?? 'unlimited',
    });

    try {
        const output = await replicate.run(model, { input });
        const text = Array.isArray(output) ? output.join('') : String(output ?? '');

        console.log(`[ReplicateLLM] ✅ ${model} responded`, { length: text.length });
        return text.trim();
    } catch (error: any) {
        console.error(`[ReplicateLLM] ❌ ${model} failed:`, error?.message);
        throw new Error(`Replicate LLM (${model}) failed: ${error?.message || 'Unknown error'}`);
    }
}

// ── Legacy wrapper — backward compatible ──────────────────────────────────────

/**
 * @deprecated Use generateReplicateLLMResponse with GPT_5_NANO_MODEL instead.
 * Kept for backward compatibility with chatAssistant.ts and other callers.
 */
export async function generateGpt5NanoResponse(
    userMessage: string,
    options: Gpt5NanoOptions = {},
): Promise<string> {
    return generateReplicateLLMResponse(userMessage, options, GPT_5_NANO_MODEL);
}
