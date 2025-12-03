import Replicate from 'replicate';
import { env } from '../../config/env';
import { PROMPT_ENHANCEMENT_SYSTEM_INSTRUCTION, STORYBOARD_SYSTEM_INSTRUCTION } from './geminiTextService';

const REPLICATE_MODEL = 'openai/gpt-4o';

let cachedReplicate: Replicate | null = null;

function getReplicateClient(): Replicate {
    if (cachedReplicate) return cachedReplicate;

    const auth = env.replicateApiKey;

    if (!auth) {
        throw new Error('REPLICATE_API_TOKEN is required to use Replicate text generation');
    }

    cachedReplicate = new Replicate({
        auth,
    });

    return cachedReplicate;
}

/**
 * Calls Replicate's GPT-4o model and returns the response text.
 */
export async function generateReplicateTextResponse(
    prompt: string,
    options?: {
        maxOutputTokens?: number;
        systemInstruction?: string;
    }
): Promise<string> {
    if (!prompt || !prompt.trim()) {
        throw new Error('Prompt must be a non-empty string');
    }

    const replicate = getReplicateClient();

    const systemPrompt = options?.systemInstruction || STORYBOARD_SYSTEM_INSTRUCTION;

    console.log('[ReplicateTextService] Starting text generation', {
        model: REPLICATE_MODEL,
        promptPreview: prompt.trim().slice(0, 120),
        maxOutputTokens: options?.maxOutputTokens,
    });

    const input = {
        prompt: prompt.trim(),
        system_prompt: systemPrompt,
        max_tokens: options?.maxOutputTokens || 1024,
    };

    try {
        const output = await replicate.run(REPLICATE_MODEL, { input });

        // Replicate returns an array of strings for streaming models, or a string
        const responseText = Array.isArray(output) ? output.join('') : String(output);

        console.log('[ReplicateTextService] Completed text generation', {
            totalLength: responseText.length,
        });

        return responseText;
    } catch (error: any) {
        console.error('[ReplicateTextService] Error generating text:', error);
        throw new Error(`Replicate text generation failed: ${error.message || 'Unknown error'}`);
    }
}
