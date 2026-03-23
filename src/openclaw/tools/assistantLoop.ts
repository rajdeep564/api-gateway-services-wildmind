import type { ToolRegistration } from "../types";
import { env } from "../../config/env";
import { redisDelSafe, redisGetSafe, redisSetSafe } from "../../config/redisClient";
import { getFallbackSchema, type RequirementSchema } from "../../assistant/requirementSchemas";
import type { PlanTaskType } from "../../orchestrator/planner/plannerTypes";
import { savePlan, getPlan, applyModelOverrides, markApproved, markExecuting } from "../../orchestrator/planStore";
import { readUserCredits } from "../../repository/creditsRepository";
import { createJobStatus } from "../../orchestrator/jobStatusStore";
import { enqueueOrchestrationJob } from "../../orchestrator/jobQueue";
import { MAX_PLAN_COST } from "../types";
import { httpClient } from "../../config/httpClient";
import {
  buildAssistantExecutionPlan,
  getModelsForTask,
  getDefaultModelForTask,
  getModelById,
} from "../../orchestrator/planner/assistantModelRegistry";

type DynamicFieldType = "string" | "number" | "boolean" | "enum";

export type DynamicField = {
  id: string;
  label: string;
  required: boolean;
  type: DynamicFieldType;
  question: string;
  choices?: string[] | null;
  hint?: string | null;
};

export type DynamicSchema = {
  taskType: string;
  displayName: string;
  fields: DynamicField[];
  inferredContext: Record<string, any>;
  isGenerative: boolean;
  isEditRequest: boolean;
  platformFeasible: boolean;
};

function withPrefix(key: string): string {
  const prefix = env.redisPrefix || "";
  return `${prefix}${key}`;
}

function schemaKey(userId: string, sessionId: string): string {
  return withPrefix(`schema:${userId}:${sessionId}`);
}
function answersKey(userId: string, sessionId: string): string {
  return withPrefix(`answers:${userId}:${sessionId}`);
}
function reqMetaKey(userId: string, sessionId: string): string {
  return withPrefix(`reqMeta:${userId}:${sessionId}`);
}
function planPreviewKey(userId: string, sessionId: string): string {
  return withPrefix(`planPreview:${userId}:${sessionId}`);
}

