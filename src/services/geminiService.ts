import axios from "axios";
import { GoogleGenAI } from "@google/genai";

const API_KEY =
  process.env.GOOGLE_GENAI_API_KEY ||
  process.env.GENAI_API_KEY ||
  "";

const DEFAULT_MODEL = process.env.DEFAULT_GENAI_MODEL || "gemini-2.5-flash";
const DEFAULT_MAX_OUTPUT_TOKENS = Number(process.env.DEFAULT_GENAI_MAX_TOKENS || "256");
const DEFAULT_TEMPERATURE = Number(process.env.DEFAULT_GENAI_TEMPERATURE || "0.6");

export async function enhancePrompt(
  prompt: string,
  model?: string,
  options?: { maxOutputTokens?: number; temperature?: number }
) {
  if (!API_KEY) throw new Error("GOOGLE_GENAI_API_KEY not configured");
  if (!prompt.trim()) throw new Error("Prompt required");

  // Normalize incoming model names (frontend may send UI-friendly identifiers).
  function normalizeModelName(m?: string) {
    if (!m) return DEFAULT_MODEL;
    const low = m.toLowerCase();
    // Map common frontend identifiers to the GenAI model name
    if (low.includes('gemini-25') || low.includes('gemini25') || low.includes('gemini-2-5')) {
      return DEFAULT_MODEL; // prefer configured default for ambiguous gemini-25 variants
    }
    // Strip '-image' suffixes that some frontends append
    if (low.endsWith('-image')) return low.replace(/-image$/, '');
    return m;
  }

  const modelToUse = normalizeModelName(model) || DEFAULT_MODEL;
  const maxOutputTokens = options?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const temperature = options?.temperature ?? DEFAULT_TEMPERATURE;

  const instruction = `
Improve the following prompt for AI image generation.
Add artistic detail, styling, lighting, clarity, realism, composition hints.
Respond ONLY with the enhanced prompt.

User prompt:
${prompt}
`.trim();

  // --- SDK call (Primary path) ---
  // Try SDK with retries for transient errors (503/unavailable). If SDK isn't available
  // or fails after retries, fall back to REST.
  async function sdkGenerateWithRetries(mName: string) {
    const ai: any = (GoogleGenAI ? new (GoogleGenAI as any)({ apiKey: API_KEY }) : null);
    if (!ai) throw new Error('SDK not available');

    const maxAttempts = 3;
    let attempt = 0;
    const baseDelay = 400; // ms

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        // Try canonical quickstart method first
        if (ai.responses && typeof ai.responses.generate === 'function') {
          const response: any = await ai.responses.generate({ model: mName, input: instruction, config: { maxOutputTokens, temperature } });
          const text = (typeof response?.text === 'function') ? response.text()?.trim() : (response?.text?.trim?.() || '');
          return { text, raw: response };
        }

        // Fallback shape: ai.models.generateContent
        if (ai.models && typeof ai.models.generateContent === 'function') {
          const sdkResp: any = await ai.models.generateContent({ model: mName, contents: instruction, temperature, maxOutputTokens });
          const text = sdkResp?.text || sdkResp?.response?.text || sdkResp?.content || (Array.isArray(sdkResp?.candidates) ? sdkResp.candidates[0]?.content : undefined) || '';
          return { text: String(text || '').trim(), raw: sdkResp };
        }

        throw new Error('No compatible SDK generation method found');
      } catch (sdkErr: any) {
        const msg = sdkErr?.message || sdkErr;
        const status = sdkErr?.status || sdkErr?.response?.status || null;
        // Treat 503 / UNAVAILABLE as transient and retry
        const isTransient = status === 503 || String(msg).toLowerCase().includes('unavailable') || String(msg).toLowerCase().includes('temporar');
        console.warn(`SDK attempt ${attempt} failed for model ${mName}:`, msg);
        if (attempt >= maxAttempts || !isTransient) {
          throw sdkErr;
        }
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error('SDK generation failed after retries');
  }

  try {
    const { text, raw } = await sdkGenerateWithRetries(modelToUse);
    return { enhancedPrompt: text, raw, model: modelToUse, sdk: true };
  } catch (sdkFinalErr: any) {
    console.warn('SDK failed or unavailable; falling back to REST:', sdkFinalErr?.message || sdkFinalErr);
  }

  // --- REST fallback ---
  // REST fallback with improved error handling + retry to default model if model unsupported
  async function restGenerate(mName: string) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mName)}:generateContent?key=${API_KEY}`;
    const resp = await axios.post(url, {
      contents: [{ role: "user", parts: [{ text: instruction }] }],
      generationConfig: { maxOutputTokens, temperature },
    });
    const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return { text, raw: resp.data };
  }

  try {
    // REST retry loop for transient server-side errors (503, 500, 429)
    const maxRestAttempts = 3;
    let restAttempt = 0;
    while (restAttempt < maxRestAttempts) {
      restAttempt += 1;
      try {
        const { text, raw } = await restGenerate(modelToUse);
        return { enhancedPrompt: text, raw, model: modelToUse, sdk: false };
      } catch (restErrInner: any) {
        const status = restErrInner?.response?.status;
        const body = restErrInner?.response?.data;
        const isTransient = status === 503 || status === 500 || status === 429 || (body && JSON.stringify(body).toLowerCase().includes('unavailable'));
        console.warn(`REST attempt ${restAttempt} failed for model ${modelToUse}:`, restErrInner?.message || restErrInner?.response?.data || restErrInner);
        if (!isTransient || restAttempt >= maxRestAttempts) {
          throw restErrInner;
        }
        // Exponential backoff before retrying
        const backoff = 300 * Math.pow(2, restAttempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  } catch (restErr: any) {
    const message = restErr?.response?.data || restErr?.message || String(restErr);
    console.warn('REST fallback failed for model', modelToUse, message);

    // If the failure looks like model-not-found or unsupported, retry with the DEFAULT_MODEL
    const status = restErr?.response?.status;
    const body = restErr?.response?.data;
    const isModelNotFound = status === 404 || (body && JSON.stringify(body).toLowerCase().includes('not found'));

    if (isModelNotFound && modelToUse !== DEFAULT_MODEL) {
      try {
        console.info('Retrying REST fallback with default model:', DEFAULT_MODEL);
        const { text: text2, raw: raw2 } = await restGenerate(DEFAULT_MODEL);
        return { enhancedPrompt: text2, raw: raw2, model: DEFAULT_MODEL, sdk: false };
      } catch (retryErr: any) {
        console.error('Retry with default model failed:', retryErr?.response?.data || retryErr?.message || retryErr);
        throw new Error('Enhancement failed: model not supported by GenAI');
      }
    }

    throw new Error(restErr?.message || 'REST enhancement failed');
  }
}

export default { enhancePrompt };
