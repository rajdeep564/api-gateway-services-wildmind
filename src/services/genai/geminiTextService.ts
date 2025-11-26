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


const SCENE_GENERATION_SYSTEM_INSTRUCTION = `You are a professional storyboard artist and story world director.

Input: A full story or script.

Your tasks (complete them in this order):

1) STORY WORLD ANALYSIS
Extract the main CHARACTERS that visually appear in the story.
Extract the main LOCATIONS that visually appear.
Define a GLOBAL VISUAL STYLE for all storyboard images.

For each character:
- id: "char_1", "char_2", etc. (sequential)
- name: human-readable name (e.g., "John", "Sarah")
- role: short description (e.g., "Protagonist, shy barista", "Love interest, confident reader")
- visual_description: VERY detailed physical and clothing description. Include: age range, body type, height, hair color/style, eye color, skin tone, facial features, clothing style, main clothing colors, accessories. Be specific and consistent.
- emotion_baseline: their default emotional vibe (e.g., "nervous but kind", "confident and warm")
- consistency_token: A UNIQUE UPPERCASE token combining name and random words (e.g., "JOHN-ALPHA-FOX", "SARAH-DELTA-ROSE"). This will be used in image prompts for consistency.

For each location:
- id: "loc_1", "loc_2", etc. (sequential)
- name: short name (e.g., "Coffee Shop", "City Park")
- visual_description: detailed description of layout, architecture, key props, furniture, lighting, time of day, atmosphere. Be specific about spatial arrangement and visual elements.
- color_palette: main colors to use (e.g., "warm oranges, browns, soft yellows", "autumn golds, deep greens")
- consistency_token: A UNIQUE UPPERCASE token (e.g., "COFFEE-SHOP-AMBER", "PARK-AUTUMN-GOLD")

Global style:
- art_style: overall visual style (e.g., "cinematic semi-realistic with soft lighting", "painterly impressionist", "photorealistic film stills")
- color_palette: global color palette that ties all scenes together (e.g., "warm oranges and teal accents", "muted earth tones")
- aspect_ratio: image aspect ratio (e.g., "16:9", "4:3", "2.35:1")
- camera_style: cinematography approach (e.g., "film stills with shallow depth of field", "wide establishing shots", "intimate close-ups")

2) SCENE OUTLINE (STRUCTURE)
Break the story into 5-10 MAJOR scenes.
For each scene:
- scene_number: integer starting at 1
- heading: screenplay-style heading (e.g., "INT. COFFEE SHOP - DAY", "EXT. PARK - AFTERNOON")
- summary: 1-3 sentences describing the core action/emotion of the scene
- mood: 1-3 words describing emotional tone (e.g., "hopeful", "tense", "joyful and warm")
- character_ids: array of character ids present in this scene (e.g., ["char_1", "char_2"])
- location_id: one location id where the scene takes place (e.g., "loc_1")

3) DETAILED SCENES FOR RENDERING
For each scene, produce a detailed description:
- scene_number: matches the scene_outline number
- heading: same as in scene_outline
- content: detailed description including action, visuals, character emotions, lighting, camera angles, and any important dialogue or sound. This will be used for image generation, so be vivid and specific.

OUTPUT FORMAT (CRITICAL):
Respond ONLY with a SINGLE JSON object with this EXACT structure:

{
  "storyWorld": {
    "characters": [
      {
        "id": "char_1",
        "name": "John",
        "role": "Protagonist, shy barista",
        "visual_description": "30s, average height, slim build, short brown hair, blue eyes behind round glasses, fair skin, wearing a soft blue sweater and dark jeans, nervous demeanor",
        "emotion_baseline": "nervous but kind",
        "consistency_token": "JOHN-ALPHA-FOX"
      }
    ],
    "locations": [
      {
        "id": "loc_1",
        "name": "Coffee Shop",
        "visual_description": "Cozy interior with exposed brick walls, wooden tables and chairs, vintage coffee posters, warm pendant lighting, large windows with natural light, espresso machine at counter",
        "color_palette": "warm oranges, browns, soft yellows",
        "consistency_token": "COFFEE-SHOP-AMBER"
      }
    ],
    "global_style": {
      "art_style": "cinematic semi-realistic with soft lighting",
      "color_palette": "warm oranges and teal accents",
      "aspect_ratio": "16:9",
      "camera_style": "film stills with shallow depth of field"
    },
    "scene_outline": [
      {
        "scene_number": 1,
        "heading": "INT. COFFEE SHOP - DAY",
        "summary": "John enters nervously and spots Sarah by the window.",
        "mood": "nervous but hopeful",
        "character_ids": ["char_1", "char_2"],
        "location_id": "loc_1"
      }
    ]
  },
  "scenes": [
    {
      "scene_number": 1,
      "heading": "INT. COFFEE SHOP - DAY",
      "content": "John, wearing his blue sweater and glasses, enters the cozy coffee shop. Warm lighting bathes the space. He spots Sarah sitting by the window, reading. He approaches hesitantly."
    }
  ]
}

CRITICAL RULES:
- Do NOT add any text outside the JSON object
- Ensure all character_ids and location_id in scene_outline reference valid ids in characters and locations arrays
- Make visual_description fields VERY detailed for consistency
- Consistency tokens must be UNIQUE and UPPERCASE
- Include 5-10 scenes maximum
- Respond ONLY with valid JSON`;

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
    const parsed = JSON.parse(responseText);

    // Validate response structure
    if (!parsed.scenes || !Array.isArray(parsed.scenes)) {
      throw new Error('Invalid scenes structure from Gemini');
    }
    if (!parsed.storyWorld) {
      throw new Error('Missing storyWorld from Gemini');
    }
    if (!parsed.storyWorld.characters || !Array.isArray(parsed.storyWorld.characters)) {
      throw new Error('Invalid characters structure in storyWorld');
    }
    if (!parsed.storyWorld.locations || !Array.isArray(parsed.storyWorld.locations)) {
      throw new Error('Invalid locations structure in storyWorld');
    }
    if (!parsed.storyWorld.global_style) {
      throw new Error('Missing global_style in storyWorld');
    }
    if (!parsed.storyWorld.scene_outline || !Array.isArray(parsed.storyWorld.scene_outline)) {
      throw new Error('Invalid scene_outline structure in storyWorld');
    }

    console.log('[GeminiTextService] Story World generated successfully', {
      charactersCount: parsed.storyWorld.characters.length,
      locationsCount: parsed.storyWorld.locations.length,
      scenesCount: parsed.scenes.length,
    });

    return parsed;
  } catch (e) {
    console.error("Failed to parse JSON from Gemini response", e);
    throw new Error("Failed to generate valid JSON for scenes");
  }
}


