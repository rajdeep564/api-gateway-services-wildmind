import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env";

// Get API key
function getApiKey(): string {
  const key = 
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GENAI_API_KEY ||
    env.googleGenAIApiKey || 
    "";
  
  if (!key) {
    throw new Error("GOOGLE_GENAI_API_KEY not configured");
  }
  
  return key;
}

// Use gemini-3-pro-preview as the default model for prompt enhancement
const DEFAULT_MODEL = "gemini-3-pro-preview";
// Increased max tokens to handle thinking mode and longer enhanced prompts
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.DEFAULT_GENAI_MAX_TOKENS || "512");
const DEFAULT_TEMPERATURE = Number(process.env.DEFAULT_GENAI_TEMPERATURE || "0.6");

export async function enhancePrompt(
  prompt: string,
  model?: string,
  options?: { maxOutputTokens?: number; temperature?: number }
) {
  if (!prompt.trim()) {
    throw new Error("Prompt required");
  }

  const apiKey = getApiKey();
  // CRITICAL: Always use gemini-3-pro-preview for text-to-text prompt enhancement
  // The model parameter from frontend is for image generation context only
  // We ignore it and always use the text model for enhancement
  const modelToUse = DEFAULT_MODEL; // Always use gemini-3-pro-preview, ignore input model
  const maxOutputTokens = options?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const temperature = options?.temperature ?? DEFAULT_TEMPERATURE;

  // Build the enhancement instruction
  const instruction = `
Improve the following prompt for AI image generation.
Add artistic detail, styling, lighting, clarity, realism, composition hints.
Respond ONLY with the enhanced prompt.

User prompt:
${prompt}
`.trim();

  try {
    // Initialize the Google GenAI SDK - using exact pattern from user's example
    // API key can be passed in constructor or will use environment variable
    const ai = new GoogleGenAI({ apiKey });

    // Single call to generateContent - using exact pattern from user's example
    // No config object - using defaults
    const response = await ai.models.generateContent({
      model: modelToUse,
      contents: instruction,
    });

    // Extract the text from the response
    // The SDK response structure may vary, so we check multiple possible locations
    let enhancedPrompt = "";
    const responseAny = response as any;
    
    // Log the full response structure for debugging
    console.log("[Gemini Service] Response structure:", {
      hasText: !!responseAny.text,
      hasResponse: !!responseAny.response,
      hasCandidates: !!responseAny.candidates,
      responseType: typeof response,
      responseKeys: Object.keys(response || {}),
    });
    
    // Check if response was truncated due to MAX_TOKENS
    const candidate = responseAny.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') {
      console.warn("[Gemini Service] Response was truncated due to MAX_TOKENS limit. Consider increasing maxOutputTokens.");
    }
    
    // Try different response structures
    // First, check if there's a direct text property or method
    if (responseAny.text) {
      enhancedPrompt = String(responseAny.text).trim();
    } else if (typeof responseAny.text === 'function') {
      enhancedPrompt = String(responseAny.text()).trim();
    } else if (responseAny.response?.text) {
      enhancedPrompt = String(responseAny.response.text).trim();
    } else if (typeof responseAny.response?.text === 'function') {
      enhancedPrompt = String(responseAny.response.text()).trim();
    } 
    // Check candidates array for content parts
    else if (Array.isArray(responseAny.candidates) && responseAny.candidates.length > 0 && candidate) {
      // Check if content has parts array
      if (candidate.content?.parts && Array.isArray(candidate.content.parts)) {
        // Find text in parts array
        for (const part of candidate.content.parts) {
          if (part.text) {
            enhancedPrompt = String(part.text).trim();
            break;
          }
        }
      }
      // If no parts but content exists, try accessing content directly
      else if (candidate.content && typeof candidate.content === 'object') {
        // Check if content has text property directly
        if (candidate.content.text) {
          enhancedPrompt = String(candidate.content.text).trim();
        }
      }
    }

    if (!enhancedPrompt) {
      // Check if response was truncated
      const finishReason = candidate?.finishReason;
      if (finishReason === 'MAX_TOKENS') {
        console.error("[Gemini Service] Response truncated at MAX_TOKENS. Thinking tokens consumed most of the budget.");
        // Return original prompt as fallback when response is truncated
        console.warn("[Gemini Service] Returning original prompt as fallback due to token limit");
        return {
          enhancedPrompt: prompt, // Return original prompt if enhancement fails
          raw: response,
          model: modelToUse,
          sdk: true,
        };
      }
      
      // Log the full response for debugging
      console.error("[Gemini Service] Empty response - full response structure:", JSON.stringify(response, null, 2).substring(0, 1000));
      throw new Error("Empty response from Gemini API - no text found in response");
    }

    console.log(`[Gemini Service] Successfully enhanced prompt using ${modelToUse}`);

    return {
      enhancedPrompt,
      raw: response,
      model: modelToUse,
      sdk: true,
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const statusCode = error?.status || error?.response?.status;
    console.error(`[Gemini Service] Failed to enhance prompt with ${modelToUse}:`, {
      error: errorMessage,
      status: statusCode,
    });
    throw new Error(`Prompt enhancement failed: ${errorMessage}`);
  }
}

export default { enhancePrompt };
