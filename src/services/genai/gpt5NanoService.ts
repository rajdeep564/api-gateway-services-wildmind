import Replicate from 'replicate';
import { env } from '../../config/env';

const GPT5_NANO_MODEL = 'openai/gpt-5-nano';

let cachedReplicate: Replicate | null = null;

function getReplicateClient(): Replicate {
    if (cachedReplicate) return cachedReplicate;
    const auth = env.replicateApiKey;
    if (!auth) throw new Error('REPLICATE_API_TOKEN is required');
    cachedReplicate = new Replicate({ auth });
    return cachedReplicate;
}

export interface Gpt5NanoChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface Gpt5NanoOptions {
    systemPrompt?: string;
    messages?: Gpt5NanoChatMessage[];
    verbosity?: 'low' | 'medium' | 'high';
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
    maxCompletionTokens?: number;
}

/**
 * Calls GPT-5 Nano via Replicate using the messages array format for
 * proper multi-turn conversation support.
 *
 * Input schema reference:
 *   - messages: [{role, content}] — preferred for conversation
 *   - verbosity: "low" | "medium" | "high"  (default "medium")
 *   - reasoning_effort: "minimal" | "low" | "medium" | "high"  (default "minimal")
 *   - max_completion_tokens: integer (optional)
 * Output: array of strings (concatenated = full response)
 */
export async function generateGpt5NanoResponse(
    userMessage: string,
    options: Gpt5NanoOptions = {}
): Promise<string> {
    if (!userMessage?.trim()) throw new Error('userMessage must be a non-empty string');

    const replicate = getReplicateClient();

    // Build the messages array
    const messages: Gpt5NanoChatMessage[] = [];

    if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
    }

    // Append any prior conversation turns
    if (options.messages && options.messages.length > 0) {
        messages.push(...options.messages);
    }

    // Append the new user message
    messages.push({ role: 'user', content: userMessage.trim() });

    const input: Record<string, any> = {
        messages,
        verbosity: options.verbosity ?? 'medium',
        reasoning_effort: options.reasoningEffort ?? 'minimal',
    };

    if (options.maxCompletionTokens) {
        input.max_completion_tokens = options.maxCompletionTokens;
    }

    console.log('[Gpt5NanoService] Calling GPT-5 Nano via Replicate', {
        model: GPT5_NANO_MODEL,
        messageCount: messages.length,
        verbosity: input.verbosity,
        reasoningEffort: input.reasoning_effort,
    });

    try {
        const output = await replicate.run(GPT5_NANO_MODEL, { input });
        const text = Array.isArray(output) ? output.join('') : String(output ?? '');

        console.log('[Gpt5NanoService] ✅ Response received', { length: text.length });
        return text.trim();
    } catch (error: any) {
        console.error('[Gpt5NanoService] ❌ Failed:', error?.message);
        throw new Error(`GPT-5 Nano generation failed: ${error?.message || 'Unknown error'}`);
    }
}
