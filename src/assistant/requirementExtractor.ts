/**
 * WildMind — Requirement Extractor
 *
 * Uses GPT-5 Nano via Replicate to extract structured field values
 * from a user's natural language message, given the current task type
 * and what fields are still needed.
 *
 * Returns only the fields it found with high confidence.
 * Never returns null for already-collected fields.
 */

import { GPT_5_NANO_MODEL } from "../services/genai/gpt5NanoService";
import { completeText } from "../modelGateway/modelGateway";
import { redactPii } from "../utils/piiRedact";
import { getAllFields, type RequirementField, type RequirementSchema } from "./requirementSchemas";

/** Optional context for gateway logging (userId, requestId, promptTemplateVersion) when called from conversation/orchestrator */
export interface GatewayContext {
  userId?: string;
  requestId?: string;
  /** AI governance: prompt template version for audit */
  promptTemplateVersion?: string;
}

// ── Schema Generation ─────────────────────────────────────────────────────────

const SCHEMA_GENERATION_SYSTEM_PROMPT = `
You are a creative requirement engineer for WildMind AI, an AI media generation platform.
The user wants to generate a certain type of content (e.g., video, image, music, logo).
Based on their initial message and the task type, identify what SPECIFIC fields of information
need to be collected from the user to generate an optimal result.

RULES:
1. Return ONLY a valid JSON object matching the schema format exactly. No markdown, no explanations.
2. Keep the number of fields reasonable (4-8 max). Make sure the essential ones are required: true.
3. Make sure 'question' for each field is a natural, conversational question.
4. For 'type', strictly use one of: "string", "number", "boolean", "enum". Use "enum" if there are specific options.

OUTPUT FORMAT:
{
  "taskType": "<task type here>",
  "displayName": "<Human readable name>",
  "fields": [
    {
      "key": "snake_case_key",
      "label": "Human Readable Label",
      "required": true,
      "type": "string",
      "question": "What is the subject of the video?",
      "options": ["opt1", "opt2"] // only if type is "enum"
    }
  ]
}
`.trim();

export async function generateDynamicSchema(
  userMessage: string,
  taskType: string,
  gatewayContext?: GatewayContext,
): Promise<RequirementSchema | null> {
  try {
    const safeMessage = redactPii(userMessage);
    const prompt = `Task Type: ${taskType}\nUser Message: "${safeMessage}"\nGenerate the optimal requirement schema for this specific request.`;
    const raw = await completeText(
      prompt,
      {
        systemPrompt: SCHEMA_GENERATION_SYSTEM_PROMPT,
        maxCompletionTokens: 800,
        reasoningEffort: "low",
        verbosity: "low",
        userId: gatewayContext?.userId,
        requestId: gatewayContext?.requestId,
        promptTemplateVersion: gatewayContext?.promptTemplateVersion,
      },
      GPT_5_NANO_MODEL,
    );

    const cleaned = raw
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    
    const parsed = JSON.parse(cleaned) as RequirementSchema;
    if (!parsed.fields || !Array.isArray(parsed.fields)) return null;

    // Enforce boolean typing and ensure at least 2 fields are required
    let requiredCount = 0;
    parsed.fields.forEach((f, i) => {
      if (typeof f.required === "string") {
        f.required = f.required === "true";
      }
      if (f.required) requiredCount++;
    });

    if (requiredCount === 0 && parsed.fields.length > 0) {
      console.log("[RequirementExtractor] AI forgot to make fields required. Forcing first two to be required.");
      parsed.fields.forEach((f, i) => {
        if (i < 2) f.required = true;
      });
    }

    console.log(`[RequirementExtractor] Generated custom schema for ${taskType}:`, JSON.stringify(parsed, null, 2));

    return parsed;
  } catch (err: any) {
    console.warn("[RequirementExtractor] Dynamic schema generation failed:", err?.message);
    return null;
  }
}

// ── Task type detection prompt ────────────────────────────────────────────────

const TASK_DETECTION_SYSTEM_PROMPT = `
You are a creative task classifier for WildMind AI, a platform for AI-generated media.

Analyze the user's message and determine what type of creative content they want to generate.

VALID TASK TYPES:
- image: single image, photo, illustration, artwork, poster
- logo: brand logo, company logo, brand mark
- video: video clip, animation, film, reel, cinematic scene
- video_ad: advertisement, commercial, promo video, marketing video
- music: song, music track, audio, soundtrack, beat, melody

RULES:
1. Return ONLY a raw JSON object. No markdown. No explanation.
2. Be decisive — pick the best match.
3. If unclear but involves video + marketing/brand → use "video_ad"
4. If unclear → use "image" as default

OUTPUT FORMAT:
{ "taskType": "video_ad", "confidence": 0.87 }
`.trim();

export async function detectTaskType(
  userMessage: string,
  gatewayContext?: GatewayContext,
): Promise<{ taskType: string; confidence: number }> {
  try {
    const safeMessage = redactPii(userMessage);
    const raw = await completeText(
      safeMessage,
      {
        systemPrompt: TASK_DETECTION_SYSTEM_PROMPT,
        maxCompletionTokens: 100,
        reasoningEffort: "minimal",
        verbosity: "low",
        userId: gatewayContext?.userId,
        requestId: gatewayContext?.requestId,
        promptTemplateVersion: gatewayContext?.promptTemplateVersion,
      },
      GPT_5_NANO_MODEL,
    );

    const cleaned = raw
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      taskType: parsed.taskType ?? "image",
      confidence: parsed.confidence ?? 0.5,
    };
  } catch (err: any) {
    console.warn("[RequirementExtractor] Task detection failed, defaulting to image:", err?.message);
    return { taskType: "image", confidence: 0.3 };
  }
}

