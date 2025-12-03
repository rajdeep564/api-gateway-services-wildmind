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

  // 1. Try Replicate (GPT-4o)
  // If targetModel is specified as gpt-4o, we MUST use it (or fail/fallback to python, but skip gemini)
  // If targetModel is NOT specified, we prioritize Replicate if key exists.
  const shouldTryReplicate = env.replicateApiKey && (!targetModel || targetModel === 'openai/gpt-4o');

  if (shouldTryReplicate) {
    try {
      console.log(`[Prompt Enhancer] Enhancing prompt using Replicate (GPT-4o)`);
      const enhancedText = await generateReplicateTextResponse(prompt, {
        maxOutputTokens: maxLength,
        systemInstruction: PROMPT_ENHANCEMENT_SYSTEM_INSTRUCTION,
      });

      return {
        enhancedPrompt: enhancedText,
        originalPrompt: prompt,
        mediaType: mediaType,
        model: 'openai/gpt-4o',
      };
    } catch (err) {
      console.error('[Prompt Enhancer] Replicate failed:', err);
      // If user specifically requested GPT-4o, we might want to throw here or fallback to Python service?
      // User said "only use gpt-4o not gemini in just frontend of wild".
      // So if Replicate fails, we should NOT use Gemini.
      if (targetModel === 'openai/gpt-4o') {
        console.warn('[Prompt Enhancer] Skipping Gemini fallback because targetModel is openai/gpt-4o');
      }
    }
  }

  // 2. Try Gemini
  // Only try Gemini if targetModel is NOT set or explicitly allows it (not implemented here, assuming default allows)
  // AND if targetModel is NOT 'openai/gpt-4o' (unless Replicate failed and we want to fallback? User said "not gemini")
  const shouldTryGemini = !targetModel || targetModel !== 'openai/gpt-4o';

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

  // Prioritize Replicate (GPT-4o) if available
  if (env.replicateApiKey) {
    try {
      const enhancedText = await generateReplicateTextResponse(text, {
        maxOutputTokens: maxNewTokens,
        systemInstruction: PROMPT_ENHANCEMENT_SYSTEM_INSTRUCTION,
      });

      return {
        type: 'answer',
        enhanced_prompt: enhancedText,
        response: enhancedText,
      };
    } catch (err) {
      console.error('[Canvas Query] Replicate integration failed, falling back to Gemini:', err);
      // Fallback to Gemini
    }
  }

  const hasGeminiKey =
    Boolean(
      env.googleGenAIApiKey ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.GENAI_API_KEY ||
      process.env.GEMINI_API_KEY
    );

  if (hasGeminiKey) {
    try {
      const enhancedText = await generateGeminiTextResponse(text, {
        maxOutputTokens: maxNewTokens,
        systemInstruction: PROMPT_ENHANCEMENT_SYSTEM_INSTRUCTION,
        enableGoogleSearchTool: false,
        enableThinking: false,
      });

      return {
        type: 'answer',
        enhanced_prompt: enhancedText,
        response: enhancedText,
      };
    } catch (err) {
      console.error('[Canvas Query] Gemini integration failed, falling back to prompt enhancer service if available:', err);
      if (!env.promptEnhancerUrl) {
        throw err;
      }
      // otherwise fall through to original service as backup
    }
  }

  const baseUrl = getPromptEnhancerUrl();
  const maxTokens = maxNewTokens || 300;

  try {
    console.log(`[Canvas Query] Querying prompt enhancement for text: "${text.substring(0, 50)}..."`);

    const response = await axios.post(
      `${baseUrl}/canvas/query`,
      {
        text: text.trim(),
        max_new_tokens: maxTokens,
      },
      {
        timeout: 120000, // 120 second timeout (2 minutes) - increased for storyboard generation
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const data = response.data;

    if (!data || typeof data.type !== 'string') {
      console.error('[Canvas Query] Invalid response structure:', data);
      throw new Error('Invalid response from canvas query service');
    }

    // Validate type
    if (!['image', 'video', 'music', 'answer'].includes(data.type)) {
      console.error('[Canvas Query] Invalid type in response:', data.type);
      throw new Error('Invalid response type from canvas query service');
    }

    console.log(`[Canvas Query] Successfully processed query, type: ${data.type}`);

    return {
      type: data.type,
      enhanced_prompt: data.enhanced_prompt || null,
      response: data.response || null,
    };
  } catch (error: any) {
    const axiosError = error as AxiosError;

    if (axiosError.response) {
      // Server responded with error status
      const status = axiosError.response.status;
      const statusText = axiosError.response.statusText;
      const errorData = (axiosError.response.data as any)?.detail || axiosError.response.data;

      console.error(`[Canvas Query] Service error (${status}):`, errorData);
      throw new Error(`Canvas query failed: ${errorData || statusText}`);
    } else if (axiosError.request) {
      // Request was made but no response received
      console.error('[Canvas Query] No response from service:', axiosError.message);
      throw new Error('Canvas query service is unavailable. Please try again later.');
    } else {
      // Error setting up the request
      console.error('[Canvas Query] Request setup error:', axiosError.message);
      throw new Error(`Failed to query canvas prompt: ${axiosError.message}`);
    }
  }
}

export async function generateScenesFromStory(story: string): Promise<any> {
  const hasGeminiKey =
    Boolean(
      env.googleGenAIApiKey ||
      process.env.GOOGLE_GENAI_API_KEY ||
      process.env.GENAI_API_KEY ||
      process.env.GEMINI_API_KEY
    );

  if (hasGeminiKey) {
    // Use local Gemini service
    const { generateScenesFromStory: generateScenesGemini } = require('./genai/geminiTextService');
    return generateScenesGemini(story);
  }

  // Fallback to Python service if needed (not implemented yet, but keeping structure)
  throw new Error('Gemini API key required for scene generation');
}

export default { enhancePrompt, enhancePromptsBatch, queryCanvasPrompt, generateScenesFromStory };

