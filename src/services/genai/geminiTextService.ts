'use strict';

import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env';

const GEMINI_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3-pro-preview';

const STORYBOARD_SYSTEM_INSTRUCTION = `You are a creative storyteller. From the user prompt, craft a short, engaging story.
The story should be concise but descriptive, capturing the essence of the user's idea.
Do not use technical script formatting (like "SCENE 1", "INT.", "EXT.").
Just write the story in clear, evocative prose.
Keep the tone consistent with the user's prompt.
Respond only with the story text.`;

let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;

  const apiKey =
    env.googleGenAIApiKey ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GENAI_API_KEY ||
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY (or GOOGLE_GENAI_API_KEY/GENAI_API_KEY) is required to use Gemini text generation');
  }

  cachedClient = new GoogleGenAI({
    apiKey,
  });

  return cachedClient;
}

/**
 * Calls Gemini text-to-text model with optional search tool and returns the aggregated response text.
 */
export async function generateGeminiTextResponse(
  prompt: string,
  options?: {
    maxOutputTokens?: number;
    enableGoogleSearchTool?: boolean;
  }
): Promise<string> {
  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt must be a non-empty string');
  }

  const ai = getGeminiClient();

  const tools = options?.enableGoogleSearchTool === false ? [] : [{ googleSearch: {} }];

  const config: Record<string, any> = {
    thinkingConfig: {
      thinkingLevel: 'HIGH',
    },
    tools,
  };

  if (options?.maxOutputTokens) {
    config.generationConfig = {
      maxOutputTokens: Math.min(Math.max(options.maxOutputTokens, 32), 4096),
    };
  }

  // Prepend system instruction to contents array as system role message
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [
    {
      role: 'system',
      parts: [
        {
          text: STORYBOARD_SYSTEM_INSTRUCTION,
        },
      ],
    },
    {
      role: 'user',
      parts: [
        {
          text: prompt.trim(),
        },
      ],
    },
  ];

  console.log('[GeminiTextService] Starting text generation', {
    model: GEMINI_MODEL,
    promptPreview: prompt.trim().slice(0, 120),
    hasSearchTool: tools.length > 0,
    maxOutputTokens: options?.maxOutputTokens,
  });

  const stream = await ai.models.generateContentStream({
    model: GEMINI_MODEL,
    config,
    contents,
  });

  let aggregatedText = '';
  const startTime = Date.now();
  const MAX_STREAM_TIME = 120000; // 2 minutes max for streaming

  const iterator = (stream as any)?.stream ?? stream;

  try {
    for await (const chunk of iterator) {
      // Check for timeout during streaming
      if (Date.now() - startTime > MAX_STREAM_TIME) {
        throw new Error('Gemini stream timeout: response took too long');
      }

      try {
        const chunkText =
          typeof chunk?.text === 'function'
            ? chunk.text()
            : typeof chunk?.text === 'string'
              ? chunk.text
              : chunk?.candidates?.[0]?.content?.parts
                ?.map((part: any) => part?.text)
                .filter(Boolean)
                .join('');

        if (chunkText) {
          console.log('[GeminiTextService] Stream chunk received', {
            chunkLength: chunkText.length,
            totalLength: aggregatedText.length + chunkText.length,
          });
          aggregatedText += chunkText;
        }
      } catch (err) {
        console.warn('[GeminiTextService] Failed to read chunk text:', err);
      }
    }
  } catch (err: any) {
    if (err.message?.includes('timeout')) {
      throw new Error('Gemini response timeout: The storyboard generation took too long. Please try with a shorter prompt.');
    }
    throw err;
  }

  aggregatedText = aggregatedText.trim();

  if (!aggregatedText) {
    throw new Error('Gemini returned an empty response');
  }

  console.log('[GeminiTextService] Completed text generation', {
    totalLength: aggregatedText.length,
    durationMs: Date.now() - startTime,
  });

  return aggregatedText;
}

const SCENE_GENERATION_SYSTEM_INSTRUCTION = `You are a professional storyboard artist.
Your task is to break down the provided story into a sequence of scenes (5-10 scenes).
For each scene, provide:
- scene_number: integer
- content: A detailed description of the scene, including action, visuals, and any dialogue.
- heading: A standard scene heading (e.g., "EXT. FOREST - DAY").

Output the result as a valid JSON object with a "scenes" array.
Example format:
{
  "scenes": [
    {
      "scene_number": 1,
      "heading": "EXT. PARK - DAY",
      "content": "The sun shines brightly..."
    }
  ]
}
Respond ONLY with the JSON object.`;

export async function generateScenesFromStory(story: string): Promise<any> {
  const ai = getGeminiClient();

  const config: any = {
    generationConfig: {
      responseMimeType: "application/json",
    }
  };

  const contents = [
    {
      role: 'system',
      parts: [{ text: SCENE_GENERATION_SYSTEM_INSTRUCTION }]
    },
    {
      role: 'user',
      parts: [{ text: story }]
    }
  ];

  const result: any = await ai.models.generateContent({
    model: GEMINI_MODEL,
    config,
    contents,
  });

  const responseText =
    typeof result.text === 'function' ? result.text() :
      typeof result.text === 'string' ? result.text :
        result.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
        JSON.stringify(result);
  try {
    return JSON.parse(responseText);
  } catch (e) {
    console.error("Failed to parse JSON from Gemini response", e);
    throw new Error("Failed to generate valid JSON for scenes");
  }
}


