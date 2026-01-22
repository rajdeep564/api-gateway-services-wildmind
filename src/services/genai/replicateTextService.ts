import Replicate from 'replicate';
import { env } from '../../config/env';
import { PROMPT_ENHANCEMENT_SYSTEM_INSTRUCTION, STORYBOARD_SYSTEM_INSTRUCTION } from './geminiTextService';

// Replicate model identifier for GPT-5
// According to Replicate docs: https://replicate.com/openai/gpt-5
const REPLICATE_MODEL = 'openai/gpt-5';

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
 * Calls Replicate's GPT-5 model and returns the response text.
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

    // According to Replicate docs: https://replicate.com/openai/gpt-5
    // Input format: { prompt: string, system_prompt: string }
    // Note: Do NOT include max_tokens - it's not in the official docs and may cause E001 errors
    const input = {
        prompt: prompt.trim(),
        system_prompt: systemPrompt,
    };

    try {
        console.log('[ReplicateTextService] Calling GPT-5 via Replicate (exact format from docs):', {
            model: REPLICATE_MODEL,
            promptLength: prompt.trim().length,
            systemPromptLength: systemPrompt.length,
            inputKeys: Object.keys(input),
        });
        
        // Use predictions.create() to get more detailed error information if run() fails
        let output: any;
        try {
            output = await replicate.run(REPLICATE_MODEL, { input });
        } catch (runError: any) {
            // If run() fails, try using predictions.create() to get more details
            console.warn('[ReplicateTextService] replicate.run() failed, trying predictions.create() for more details...');
            try {
                const prediction = await replicate.predictions.create({
                    model: REPLICATE_MODEL,
                    input,
                });
                
                // Wait for completion and get logs
                let finalPrediction = prediction;
                const maxWaitTime = 60000; // 60 seconds
                const startTime = Date.now();
                
                while (finalPrediction.status === 'starting' || finalPrediction.status === 'processing') {
                    if (Date.now() - startTime > maxWaitTime) {
                        throw new Error('Prediction timeout - took longer than 60 seconds');
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    finalPrediction = await replicate.predictions.get(prediction.id);
                    
                    // Log any error details
                    if (finalPrediction.error) {
                        console.error('[ReplicateTextService] Prediction error details:', finalPrediction.error);
                    }
                    if (finalPrediction.logs) {
                        console.log('[ReplicateTextService] Prediction logs:', finalPrediction.logs);
                    }
                }
                
                if (finalPrediction.status === 'succeeded' && finalPrediction.output) {
                    output = finalPrediction.output;
                } else if (finalPrediction.status === 'failed') {
                    const errorDetails = finalPrediction.error || 'Unknown error';
                    const logs = finalPrediction.logs || '';
                    throw new Error(`Prediction failed: ${JSON.stringify(errorDetails)}. Logs: ${logs}`);
                } else {
                    throw new Error(`Prediction ended with status: ${finalPrediction.status}`);
                }
            } catch (predError: any) {
                // If predictions.create() also fails, use the original error but with more details
                console.error('[ReplicateTextService] Both run() and predictions.create() failed:', {
                    runError: runError?.message,
                    predError: predError?.message,
                    predictionStatus: predError?.status,
                });
                throw runError; // Throw the original run() error
            }
        }

        // Replicate returns an array of strings for streaming models, or a string
        const responseText = Array.isArray(output) ? output.join('') : String(output);

        console.log('[ReplicateTextService] ✅ GPT-5 response received:', {
            totalLength: responseText.length,
        });

        return responseText;
    } catch (error: any) {
        // Extract detailed error information
        const errorDetails: any = {
            message: error?.message,
            status: error?.status,
            statusCode: error?.statusCode,
            responseStatus: error?.response?.status,
            responseData: error?.response?.data,
            responseText: error?.response?.text,
            body: error?.body,
            request: error?.request ? {
                url: error.request.url,
                method: error.request.method,
            } : null,
        };
        
        console.error('[ReplicateTextService] ❌ GPT-5 failed with detailed error:', {
            ...errorDetails,
            model: REPLICATE_MODEL,
            hasApiKey: !!env.replicateApiKey,
            inputKeys: Object.keys(input),
            promptLength: prompt.trim().length,
            systemPromptLength: systemPrompt.length,
        });
        
        // Provide more helpful error messages
        let errorMessage = 'Unknown error';
        if (error?.message) {
            errorMessage = error.message;
        } else if (error?.status || error?.statusCode) {
            errorMessage = `Replicate API returned status ${error.status || error.statusCode}`;
        }
        
        // Try to extract more specific error from response
        let specificError = '';
        if (error?.response?.data) {
            try {
                const data = typeof error.response.data === 'string' 
                    ? JSON.parse(error.response.data) 
                    : error.response.data;
                specificError = data.detail || data.error || data.message || '';
            } catch (e) {
                specificError = String(error.response.data);
            }
        }
        
        // Check for common error patterns
        if (errorMessage.includes('E001') || errorMessage.includes('Prediction failed')) {
            // E001 from Replicate typically means:
            // 1. Invalid input parameters
            // 2. Model access restrictions
            // 3. Account/credit issues
            // 4. Prompt too long or contains invalid characters
            const explanation = `E001 Error Explanation:
- This is a generic Replicate API error that can occur due to:
  1. Invalid input parameters (check prompt/system_prompt format)
  2. Account doesn't have access to GPT-5 model (may need paid plan)
  3. Prompt too long (current: ${prompt.trim().length} chars, system: ${systemPrompt.length} chars)
  4. Invalid characters in prompt
  5. API key permissions issue

To fix:
- Verify your Replicate account has access to 'openai/gpt-5' model
- Check if you need to enable the model in your Replicate dashboard
- Try a shorter, simpler prompt to test
- Verify your API key has the correct permissions`;
            
            throw new Error(`Replicate API error (E001): ${explanation}\n\nError: ${errorMessage}${specificError ? `\nDetails: ${specificError}` : ''}`);
        }
        
        if (errorMessage.includes('404') || errorMessage.includes('Not Found')) {
            throw new Error(`Replicate model not found: The model '${REPLICATE_MODEL}' is not available. This could mean: 1) The model identifier is incorrect, 2) Your account doesn't have access to this model, 3) The model has been deprecated. Please check your Replicate dashboard for available models.`);
        }
        
        throw new Error(`Replicate text generation failed: ${errorMessage}${specificError ? ` (${specificError})` : ''}`);
    }
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
  Write naturally using the character and location names you identified in the story world (e.g., "Aryan", "Diya", "Restaurant").

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


CRITICAL RULES:
- Do NOT add any text outside the JSON object
- Ensure all character_ids and location_id in scene_outline reference valid ids in characters and locations arrays
- Make visual_description fields VERY detailed for consistency
- Consistency tokens must be UNIQUE and UPPERCASE
- Include 5-10 scenes maximum
- **CHARACTER/LOCATION NAME CONSISTENCY**: 
  * Use the EXACT character and location names from the input story
  * If the input mentions "Aryan" and "Diya", use those exact names (not "John" or "Sarah")
  * If the input mentions "Restaurant", use that exact name (not "Coffee Shop" or "Cafe")
  * This ensures visual consistency - the same character image will be used throughout all scenes
- Respond ONLY with valid JSON`;

export async function generateScenesFromStory(story: string): Promise<any> {
    const replicate = getReplicateClient();

    // Remove @mentions from story - they are only metadata, not part of the story text
    // Replace @mentions with their display names (capitalize first letter)
    const mentionRegex = /@(\w+)/gi;
    let cleanedStory = story;
    const mentionMatches = Array.from(story.matchAll(mentionRegex));
    const uniqueMentions = [...new Set(mentionMatches.map(m => m[1].toLowerCase()))];

    console.log('[ReplicateTextService] 📝 Story input received:', {
        originalStory: story.substring(0, 200) + (story.length > 200 ? '...' : ''),
        storyLength: story.length,
        detectedMentions: uniqueMentions,
        mentionCount: uniqueMentions.length,
    });

    if (uniqueMentions.length > 0) {
        // Replace @mentions with capitalized names (e.g., @aryan -> Aryan)
        uniqueMentions.forEach(mention => {
            const displayName = mention.charAt(0).toUpperCase() + mention.slice(1);
            const regex = new RegExp(`@${mention}\\b`, 'gi');
            cleanedStory = cleanedStory.replace(regex, displayName);
        });

        console.log('[ReplicateTextService] ✅ Cleaned story (removed @mentions):', {
            originalLength: story.length,
            cleanedLength: cleanedStory.length,
            mentionsRemoved: uniqueMentions,
            cleanedStoryPreview: cleanedStory.substring(0, 200) + (cleanedStory.length > 200 ? '...' : ''),
        });
    }

    const input = {
        prompt: cleanedStory.trim(),
        system_prompt: SCENE_GENERATION_SYSTEM_INSTRUCTION,
        max_tokens: 4096,
        temperature: 0.7,
        json: true // Force JSON output mode if supported by model/wrapper
    };

    console.log('[ReplicateTextService] Starting scene generation with GPT-5', {
        model: REPLICATE_MODEL,
        inputInternal: 'hidden (full story)'
    });

    try {
        const output = await replicate.run(REPLICATE_MODEL, { input });
        let responseText = Array.isArray(output) ? output.join('') : String(output);

        // Clean up markdown code blocks if present
        responseText = responseText.trim();
        if (responseText.startsWith('```')) {
            responseText = responseText.replace(/^```(?:json|JSON)?\s*\n?/i, '');
            responseText = responseText.replace(/\n?```\s*$/g, '');
            responseText = responseText.trim();
        }

        // Isolate JSON object if wrapped
        const firstBrace = responseText.indexOf('{');
        const lastBrace = responseText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            responseText = responseText.substring(firstBrace, lastBrace + 1);
        }

        const parsed = JSON.parse(responseText);

        // Validation
        if (!parsed.scenes || !Array.isArray(parsed.scenes)) {
            throw new Error('Invalid scenes structure from Replicate');
        }
        if (!parsed.storyWorld) {
            throw new Error('Missing storyWorld from Replicate');
        }

        console.log('[ReplicateTextService] Story World generated successfully', {
            charactersCount: parsed.storyWorld.characters?.length || 0,
            locationsCount: parsed.storyWorld.locations?.length || 0,
            scenesCount: parsed.scenes.length,
        });

        return parsed;
    } catch (error: any) {
        console.error('[ReplicateTextService] Error generating scenes:', error);
        throw new Error(`Replicate scene generation failed: ${error.message || 'Unknown error'}`);
    }
}
