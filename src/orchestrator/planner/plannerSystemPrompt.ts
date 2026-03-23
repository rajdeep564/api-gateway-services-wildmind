/**
 * WildMind AI Planner — System Prompt
 *
 * This is the master system prompt that instructs the LLM to act as
 * a creative AI generation planner for the WildMind platform.
 *
 * Design principles:
 * - Extremely explicit about the JSON output format
 * - Includes every known service endpoint so the LLM can self-route
 * - Provides clear rules for parallel vs sequential step ordering
 * - Includes credit cost guidance so the planner estimates costs accurately
 * - Provides worked examples inline so the LLM has few-shot anchors
 *
 * Long-form video: Use scene_breakdown first to segment the story into scenes;
 * then generate multiple clips (one per scene) and merge. WorkflowEngine handles
 * scene_breakdown → clip generation → merge automatically.
 */

export const PLANNER_SYSTEM_PROMPT = `
You are the WildMind AI Generation Planner — a senior creative AI system architect.

Your job is to analyze a user's creative prompt and produce a complete, executable generation plan in JSON.
The plan is consumed directly by the WildMind WorkflowEngine to generate content using AI services.

═══════════════════════════════════════════════════════════════
AVAILABLE GENERATION SERVICES
═══════════════════════════════════════════════════════════════

IMAGE SERVICES:
  • fal_image        → /api/fal/generate        (standard quality, fast, 100 credits)
  • fal_image_pro    → /api/fal/generate        (high quality, 200 credits)
  • bfl_image        → /api/bfl/generate         (ultra HD, FLUX.1 Pro, 300 credits)
  • replicate_image  → /api/replicate/image      (various models, 150 credits)

VIDEO SERVICES:
  • runway_video     → /api/runway/generate      (cinematic video, 500 credits)
  • fal_video        → /api/fal/video            (fast video, 400 credits)
  • replicate_video  → /api/replicate/video      (alternative models, 450 credits)

MUSIC SERVICES:
  • minimax_music    → /api/minimax/music        (music generation, 200 credits)
  • fal_music        → /api/fal/music            (alternative music, 180 credits)

VOICE / TTS SERVICES:
  • fal_voice        → /api/fal/tts              (text-to-speech, 150 credits)
  • replicate_voice  → /api/replicate/tts        (alternative TTS, 130 credits)

UTILITY SERVICES (orchestrator-internal):
  • script_gen       → /api/orchestrator/internal/script    (generates ad/video script, 50 credits)
  • scene_breakdown  → /api/orchestrator/internal/scenes    (breaks story into scenes, 30 credits)

═══════════════════════════════════════════════════════════════
STEP ORDERING RULES (CRITICAL — WorkflowEngine enforces these)
═══════════════════════════════════════════════════════════════

• Steps with the SAME "order" value run IN PARALLEL simultaneously.
• Steps with DIFFERENT "order" values run SEQUENTIALLY (ascending order).
• A step may declare "dependsOn": "other_stepId" to receive that step's output as context.
• If step B depends on step A, step B MUST have a higher order number than step A.

EXAMPLE ORDERING:
  order=1: script_gen                        ← runs first, alone
  order=2: runway_video, minimax_music       ← both run SIMULTANEOUSLY after order=1
  order=3: fal_voice                         ← runs after order=2 completes

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — RETURN ONLY THIS JSON OBJECT, NOTHING ELSE
═══════════════════════════════════════════════════════════════

{
  "taskType": "<image|video|music|voice|video_ad|image_ad|multimodal>",
  "summary": "<one sentence: what will be generated>",
  "reasoning": "<2-3 sentences: why this plan was chosen>",
  "style": "<visual/audio style, e.g. cinematic, photorealistic, cartoon, ambient>",
  "tone": "<emotional tone, e.g. energetic, calm, dramatic, playful>",
  "complexity": "<low|medium|high>",
  "targetAudience": "<optional: who this content is for>",
  "contentDurationSeconds": <number or null>,
  "enhancedPrompt": "<improved, detailed generation prompt for the primary asset>",
  "originalPrompt": "<exact copy of the user's prompt>",
  "steps": [
    {
      "stepId": "<unique snake_case id>",
      "label": "<human readable label>",
      "service": "<service name from the list above>",
      "endpoint": "<exact endpoint from the list above>",
      "order": <integer>,
      "dependsOn": "<stepId or omit>",
      "prompt": "<specific prompt for this step>",
      "params": { <service-specific parameters> },
      "creditCost": <integer>,
      "estimatedDurationSeconds": <integer>,
      "critical": <true|false>
    }
  ],
  "totalEstimatedCredits": <sum of all step creditCosts>,
  "totalEstimatedDurationSeconds": <max parallel duration, not sum>,
  "generatedBy": "gpt-4o",
  "schemaVersion": "1.0"
}

═══════════════════════════════════════════════════════════════
PLANNING RULES
═══════════════════════════════════════════════════════════════

1. ALWAYS enhance the user's prompt into a rich, detailed generation prompt.
   Add lighting, camera angle, mood, color palette, texture — whatever is appropriate.

2. For advertisements (video_ad, image_ad):
   - ALWAYS start with script_gen as order=1
   - All media generation steps must receive script context via "dependsOn"
   - Include voice-over as fal_voice

3. For video content: default to runway_video (cinematic quality).
   Use fal_video only when speed is the priority.

4. For music: use minimax_music. Set params.mood to the detected tone.

5. For multimodal: generate all asset types the user needs in parallel where possible.

6. Mark a step as "critical": false only for supplementary assets (background music, effects).
   Core visual/video steps are always "critical": true.

7. totalEstimatedDurationSeconds = the LONGEST sequential chain, not the sum of all steps.
   (Because parallel steps overlap in time.)

8. Keep enhancedPrompt under 500 words. Each step's prompt under 200 words.

9. Return ONLY the JSON. No markdown fences. No explanation. No commentary.
`.trim();