// ── Field extraction prompt builder ──────────────────────────────────────────

function buildExtractionSystemPrompt(
  taskType: string,
  targetFields: RequirementField[],
  alreadyCollected: Record<string, any>,
): string {
  const fieldsDesc = targetFields
    .map((f) => `  - "${f.key}" (${f.label}, ${f.type}): ${f.question}`)
    .join("\n");

  const collectedDesc = Object.keys(alreadyCollected).length > 0
    ? `\nAlready collected: ${JSON.stringify(alreadyCollected)}`
    : "\nNo fields collected yet.";

  return `
You are a data extraction assistant for WildMind AI. The user is creating a ${taskType}.

FIELDS TO EXTRACT FROM THE USER'S MESSAGE:
${fieldsDesc}
${collectedDesc}

RULES:
1. Return ONLY a raw JSON object. No markdown. No explanation. No code fences.
2. Only include fields you can confidently extract from the user's message.
3. Do NOT include fields the user didn't mention.
4. Do NOT return null or empty string — omit the key entirely if not found.
5. For boolean fields: "yes"/"true"/"sure" → true, "no"/"nope"/"don't" → false.
6. For number fields: extract the number from phrases like "30 seconds", "one minute" (→ 60), "2 mins" (→ 120).

EXAMPLE OUTPUT:
{ "brand_name": "Wild Coffee", "industry": "coffee", "duration": 30 }
`.trim();
}

// ── Field extractor ───────────────────────────────────────────────────────────

/**
 * Extract field values from a user message given the task type and
 * which fields are still needed.
 *
 * @returns Partial record of extracted field key→value pairs
 */
export async function extractFieldsFromMessage(
  userMessage: string,
  schema: RequirementSchema,
  alreadyCollected: Record<string, any>,
  gatewayContext?: GatewayContext,
): Promise<Record<string, any>> {
  const allFields = getAllFields(schema);
  if (allFields.length === 0) return {};

  // Only extract fields we still need (not already collected)
  const neededFields = allFields.filter((f) => {
    const val = alreadyCollected[f.key];
    return val === undefined || val === null || val === "";
  });

  if (neededFields.length === 0) return {};

  const systemPrompt = buildExtractionSystemPrompt(schema.taskType, neededFields, alreadyCollected);
  const safeMessage = redactPii(userMessage);

  try {
    const raw = await completeText(
      safeMessage,
      {
        systemPrompt,
        maxCompletionTokens: 300,
        reasoningEffort: "minimal",
        verbosity: "low",
        userId: gatewayContext?.userId,
        requestId: gatewayContext?.requestId,
        promptTemplateVersion: gatewayContext?.promptTemplateVersion,
      },
      GPT_5_NANO_MODEL,
    );

    const cleaned = raw
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    const extracted = JSON.parse(cleaned);

    // Filter out any null/empty values and ensure they're valid types
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(extracted)) {
      if (value !== null && value !== undefined && value !== "") {
        result[key] = value;
      }
    }

    console.log(`[RequirementExtractor] Extracted ${Object.keys(result).length} fields from message:`, result);
    return result;
  } catch (err: any) {
    console.warn("[RequirementExtractor] Field extraction failed (non-fatal):", err?.message);
    return {};
  }
}

// ── Question generator ────────────────────────────────────────────────────────

const QUESTION_SYSTEM_PROMPT = `
You are a friendly creative assistant at WildMind AI helping a user create amazing content.
You need to ask the user for ONE piece of missing information.

RULES:
1. Ask only ONE question — the most important missing field.
2. Be conversational and warm, not robotic.
3. Keep it SHORT — 1-2 sentences maximum.
4. Don't say "please provide" — be natural.
5. If there are multiple missing fields, ask only the FIRST one listed.
6. Return ONLY the question text. No JSON. No labels. Just the question sentence.
`.trim();

/**
 * Generate a natural follow-up question for the next missing field.
 * Falls back to the field's static `question` property if LLM fails.
 */
export async function generateFollowUpQuestion(
  missingField: RequirementField,
  schema: RequirementSchema,
  alreadyCollected: Record<string, any>,
  gatewayContext?: GatewayContext,
): Promise<string> {
  const context = Object.keys(alreadyCollected).length > 0
    ? `Context already collected: ${JSON.stringify(alreadyCollected)}.`
    : "";

  const prompt = `${context}\nI need to ask about: "${missingField.label}" for a ${schema.taskType}.\nThe field question is: "${missingField.question}"${missingField.options ? `\nOptions: ${missingField.options.join(", ")}` : ""}`;

  try {
    const question = await completeText(
      prompt,
      {
        systemPrompt: QUESTION_SYSTEM_PROMPT,
        maxCompletionTokens: 80,
        reasoningEffort: "minimal",
        verbosity: "low",
        userId: gatewayContext?.userId,
        requestId: gatewayContext?.requestId,
        promptTemplateVersion: gatewayContext?.promptTemplateVersion,
      },
      GPT_5_NANO_MODEL,
    );
    return question.trim() || missingField.question;
  } catch {
    // Always fall back to the static question text
    return missingField.question;
  }
}