async function completeViaOpenClaw(
  systemPrompt: string,
  userPrompt: string,
  requestId: string,
): Promise<string> {
  const gatewayUrl = env.openclawGatewayUrl || "http://127.0.0.1:18789";
  const gatewayToken = env.openclawGatewayToken;

  const res = await httpClient.post(
    `${gatewayUrl}/v1/chat/completions`,
    {
      model: env.openclawAgentId || "main",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      // Pure completion call – no tools
      tools: [],
      max_tokens: 800,
      temperature: 0.3,
    },
    {
      headers: {
        ...(gatewayToken ? { Authorization: `Bearer ${gatewayToken}` } : {}),
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
      timeout: 30_000,
    },
  );

  return (
    res?.data?.choices?.[0]?.message?.content ??
    res?.data?.choices?.[0]?.text ??
    ""
  );
}

function toDynamicSchema(schema: RequirementSchema, inferredContext: Record<string, any>): DynamicSchema {
  return {
    taskType: schema.taskType,
    displayName: schema.displayName,
    fields: (schema.fields ?? []).map((f) => ({
      id: f.key,
      label: f.label,
      required: Boolean(f.required),
      type: f.type,
      question: f.question,
      choices: f.type === "enum" ? f.options ?? null : null,
      hint: null,
    })),
    inferredContext,
    // For now, everything using this schema is treated as generative and feasible.
    // We’ll refine platformFeasible / edit intent during model-credit alignment.
    isGenerative: true,
    isEditRequest: false,
    platformFeasible: true,
  };
}

function buildDynamicSummary(taskType: string, answers: Record<string, any>): string {
  const lines = Object.entries(answers)
    .filter(([k]) => !k.startsWith("__"))
    .map(([k, v]) => `• ${k.replace(/_/g, " ")}: **${String(v)}**`);
  return `**${taskType.replace(/_/g, " ")} requirements:**\n${lines.join("\n")}`;
}

function normalizeAspectRatio(raw: string | undefined): string {
  if (!raw) return "1:1";
  const v = raw.toLowerCase().trim();
  if (v.includes("portrait") || v === "9:16" || v.includes("vertical")) return "9:16";
  if (v.includes("landscape") || v === "16:9" || v.includes("horizontal") || v.includes("wide")) return "16:9";
  if (v.includes("square") || v === "1:1") return "1:1";
  if (v.includes("4:3")) return "4:3";
  if (v.includes("3:4")) return "3:4";
  if (/^\d+:\d+$/.test(v)) return v;
  return "1:1";
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool 1: generate_requirement_schema
// ─────────────────────────────────────────────────────────────────────────────

export const generateRequirementSchemaTool: ToolRegistration = {
  definition: {
    name: "generate_requirement_schema",
    description: [
      "For any creative generation request, dynamically generate the exact questions needed to gather requirements.",
      "Call this FIRST before gather_requirements.",
      "Stores the schema in server-side agent state (schema:{userId}:{sessionId}).",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Conversation session ID" },
        userMessage: { type: "string", description: "The user's message describing what they want to create" },
      },
      required: ["sessionId", "userMessage"],
    },
  },
  handler: async (args, context) => {
    const sessionId = (args.sessionId as string | undefined) ?? "";
    const userMessage = (args.userMessage as string | undefined) ?? "";
    if (!sessionId || !userMessage.trim()) {
      return { status: "error", message: "generate_requirement_schema requires sessionId and userMessage" };
    }

    const userId = context.userId;

    // Ensure plugin auth is available for this session
    const pluginAuthKey = withPrefix(`pluginAuth:${userId}:${sessionId}`);
    const existingAuth = await redisGetSafe<string>(pluginAuthKey);
    if (!existingAuth && (context as any).token) {
      await redisSetSafe(pluginAuthKey, `Bearer ${(context as any).token}`, 300);
    }

    const schemaSystemPrompt = [
      "You are a creative requirements analyst for WildMind, an AI generation platform.",
      "WildMind can create: images, logos, videos, video ads, music, and do image editing (upscale, background removal, style transfer).",
      "Return ONLY valid JSON. No explanation, no markdown fences.",
    ].join(" ");

    const schemaUserPrompt = [
      `User wants to create: "${userMessage}"`,
      "",
      "Analyze this request and return a JSON object with exactly this shape:",
      "{",
      '  "taskType": "logo|image|video|video_ad|music|image_edit|unknown",',
      '  "isGenerative": true,',
      '  "platformFeasible": true,',
      '  "feasibilityNote": null,',
      '  "inferredContext": { "fieldId": "inferred value for any field you can determine from the message" },',
      '  "fields": [',
      "    {",
      '      "id": "unique_field_id",',
      '      "question": "The exact question to ask the user",',
      '      "type": "text|choice",',
      '      "choices": ["Option 1", "Option 2"] or null,',
      '      "required": true',
      "    }",
      "  ]",
      "}",
      "",
      "Rules:",
      "- Maximum 4 fields total.",
      "- Skip any field whose answer you can already infer from the message.",
      "- Order fields by importance (most critical first).",
      "- For logo: typical fields are brand_name, style, colors, icon_concept.",
      "- For video/video_ad: typical fields are subject_or_brand, style, duration, call_to_action.",
      "- For image: typical fields are subject, style, aspect_ratio.",
      "- For music: typical fields are mood, genre, duration.",
      '- For aspect_ratio fields, choices MUST be exactly: ["1:1 (Square)", "16:9 (Landscape)", "9:16 (Portrait)", "4:3 (Standard)"].',
      '- Never use words like "portrait" or "landscape" alone as the value — always include the ratio.',
      "- Make questions conversational, not form labels.",
      "- If the request is not feasible on WildMind, set platformFeasible: false and explain in feasibilityNote.",
    ].join("\n");

    let raw: string;
    try {
      raw = await completeViaOpenClaw(
        schemaSystemPrompt,
        schemaUserPrompt,
        context.requestId,
      );
    } catch {
      raw = "";
    }

    let parsed: any | null = null;
    if (raw && typeof raw === "string") {
      try {
        const cleaned = raw
          .replace(/```json\s*/gi, "")
          .replace(/```$/g, "")
          .trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = null;
      }
    }

    let dynamicSchema: DynamicSchema;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.taskType === "string" &&
      Array.isArray(parsed.fields)
    ) {
      const requirementSchema: RequirementSchema = {
        taskType: parsed.taskType,
        displayName: parsed.taskType,
        fields: (parsed.fields as any[]).map((f) => ({
          key: String(f.id ?? f.key ?? "field"),
          label: String(f.id ?? f.label ?? "Field"),
          required: Boolean(f.required ?? true),
          type: (f.type === "number" || f.type === "boolean" || f.type === "enum")
            ? f.type
            : "string",
          question: String(f.question ?? "Please provide this detail."),
          options: Array.isArray(f.choices) ? f.choices.map(String) : undefined,
        })),
      };
      const inferredContext =
        (parsed.inferredContext && typeof parsed.inferredContext === "object")
          ? parsed.inferredContext
          : {};
      dynamicSchema = toDynamicSchema(requirementSchema, inferredContext);
      dynamicSchema.isGenerative = parsed.isGenerative ?? true;
      dynamicSchema.isEditRequest = parsed.taskType === "image_edit";
      dynamicSchema.platformFeasible = parsed.platformFeasible ?? true;
    } else {
      // Fallback schema
      const fallback: RequirementSchema = getFallbackSchema("image") ?? {
        taskType: "creative_generation",
        displayName: "Creative Generation",
        fields: [
          {
            key: "subject",
            label: "Subject",
            required: true,
            type: "string",
            question: "Describe what you want to create.",
          },
          {
            key: "style",
            label: "Style or mood",
            required: true,
            type: "string",
            question: "What style or mood should it have?",
          },
        ],
      };
      dynamicSchema = toDynamicSchema(fallback, {});
    }

    // Append model preference field (assistant model registry) so users can pick or ask for a recommendation.
    try {
      const rawType = String(dynamicSchema.taskType || "image").toLowerCase();
      const planTask: PlanTaskType =
        rawType === "video" ? "video" :
        rawType === "music" ? "music" :
        rawType === "voice" ? "voice" :
        rawType === "video_ad" ? "video_ad" :
        rawType === "image_ad" ? "image_ad" :
        rawType === "multimodal" ? "multimodal" :
        // Treat logo/image_edit/unknown as image for model selection
        "image";

      const taskModels = getModelsForTask(planTask);
      if (taskModels.length > 1) {
        dynamicSchema.fields = [
          ...(dynamicSchema.fields ?? []),
          {
            id: "preferred_model",
            label: "Preferred model",
            required: false,
            type: "enum",
            question: `Which model should I use? (or choose "Recommend for me")`,
            choices: [
              "Recommend for me",
              ...taskModels.map((m) => `${m.label} (${m.id}) — ${m.creditCost} credits`),
            ],
            hint: null,
          },
        ];
      }
    } catch {
      // non-fatal: proceed without model choice field
    }

    // Persist schema; reset answers + reqMeta for a clean run
    await redisSetSafe(schemaKey(userId, sessionId), dynamicSchema, 30 * 60);
    await redisSetSafe(answersKey(userId, sessionId), {}, 30 * 60);
    await redisDelSafe(reqMetaKey(userId, sessionId));

    return dynamicSchema;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool 2: gather_requirements (one field at a time)
// ─────────────────────────────────────────────────────────────────────────────

export const gatherRequirementsTool: ToolRegistration = {
  definition: {
    name: "gather_requirements",
    description: [
      "Ask the next requirement question from the dynamically generated schema.",
      "Returns { status: 'question', fieldId, question, choices?, progress } or { status: 'complete', requirements, summary }.",
      "Stores current question + progress in reqMeta:{userId}:{sessionId} for the streaming UI.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Conversation session ID" },
        latestAnswer: {
          type: "object",
          description: "The answer to the last question asked. { fieldId: string, value: string }",
          properties: {
            fieldId: { type: "string" },
            value: { type: "string" },
          },
        } as any,
      },
      required: ["sessionId"],
    },
  },
  handler: async (args, context) => {
    const sessionId = (args.sessionId as string | undefined) ?? "";
    const latestAnswer = args.latestAnswer as { fieldId?: string; value?: string } | undefined;
    if (!sessionId) return { status: "error", message: "gather_requirements requires sessionId" };

    const userId = context.userId;

    const schema = await redisGetSafe<DynamicSchema>(schemaKey(userId, sessionId));
    if (!schema) {
      return { status: "error", message: "No schema found. Call generate_requirement_schema first." };
    }

    const collected = (await redisGetSafe<Record<string, any>>(answersKey(userId, sessionId))) ?? {};
    const allCollected = { ...(schema.inferredContext ?? {}), ...collected };

    if (latestAnswer?.fieldId && typeof latestAnswer.value === "string") {
      allCollected[latestAnswer.fieldId] = latestAnswer.value;
      await redisSetSafe(answersKey(userId, sessionId), allCollected, 30 * 60);
    }

    const fields = schema.fields ?? [];
    const requiredFields = fields.filter((f) => f.required);
    const optionalFields = fields.filter((f) => !f.required);
    const allFields = [...requiredFields, ...optionalFields];

    const nextField = allFields.find((f) => !(f.id in allCollected));
    const answeredCount = allFields.filter((f) => f.id in allCollected).length;
    const totalCount = allFields.length;
    const progress = {
      answered: answeredCount,
      total: totalCount,
      percent: totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 100,
    };

    if (!nextField) {
      await redisDelSafe(reqMetaKey(userId, sessionId));
      return {
        status: "complete",
        taskType: schema.taskType,
        isGenerative: schema.isGenerative,
        isEditRequest: schema.isEditRequest,
        requirements: allCollected,
        summary: buildDynamicSummary(schema.taskType, allCollected),
        progress,
      };
    }

    const meta = {
      status: "question",
      fieldId: nextField.id,
      question: nextField.question,
      type: nextField.type,
      choices: nextField.choices ?? null,
      hint: nextField.hint ?? null,
      progress,
    };
    await redisSetSafe(reqMetaKey(userId, sessionId), meta, 30 * 60);

    return meta;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool 3: preview_plan
// ─────────────────────────────────────────────────────────────────────────────

export const previewPlanTool: ToolRegistration = {
  definition: {
    name: "preview_plan",
    description: [
      "Generate a WildMind execution plan from gathered requirements and store it for UI rendering.",
      "Writes plan preview to planPreview:{userId}:{sessionId} so /api/assistant/stream can emit plan_ready.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Conversation session ID" },
        requirements: { type: "object", description: "Collected requirement answers" },
        modelOverrides: { type: "object", description: "Optional per-step model overrides" },
      },
      required: ["sessionId", "requirements"],
    },
  },
  handler: async (args, context) => {
    const sessionId = (args.sessionId as string | undefined) ?? "";
    const requirements = (args.requirements as Record<string, any> | undefined) ?? null;
    const modelOverrides = (args.modelOverrides as Record<string, string> | undefined) ?? {};
    if (!sessionId || !requirements) {
      return { status: "error", message: "preview_plan requires sessionId and requirements" };
    }

    const userId = context.userId;
    const schema = await redisGetSafe<DynamicSchema>(schemaKey(userId, sessionId));
    const taskTypeRaw =
      (schema?.taskType ?? (requirements.taskType as string | undefined) ?? "image") as string;
    const taskType = ((): PlanTaskType => {
      const t = String(taskTypeRaw || "image").toLowerCase();
      if (t === "video") return "video";
      if (t === "music") return "music";
      if (t === "voice") return "voice";
      if (t === "video_ad") return "video_ad";
      if (t === "image_ad") return "image_ad";
      if (t === "multimodal") return "multimodal";
      return "image";
    })();

    // Convert requirements into a planner prompt + pass spec for deterministic planning
    const prompt = buildDynamicSummary(taskType, requirements);
    // Registry-driven assistant plan (single source of truth)
    const preferredModelId =
      typeof (requirements as any)?.preferred_model === "string"
        ? String((requirements as any).preferred_model)
        : null;

    // Allow "Recommend for me" / "recommend" to fall back to default selection.
    const extractedId = (() => {
      if (!preferredModelId) return null;
      const m = preferredModelId.match(/\(([^)]+)\)/);
      if (m && m[1]) return String(m[1]).trim();
      return preferredModelId;
    })();
    const normalizedPreferred =
      extractedId && /recommend/i.test(extractedId) ? null : extractedId;

    const executionPlan = buildAssistantExecutionPlan({
      taskType,
      prompt,
      requirements: {
        ...requirements,
        ...(typeof (requirements as any)?.aspect_ratio === "string"
          ? { aspect_ratio: normalizeAspectRatio((requirements as any).aspect_ratio) }
          : {}),
      },
      modelId: normalizedPreferred,
    });

    const total = executionPlan.totalEstimatedCredits ?? 0;
    if (total > MAX_PLAN_COST) {
      return { status: "error", message: `Plan cost (${total} credits) exceeds maximum allowed (${MAX_PLAN_COST}).` };
    }

    // Save in plan store (approval flow) and write preview blob for streaming endpoint
    const planId = savePlan(userId, executionPlan, modelOverrides);

    const preview = {
      ok: true,
      planId,
      plan: executionPlan,
      taskType: executionPlan.taskType,
      totalEstimatedCredits: executionPlan.totalEstimatedCredits ?? 0,
      totalEstimatedDurationSeconds: executionPlan.totalEstimatedDurationSeconds ?? null,
    };

    await redisSetSafe(planPreviewKey(userId, sessionId), preview, 10 * 60);

    return preview;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool 4: execute_plan
// ─────────────────────────────────────────────────────────────────────────────

export const executePlanTool: ToolRegistration = {
  definition: {
    name: "execute_plan",
    description: [
      "Approve and execute a previously previewed plan. NEVER call without explicit user approval.",
      "Performs credit check and enqueues orchestrator job.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Conversation session ID" },
        planId: { type: "string", description: "Plan ID returned by preview_plan" },
        modelOverrides: { type: "object", description: "Optional per-step model overrides" },
      },
      required: ["sessionId", "planId"],
    },
  },
  handler: async (args, context) => {
    const sessionId = (args.sessionId as string | undefined) ?? "";
    let planId = (args.planId as string | undefined) ?? "";
    const modelOverrides = (args.modelOverrides as Record<string, string> | undefined) ?? {};
    const userId = context.userId;

    if (!sessionId || !planId) {
      // Fallback: try approvedPlanId key written by /api/assistant/stream
      const approvedKey = withPrefix(`approvedPlanId:${userId}:${sessionId}`);
      try {
        const saved = await redisGetSafe<string | null>(approvedKey);
        if (saved) {
          planId = saved;
          await redisDelSafe(approvedKey);
        }
      } catch {
        // ignore
      }
    }

    if (!sessionId || !planId) {
      return {
        status: "error",
        code: "NO_PLAN_ID",
        message: "No plan to execute. Please create and approve a plan first.",
      };
    }

    const entry = getPlan(planId);
    if (!entry) return { status: "error", code: "PLAN_NOT_FOUND", message: "Plan not found or expired." };
    if (entry.userId !== userId) return { status: "error", code: "FORBIDDEN", message: "You do not own this plan." };
    if (entry.status !== "awaiting_approval") {
      return { status: "error", code: "INVALID_STATE", message: `Plan is in state "${entry.status}".` };
    }

    const plan = entry.executionPlan;
    const requiredCredits = plan.totalEstimatedCredits ?? 0;
    if (requiredCredits > MAX_PLAN_COST) {
      return { status: "error", code: "PLAN_COST_EXCEEDED", message: "Plan cost exceeds maximum allowed." };
    }

    const userCredits = await readUserCredits(userId);
    if (userCredits < requiredCredits) {
      return {
        status: "error",
        code: "INSUFFICIENT_CREDITS",
        message: `This plan requires ${requiredCredits} credits, but you only have ${userCredits}.`,
      };
    }

    if (modelOverrides && typeof modelOverrides === "object") {
      applyModelOverrides(planId, modelOverrides);
    }

    // Mark approved + enqueue orchestrator job (same semantics as controller)
    markApproved(planId);
    const job = await createJobStatus(userId, plan.originalPrompt ?? "");

    const payload: any = {
      jobId: job.jobId,
      userId,
      prompt: plan.originalPrompt ?? "",
      token: context.token,
      hints: {
        preBuiltPlan: plan,
        modelOverrides: entry.modelOverrides,
        skipModelSelection: true,
      },
    };

    await enqueueOrchestrationJob(payload);
    markExecuting(planId);

    // Clear any plan preview blob so UI doesn't render stale cards later
    await redisDelSafe(planPreviewKey(userId, sessionId));

    // Write job info to Redis so /api/assistant/stream can emit job_queued SSE event
    const jobQueuedKeyStr = withPrefix(`jobQueued:${userId}:${sessionId}`);
    await redisSetSafe(
      jobQueuedKeyStr,
      {
        jobId: job.jobId,
        planId,
        status: "queued",
        message: "Your generation has started. Check history for results.",
      },
      60,
    );

    return {
      ok: true,
      status: "queued",
      planId,
      jobId: job.jobId,
      message: "Plan approved. Generation started.",
    };
  },
};

