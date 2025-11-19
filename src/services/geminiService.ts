import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env";

// Lazy function to get API key
function getApiKey(): string {
  const key = 
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GENAI_API_KEY ||
    env.googleGenAIApiKey || 
    "";
  
  if (process.env.NODE_ENV !== 'production' && !key) {
    console.warn('[Gemini Service] API key not found.');
  }
  
  return key;
}

// UPDATED: Use specific version 'gemini-1.5-flash-002' or generic 'gemini-1.5-flash'
// Avoid '-latest' as it is deprecated and causes 404s.
const DEFAULT_MODEL = process.env.DEFAULT_GENAI_MODEL || "gemini-1.5-flash-002";

// Fallback models - strictly valid, officially supported identifiers
const FALLBACK_MODELS: string[] = [
  "gemini-1.5-flash",     // Generic alias for stable flash
  "gemini-1.5-flash-002", // Specific stable version
  "gemini-1.5-pro",       // Generic alias for stable pro
  "gemini-2.0-flash-exp"  // Experimental, if available
];

const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.DEFAULT_GENAI_MAX_TOKENS || "256");
const DEFAULT_TEMPERATURE = Number(process.env.DEFAULT_GENAI_TEMPERATURE || "0.6");

export async function enhancePrompt(
  prompt: string,
  model?: string,
  options?: { maxOutputTokens?: number; temperature?: number }
) {
  const API_KEY = getApiKey();
  if (!API_KEY) throw new Error("GOOGLE_GENAI_API_KEY not configured");
  if (!prompt.trim()) throw new Error("Prompt required");

  // --- FIX: Robust Normalization ---
  function normalizeModelName(m?: string): string {
    // Start with the provided model OR the default from env
    let target = m || DEFAULT_MODEL;
    
    // Sanitize: remove whitespace and lowercase
    target = target.trim().toLowerCase();

    // 1. Handle Deprecated '-latest' suffix
    // The API no longer supports 'gemini-1.5-flash-latest'. We map it to '-002'.
    if (target.endsWith('-latest')) {
      return target.replace(/-latest$/, '-002');
    }

    // 2. Handle Frontend/UI Aliases
    // Strip '-image' suffix if present
    if (target.endsWith('-image')) {
      target = target.replace(/-image$/, '');
    }

    // Handle ambiguous 'gemini-2.5' references (map to default if not a real model yet)
    if (target.includes('gemini-25') || target.includes('gemini25') || target.includes('gemini-2-5')) {
      return "gemini-1.5-pro"; // or return DEFAULT_MODEL
    }

    return target;
  }

  const modelToUse = normalizeModelName(model);
  const maxOutputTokens = options?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const temperature = options?.temperature ?? DEFAULT_TEMPERATURE;

  const instruction = `
Improve the following prompt for AI image generation.
Add artistic detail, styling, lighting, clarity, realism, composition hints.
Respond ONLY with the enhanced prompt.

User prompt:
${prompt}
`.trim();

  // --- REST Helper ---
  async function restGenerate(mName: string, apiVersion: string = 'v1beta') {
    const apiKey = getApiKey();
    // URL encode the model name to handle special characters if any
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(mName)}:generateContent?key=${apiKey}`;
    
    try {
      const resp = await axios.post(url, {
        contents: [{ role: "user", parts: [{ text: instruction }] }],
        generationConfig: { maxOutputTokens, temperature },
      });
      const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      return { text, raw: resp.data };
    } catch (err: any) {
      // If v1beta fails with 404, try v1 as a last resort fallback for older models
      if (apiVersion === 'v1beta' && (err?.response?.status === 404 || err?.response?.data?.error?.code === 404)) {
        console.info(`[Gemini Service] Model ${mName} not found in v1beta, trying v1...`);
        return restGenerate(mName, 'v1');
      }
      throw err;
    }
  }

  // --- SDK Call (Primary) ---
  async function sdkGenerateWithRetries(mName: string) {
    const apiKey = getApiKey();
    // Initialize SDK safely
    const ai: any = (GoogleGenAI ? new (GoogleGenAI as any)({ apiKey }) : null);
    if (!ai) throw new Error('SDK not available');

    const maxAttempts = 2; // Reduced attempts for faster feedback
    let attempt = 0;
    const baseDelay = 500;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        // Attempt generation using the "models" namespace (common in newer SDKs)
        if (ai.models && typeof ai.models.generateContent === 'function') {
            const sdkResp: any = await ai.models.generateContent({
                model: mName,
                contents: instruction,
                config: { temperature, maxOutputTokens } // Note: check SDK docs for exact config param location
            });
            
            // Parse response (handle different SDK version response shapes)
            const text = sdkResp?.text || 
                         sdkResp?.response?.text?.() || 
                         sdkResp?.response?.text || 
                         (Array.isArray(sdkResp?.candidates) ? sdkResp.candidates[0]?.content?.parts?.[0]?.text : '') || 
                         '';
                         
            return { text: String(text || '').trim(), raw: sdkResp };
        }
        
        // Fallback for older SDK structure
        if (ai.responses && typeof ai.responses.generate === 'function') {
           const response: any = await ai.responses.generate({ model: mName, input: instruction, config: { maxOutputTokens, temperature } });
           const text = (typeof response?.text === 'function') ? response.text()?.trim() : (response?.text?.trim?.() || '');
           return { text, raw: response };
        }

        throw new Error('No compatible SDK generation method found');
      } catch (sdkErr: any) {
        const msg = sdkErr?.message || sdkErr;
        const status = sdkErr?.status || sdkErr?.response?.status;

        // IMMEDIATE FAIL: If 404 (Not Found) or 400 (Bad Request), do not retry SDK.
        if (status === 404 || String(msg).includes('not found')) {
             throw new Error(`Model ${mName} not found (404)`);
        }

        // RETRY: Only for 503 (Unavailable) or 429 (Quota)
        const isTransient = status === 503 || String(msg).toLowerCase().includes('unavailable') || status === 429;
        
        if (attempt >= maxAttempts || !isTransient) {
          throw sdkErr;
        }
        console.warn(`[Gemini Service] SDK attempt ${attempt} failed for ${mName}. Retrying...`);
        await new Promise((r) => setTimeout(r, baseDelay * attempt));
      }
    }
    throw new Error('SDK generation failed after retries');
  }

  // --- Main Execution Logic ---
  
  // 1. Try Primary Model (SDK)
  try {
    const { text, raw } = await sdkGenerateWithRetries(modelToUse);
    return { enhancedPrompt: text, raw, model: modelToUse, sdk: true };
  } catch (sdkFinalErr: any) {
    const errMsg = sdkFinalErr?.message || String(sdkFinalErr);
    console.warn(`[Gemini Service] Primary SDK failed for ${modelToUse}: ${errMsg}. Switching to fallback strategy.`);

    // 2. Fallback Logic (Loop through reliable models via REST)
    // We use REST for fallbacks to isolate SDK issues from API availability issues
    const uniqueFallbacks = Array.from(new Set([modelToUse, ...FALLBACK_MODELS]));

    for (const fallbackModel of uniqueFallbacks) {
      // Skip the model we just tried if it failed with 404 (invalid)
      if (fallbackModel === modelToUse && errMsg.includes('404')) continue;
      
      // Skip normalization for fallbacks as they are hardcoded valid strings
      try {
        console.info(`[Gemini Service] Attempting fallback: ${fallbackModel}`);
        const { text: fbText, raw: fbRaw } = await restGenerate(fallbackModel);
        return { enhancedPrompt: fbText, raw: fbRaw, model: fallbackModel, sdk: false };
      } catch (fallbackErr: any) {
        console.warn(`[Gemini Service] Fallback ${fallbackModel} failed.`);
        // Continue to next model
      }
    }
    
    // If all fallbacks fail
    throw new Error(`Enhancement failed. All models (${uniqueFallbacks.join(', ')}) unavailable.`);
  }
}

export default { enhancePrompt };