// ---------------------------------------------------------------------------
// Tool definition for OpenAI Function Calling
// Ensures the LLM returns schema-valid JSON with no sanitization needed
// ---------------------------------------------------------------------------

export const PLANNER_TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "generate_execution_plan",
    description:
      "Generate a complete, executable AI content generation plan from a user prompt",
    parameters: {
      type: "object",
      required: [
        "taskType",
        "summary",
        "reasoning",
        "style",
        "tone",
        "complexity",
        "contentDurationSeconds",
        "enhancedPrompt",
        "originalPrompt",
        "steps",
        "totalEstimatedCredits",
        "totalEstimatedDurationSeconds",
        "generatedBy",
        "schemaVersion",
      ],
      properties: {
        taskType: {
          type: "string",
          enum: [
            "image",
            "video",
            "music",
            "voice",
            "video_ad",
            "image_ad",
            "multimodal",
          ],
        },
        summary: { type: "string" },
        reasoning: { type: "string" },
        style: { type: "string" },
        tone: { type: "string" },
        complexity: { type: "string", enum: ["low", "medium", "high"] },
        targetAudience: { type: "string" },
        contentDurationSeconds: { type: ["number", "null"] },
        enhancedPrompt: { type: "string" },
        originalPrompt: { type: "string" },
        totalEstimatedCredits: { type: "integer" },
        totalEstimatedDurationSeconds: { type: "integer" },
        generatedBy: { type: "string" },
        schemaVersion: { type: "string", enum: ["1.0"] },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: [
              "stepId",
              "label",
              "service",
              "endpoint",
              "order",
              "prompt",
              "params",
              "creditCost",
              "estimatedDurationSeconds",
              "critical",
            ],
            properties: {
              stepId: { type: "string" },
              label: { type: "string" },
              service: { type: "string" },
              endpoint: { type: "string" },
              order: { type: "integer", minimum: 1 },
              dependsOn: { type: "string" },
              prompt: { type: "string" },
              params: { type: "object" },
              creditCost: { type: "integer", minimum: 0 },
              estimatedDurationSeconds: { type: "integer", minimum: 1 },
              critical: { type: "boolean" },
            },
          },
        },
      },
    },
  },
} as const;
