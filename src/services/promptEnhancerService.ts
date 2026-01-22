import axios, { AxiosError } from 'axios';
import { env } from '../config/env';
import { generateGeminiTextResponse, PROMPT_ENHANCEMENT_SYSTEM_INSTRUCTION } from './genai/geminiTextService';
import { generateReplicateTextResponse } from './genai/replicateTextService';

// Get the prompt enhancer service URL from environment
function getPromptEnhancerUrl(): string {
  // Use env.promptEnhancerUrl which reads from NGROK_LANGUAGE or PROMPT_ENHANCER_URL
  const url = env.promptEnhancerUrl;

  if (!url) {
    throw new Error('PROMPT_ENHANCER_URL or NGROK_LANGUAGE environment variable is required');
  }

  return url.replace(/\/$/, ''); // Remove trailing slash
}

export type MediaType = 'image' | 'video' | 'music';

export interface EnhancePromptOptions {
  mediaType?: MediaType;
  maxLength?: number;
  targetModel?: string;
}

export interface EnhancePromptResult {
  enhancedPrompt: string;
  originalPrompt: string;
  mediaType: MediaType;
  model: string;
}

/**
 * Enhance a prompt using the local Python FastAPI prompt enhancer service
 */
export async function enhancePrompt(
  prompt: string,
  options?: EnhancePromptOptions
): Promise<EnhancePromptResult> {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Prompt is required');
  }

  const mediaType = options?.mediaType || 'image';
  const maxLength = options?.maxLength || 512;
  const targetModel = options?.targetModel;

  // 1. Try Replicate (GPT-5)
  // If targetModel is specified as gpt-5, we MUST use it (or fail/fallback to python, but skip gemini)
  // If targetModel is NOT specified, we prioritize Replicate if key exists.
  const shouldTryReplicate = env.replicateApiKey && (!targetModel || targetModel === 'openai/gpt-5');

  if (shouldTryReplicate) {
    try {
      console.log(`[Prompt Enhancer] Enhancing prompt using Replicate (GPT-5)`);
      const enhancedText = await generateReplicateTextResponse(prompt, {
        maxOutputTokens: maxLength,
        systemInstruction: PROMPT_ENHANCEMENT_SYSTEM_INSTRUCTION,
      });

      return {
        enhancedPrompt: enhancedText,
        originalPrompt: prompt,
        mediaType: mediaType,
        model: 'openai/gpt-5',
      };
    } catch (err) {
      console.error('[Prompt Enhancer] Replicate failed:', err);
      // If user specifically requested GPT-5, we might want to throw here or fallback to Python service?
      // So if Replicate fails, we should NOT use Gemini.
      if (targetModel === 'openai/gpt-5') {
        console.warn('[Prompt Enhancer] Skipping Gemini fallback because targetModel is openai/gpt-5');
      }
    }
  }

  // 2. Try Gemini
  // Only try Gemini if targetModel is NOT set or explicitly allows it (not implemented here, assuming default allows)
  // AND if targetModel is NOT 'openai/gpt-5' (unless Replicate failed and we want to fallback)
  const shouldTryGemini = !targetModel || targetModel !== 'openai/gpt-5';

  const hasGeminiKey =
    Boolean(
      env.googleGenAIApiKey ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.GENAI_API_KEY ||
      process.env.GEMINI_API_KEY
    );

  if (shouldTryGemini && hasGeminiKey) {
    try {
      console.log(`[Prompt Enhancer] Enhancing prompt using Gemini`);
      const enhancedText = await generateGeminiTextResponse(prompt, {
        maxOutputTokens: maxLength,
        systemInstruction: PROMPT_ENHANCEMENT_SYSTEM_INSTRUCTION,
        enableGoogleSearchTool: false,
        enableThinking: false,
      });

      return {
        enhancedPrompt: enhancedText,
        originalPrompt: prompt,
        mediaType: mediaType,
        model: 'gemini-1.5-pro',
      };
    } catch (err) {
      console.error('[Prompt Enhancer] Gemini failed, falling back:', err);
    }
  }

  // 3. Fallback to Python Service
  const baseUrl = getPromptEnhancerUrl();

  try {
    console.log(`[Prompt Enhancer] Enhancing prompt using Python Service for ${mediaType} generation`);

    const response = await axios.post(
      `${baseUrl}/enhance`,
      {
        prompt: prompt.trim(),
        media_type: mediaType,
        max_length: maxLength,
      },
      {
        timeout: 30000, // 30 second timeout
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const data = response.data;

    if (!data || typeof data.enhanced_prompt !== 'string') {
      console.error('[Prompt Enhancer] Invalid response structure:', data);
      throw new Error('Invalid response from prompt enhancer service');
    }

    console.log(`[Prompt Enhancer] Successfully enhanced prompt using ${data.model || 'Qwen2.5-7B'}`);

    return {
      enhancedPrompt: data.enhanced_prompt.trim(),
      originalPrompt: data.original_prompt || prompt,
      mediaType: data.media_type || mediaType,
      model: data.model || 'Qwen2.5-7B',
    };
  } catch (error: any) {
    const axiosError = error as AxiosError;

    if (axiosError.response) {
      // Server responded with error status
      const status = axiosError.response.status;
      const statusText = axiosError.response.statusText;
      const errorData = (axiosError.response.data as any)?.detail || axiosError.response.data;

      console.error(`[Prompt Enhancer] Service error (${status}):`, errorData);
      throw new Error(`Prompt enhancement failed: ${errorData || statusText}`);
    } else if (axiosError.request) {
      // Request was made but no response received
      console.error('[Prompt Enhancer] No response from service:', axiosError.message);
      throw new Error('Prompt enhancer service is unavailable. Please try again later.');
    } else {
      // Error setting up the request
      console.error('[Prompt Enhancer] Request setup error:', axiosError.message);
      throw new Error(`Failed to enhance prompt: ${axiosError.message}`);
    }
  }
}

/**
 * Enhance multiple prompts in batch
 */
export async function enhancePromptsBatch(
  prompts: Array<{ prompt: string; mediaType?: MediaType }>
): Promise<EnhancePromptResult[]> {
  if (!prompts || prompts.length === 0) {
    throw new Error('Prompts array is required and cannot be empty');
  }

  if (prompts.length > 10) {
    throw new Error('Maximum 10 prompts per batch request');
  }

  const baseUrl = getPromptEnhancerUrl();

  try {
    console.log(`[Prompt Enhancer] Enhancing ${prompts.length} prompts in batch`);

    const requests = prompts.map(({ prompt, mediaType = 'image' }) => ({
      prompt: prompt.trim(),
      media_type: mediaType,
    }));

    const response = await axios.post(
      `${baseUrl}/enhance/batch`,
      requests,
      {
        timeout: 60000, // 60 second timeout for batch
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const data = response.data;

    if (!data || !Array.isArray(data.results)) {
      console.error('[Prompt Enhancer] Invalid batch response structure:', data);
      throw new Error('Invalid response from prompt enhancer service');
    }

    const results: EnhancePromptResult[] = data.results.map((result: any) => ({
      enhancedPrompt: result.enhanced_prompt || result.original_prompt || '',
      originalPrompt: result.original_prompt || '',
      mediaType: result.media_type || 'image',
      model: data.model || 'Qwen2.5-7B',
    }));

    console.log(`[Prompt Enhancer] Successfully enhanced ${results.length} prompts`);

    return results;
  } catch (error: any) {
    const axiosError = error as AxiosError;

    if (axiosError.response) {
      const status = axiosError.response.status;
      const errorData = (axiosError.response.data as any)?.detail || axiosError.response.data;

      console.error(`[Prompt Enhancer] Batch service error (${status}):`, errorData);
      throw new Error(`Batch prompt enhancement failed: ${errorData || 'Unknown error'}`);
    } else if (axiosError.request) {
      console.error('[Prompt Enhancer] No response from batch service:', axiosError.message);
      throw new Error('Prompt enhancer service is unavailable. Please try again later.');
    } else {
      console.error('[Prompt Enhancer] Batch request setup error:', axiosError.message);
      throw new Error(`Failed to enhance prompts: ${axiosError.message}`);
    }
  }
}

export interface CanvasQueryResult {
  type: 'image' | 'video' | 'music' | 'answer';
  enhanced_prompt: string | null;
  response: string | null;
}

/**
 * Query canvas prompt enhancement endpoint
 * Calls the /canvas/query endpoint on the prompt enhancer service
 */
export async function queryCanvasPrompt(
  text: string,
  maxNewTokens?: number
): Promise<CanvasQueryResult> {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('Text is required');
  }

  // Use GPT-5 (Replicate) for chat
  const hasReplicateKey = Boolean(env.replicateApiKey);

  if (!hasReplicateKey) {
    console.error('[Canvas Query] ❌ Replicate API key missing');
    throw new Error('Replicate API key is required for chat. GPT-5 (ChatGPT 5) is the required model. Please configure REPLICATE_API_KEY.');
  }

  try {
    console.log('[Canvas Query] ✅ Using GPT-5 (ChatGPT 5) via Replicate for chat');
    const enhancedText = await generateReplicateTextResponse(text, {
      maxOutputTokens: maxNewTokens,
      systemInstruction: PROMPT_ENHANCEMENT_SYSTEM_INSTRUCTION,
    });

    console.log('[Canvas Query] ✅ GPT-5 response received successfully');
    return {
      type: 'answer',
      enhanced_prompt: enhancedText,
      response: enhancedText,
    };
  } catch (err: any) {
    console.error('[Canvas Query] ❌ GPT-5 (Replicate) failed:', {
      error: err?.message,
      stack: err?.stack,
      model: 'openai/gpt-5',
      hasReplicateKey: hasReplicateKey,
    });
    const errorMessage = err?.message || 'Unknown error';
    throw new Error(`Chat service unavailable: GPT-5 (ChatGPT 5 via Replicate) failed. ${errorMessage}. Please check your Replicate API key configuration and account credits.`);
  }
}

export async function generateScenesFromStory(story: string): Promise<any> {
  // Priority 1: Use Gemini (free, no credit issues)
  const hasGeminiKey =
    Boolean(
      env.googleGenAIApiKey ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.GENAI_API_KEY ||
      process.env.GEMINI_API_KEY
    );

  if (hasGeminiKey) {
    console.log('[Prompt Enhancer] Using Gemini for scene generation (free tier)');
    const { generateScenesFromStory: generateScenesGemini } = require('./genai/geminiTextService');
    return generateScenesGemini(story);
  }

  // Priority 2: Fall back to Replicate (GPT-5) if Gemini not available
  const hasReplicateKey = Boolean(env.replicateApiKey);

  if (hasReplicateKey) {
    console.warn('[Prompt Enhancer] Gemini key missing, falling back to Replicate for scene generation');
    const { generateScenesFromStory: generateScenesReplicate } = require('./genai/replicateTextService');
    return generateScenesReplicate(story);
  }

  throw new Error('Gemini API key (or Replicate fallback) required for scene generation');
}

export default { enhancePrompt, enhancePromptsBatch, queryCanvasPrompt, generateScenesFromStory };

