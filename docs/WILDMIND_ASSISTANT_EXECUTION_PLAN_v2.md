# WildMind High-Level AI Assistant — Updated Execution Plan v2
# Changes from v1: AI-driven intent + dynamic schemas + streaming agent states + thinking UI

---

## What Changed From v1

| v1 | v2 |
|---|---|
| Frontend detects generative vs non-generative | OpenClaw decides everything — frontend sends all messages blindly |
| Hardcoded REQUIRED_FIELDS per taskType | AI generates the requirement schema dynamically per request |
| Static tool results returned silently | Backend streams agent state events: thinking / calling_tool / planning / executing |
| No UI feedback during tool loop | UI shows animated thinking, tool call indicators, plan cards — like Claude |

---

## Architecture Overview (v2)

```
User types anything
    ↓
POST /api/assistant/stream   ← NEW: SSE streaming endpoint
    ↓ Server-Sent Events
    ├── { event: "thinking",      data: { text: "Analyzing your request..." } }
    ├── { event: "tool_call",     data: { tool: "generate_requirement_schema", status: "calling" } }
    ├── { event: "tool_result",   data: { tool: "generate_requirement_schema", status: "done" } }
    ├── { event: "tool_call",     data: { tool: "gather_requirements", status: "calling" } }
    ├── { event: "assistant_message", data: { content: "What is the brand name?" } }
    ├── ... more turns ...
    ├── { event: "tool_call",     data: { tool: "preview_plan", status: "calling" } }
    ├── { event: "plan_ready",    data: { planId, steps, totalCredits, userCredits } }
    └── { event: "done" }
```

OpenClaw drives 100% of the logic. The frontend just renders whatever state events arrive.

---

## Phase 1: Fix OpenClaw Config (unchanged from v1, do first)

**File:** `services/openclaw-gateway/openclaw.config.example.json`

Update `alsoAllow` to actual tool names:

```json
"agents": {
  "defaults": {
    "workspace": "~/.openclaw/workspace",
    "model": {
      "primary": "openai/gpt-5.2"
    }
  },
  "list": [
    {
      "id": "main",
      "identity": {
        "name": "WildMind Agent Runtime",
        "theme": "Creative orchestration layer for WildMind",
        "emoji": "WM"
      },
      "tools": {
        "alsoAllow": [
          "generate_requirement_schema",
          "gather_requirements",
          "preview_plan",
          "execute_plan",
          "get_recent_generations",
          "get_user_assets",
          "get_asset",
          "delete_asset",
          "edit_image",
          "upscale_image",
          "remove_background",
          "get_credit_balance",
          "upgrade_plan",
          "search_similar_creations",
          "navigate_page"
        ]
      }
    }
  ]
}
```

---

## Phase 2: New Streaming Backend Endpoint

### 2.1 New route: `POST /api/assistant/stream`

**File:** `src/routes/assistant.ts` — add alongside existing `/chat` route.

This endpoint proxies to OpenClaw but also intercepts tool call events and re-emits them as SSE to the frontend.

```typescript
import { Response } from "express";
import { redisClient } from "../config/redisClient";
import { readUserCredits } from "../repositories/creditsRepository";

router.post("/stream", requireAuth, async (req, res) => {
  const userId = (req as any).uid as string;
  const requestId = (req as any).requestId ?? `req-${Date.now()}`;
  const { message, sessionId } = req.body ?? {};

  if (!message?.trim() || !sessionId) {
    res.status(400).json({ ok: false, error: "MISSING_PARAMS" });
    return;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // Force flush if available
    if ((res as any).flush) (res as any).flush();
  };

  const sessionKey = `${userId}:${sessionId}`;

  try {
    const user = await authRepository.getUserById(userId);
    const displayName = user?.displayName?.trim() || null;
    const now = new Date();

    let userCredits: number | null = null;
    try {
      const credits = await readUserCredits(userId);
      userCredits = credits?.credits ?? null;
    } catch {}

    const systemPrompt = buildOpenClawSystemPrompt(displayName, now, userCredits);

    const userAuthHeader =
      (req.headers.authorization as string) ??
      ((req.headers as any).Authorization as string);
    const gatewayAuthHeader = env.openclawGatewayToken
      ? `Bearer ${env.openclawGatewayToken}`
      : undefined;
    const gatewayUrl = env.openclawGatewayUrl || "http://127.0.0.1:18789";

    // Emit initial thinking state
    send("thinking", { text: "Thinking…", phase: "start" });

    // Call OpenClaw — use streaming if available, otherwise regular call
    // and synthesize events from tool_calls in the response
    const ocRes = await httpClient.post(
      `${gatewayUrl}/v1/chat/completions`,
      {
        model: env.openclawAgentId || "main",
        user: sessionKey,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message.trim() },
        ],
        // Request tool call details in response
        stream: false,
      },
      {
        headers: {
          ...(gatewayAuthHeader ? { Authorization: gatewayAuthHeader } : {}),
          ...(userAuthHeader ? { "x-wildmind-user-authorization": userAuthHeader } : {}),
          "x-wildmind-session-key": sessionKey,
          "x-openclaw-agent-id": env.openclawAgentId || "main",
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
        timeout: 120_000,
      }
    );

    // Extract tool call trace from response if OpenClaw provides it
    const rawData = ocRes?.data;
    const toolCallTrace: Array<{ name: string; status: string; result?: any }> =
      rawData?.tool_call_trace ?? rawData?.usage?.tool_calls ?? [];

    // Emit tool call events from trace
    for (const tc of toolCallTrace) {
      send("tool_call", {
        tool: tc.name,
        status: tc.status ?? "called",
        label: TOOL_LABELS[tc.name] ?? tc.name
      });
    }

    // Check for plan data in Redis (written by preview_plan tool)
    const planPreviewKey = `planPreview:${userId}:${sessionId}`;
    let planData: any = null;
    try {
      const cached = await redisClient.get(planPreviewKey);
      if (cached) {
        planData = JSON.parse(cached);
        await redisClient.del(planPreviewKey);
      }
    } catch {}

    const content =
      rawData?.choices?.[0]?.message?.content ?? "";

    // Emit the assistant message
    send("assistant_message", { content });

    // If plan data is present, emit separately so frontend can render plan card
    if (planData) {
      send("plan_ready", planData);
    }

    send("done", {});
    res.end();

  } catch (err: any) {
    const is502 = err?.response?.status >= 500;
    send("error", {
      code: is502 ? "OPENCLAW_UNAVAILABLE" : "INTERNAL_ERROR",
      message: err?.message ?? "Failed"
    });
    res.end();
  }
});

// Human-readable labels for tool names shown in the UI
const TOOL_LABELS: Record<string, string> = {
  generate_requirement_schema: "Analyzing your request",
  gather_requirements:         "Collecting requirements",
  preview_plan:                "Building your plan",
  execute_plan:                "Starting generation",
  get_recent_generations:      "Loading your history",
  get_credit_balance:          "Checking credits",
  get_user_assets:             "Loading assets",
  get_asset:                   "Fetching asset",
  edit_image:                  "Editing image",
  upscale_image:               "Upscaling image",
  remove_background:           "Removing background",
  delete_asset:                "Deleting asset",
  search_similar_creations:    "Searching similar work",
  navigate_page:               "Navigating"
};
```

**Note on streaming:** If OpenClaw supports SSE streaming (`stream: true`), switch to a chunked proxy loop that parses `data:` lines and emits events in real time. The pattern above (batch + reconstruct) works without streaming support. Add streaming as an enhancement once the batch path is working.

---

## Phase 3: Dynamic Requirement Schema Tool (AI-generated schemas)

This replaces the hardcoded `REQUIRED_FIELDS` from v1. Instead, the AI generates the right questions for any creative request.

### 3.1 New tool: `generate_requirement_schema`

**File:** `src/openclaw/tools/assistantLoop.ts`

```typescript
import { completeText } from "../../modelGateway/modelGateway";
import { agentStateStore } from "../../state/agentStateStore";

// ─── TOOL 0: generate_requirement_schema ────────────────────────────────────
//
// OpenClaw calls this FIRST for any creative request.
// The AI (via WildMind's model gateway) generates a tailored list of questions
// for exactly what the user wants. No hardcoded schemas.
//
// Returns: { taskType, fields[], prompt_template }
// OpenClaw then uses gather_requirements with these dynamic fields.

export const generateRequirementSchemaTool: ToolRegistration = {
  definition: {
    name: "generate_requirement_schema",
    description: [
      "For any creative generation request, dynamically generate the exact questions",
      "needed to gather sufficient requirements. Call this FIRST before gather_requirements.",
      "Returns a list of fields with questions tailored to the specific request.",
      "The schema adapts to what the user asked for — a brand logo needs different",
      "questions than a product video ad or a meditation music track."
    ].join(" "),
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sessionId: { type: "string" },
        userMessage: {
          type: "string",
          description: "The full user message describing what they want to create."
        },
        platformCapabilities: {
          type: "string",
          description: "Optional hint about what the platform supports."
        }
      },
      required: ["sessionId", "userMessage"]
    }
  },
  handler: async (args, context: AgentContext) => {
    const { sessionId, userMessage } = args as any;

    const schemaPrompt = `You are a creative AI assistant for WildMind, a platform that generates images, logos, videos, music, and visual ads.

A user sent this message: "${userMessage}"

WildMind can create:
- Images (photorealistic, artistic, any style)
- Logos (brand identity, icon + wordmark)
- Videos (text-to-video, cinematic, short-form content)
- Video Ads (branded commercial content with CTA)
- Music (background music, jingles, soundscapes)
- Image editing (upscale, background removal, style transfer)

Determine:
1. What type of creative task this is (be specific — e.g. "brand_logo", "product_image", "social_video", "cinematic_video", "music_jingle", "background_music", "image_upscale", etc.)
2. What information is ACTUALLY NEEDED to execute this well (not generic — think about what a professional creative director would ask)
3. What information can be INFERRED from the message already (pre-fill these)

Return ONLY valid JSON, no explanation:
{
  "taskType": "string (specific task type)",
  "isGenerative": true/false,
  "isEditRequest": true/false,
  "inferredContext": { "field": "inferred_value" },
  "fields": [
    {
      "id": "field_id",
      "question": "The exact question to ask the user",
      "type": "text|choice|boolean",
      "choices": ["option1", "option2"] or null,
      "required": true/false,
      "hint": "Why this matters for generation quality"
    }
  ],
  "maxFields": 5,
  "platformFeasible": true/false,
  "feasibilityNote": "string if not feasible, else null"
}

Rules:
- Max 5 fields (people don't want interrogations)
- Skip fields where you can infer from the message
- Order by importance (most critical first)
- Make questions conversational, not form-like
- If isEditRequest is true, fields should focus on what asset and what change
- If not platformFeasible, explain why`;

    try {
      const raw = await completeText({
        messages: [{ role: "user", content: schemaPrompt }],
        maxTokens: 800,
        temperature: 0.3,
        model: "gpt-4o-mini", // fast + cheap for schema generation
        promptVersion: "schema-gen-v1"
      });

      // Parse and validate
      const cleaned = raw.replace(/```json\n?|```/g, "").trim();
      const schema = JSON.parse(cleaned);

      // Validate shape
      if (!schema.taskType || !Array.isArray(schema.fields)) {
        throw new Error("Invalid schema shape");
      }

      // Cap at maxFields (safety)
      schema.fields = schema.fields.slice(0, schema.maxFields ?? 5);

      // Remove already-inferred fields from the question list
      if (schema.inferredContext) {
        schema.fields = schema.fields.filter(
          (f: any) => !(f.id in schema.inferredContext)
        );
      }

      // Save schema to agent state for gather_requirements to use
      const schemaKey = `schema:${context.userId}:${sessionId}`;
      await agentStateStore.set(schemaKey, schema);

      return {
        taskType: schema.taskType,
        isGenerative: schema.isGenerative,
        isEditRequest: schema.isEditRequest,
        platformFeasible: schema.platformFeasible !== false,
        feasibilityNote: schema.feasibilityNote ?? null,
        totalQuestions: schema.fields.length,
        inferredContext: schema.inferredContext ?? {},
        fields: schema.fields
      };

    } catch (err: any) {
      // Fallback: return a minimal generic schema
      const fallbackSchema = {
        taskType: "creative_generation",
        isGenerative: true,
        fields: [
          { id: "subject", question: "Describe in detail what you want to create.", type: "text", required: true },
          { id: "style", question: "What style or mood should it have?", type: "text", required: true },
          { id: "usage", question: "Where will you use this?", type: "text", required: false }
        ]
      };
      const schemaKey = `schema:${context.userId}:${sessionId}`;
      await agentStateStore.set(schemaKey, fallbackSchema);
      return fallbackSchema;
    }
  }
};
```

### 3.2 Updated `gather_requirements` tool (uses dynamic schema)

Replace the hardcoded version from v1:

```typescript
export const gatherRequirementsTool: ToolRegistration = {
  definition: {
    name: "gather_requirements",
    description: [
      "Ask the next requirement question from the dynamically generated schema.",
      "Call generate_requirement_schema FIRST to get the schema.",
      "Then call gather_requirements for each turn, passing answers collected so far.",
      "Returns { status: 'question', question, progress } or { status: 'complete', requirements }."
    ].join(" "),
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sessionId: { type: "string" },
        latestAnswer: {
          type: "object",
          description: "The answer to the last question asked. { fieldId: string, value: string }",
          properties: {
            fieldId: { type: "string" },
            value: { type: "string" }
          }
        }
      },
      required: ["sessionId"]
    }
  },
  handler: async (args, context: AgentContext) => {
    const { sessionId, latestAnswer } = args as any;
    const userId = context.userId;

    // Load the dynamic schema generated by generate_requirement_schema
    const schemaKey = `schema:${userId}:${sessionId}`;
    const schema = await agentStateStore.get(schemaKey);
    if (!schema) {
      return {
        status: "error",
        message: "No schema found. Call generate_requirement_schema first."
      };
    }

    // Load collected answers
    const answersKey = `answers:${userId}:${sessionId}`;
    const collected: Record<string, any> = await agentStateStore.get(answersKey) ?? {};

    // Merge pre-inferred context
    const allCollected = { ...schema.inferredContext, ...collected };

    // Save new answer if provided
    if (latestAnswer?.fieldId && latestAnswer?.value) {
      allCollected[latestAnswer.fieldId] = latestAnswer.value;
      await agentStateStore.set(answersKey, allCollected);
    }

    // Find next unanswered required/important field
    const fields: Array<any> = schema.fields ?? [];
    const requiredFields = fields.filter((f: any) => f.required);
    const optionalFields = fields.filter((f: any) => !f.required);
    const allFields = [...requiredFields, ...optionalFields];

    const nextField = allFields.find((f: any) => !(f.id in allCollected));

    if (!nextField) {
      // All fields answered — complete
      return {
        status: "complete",
        taskType: schema.taskType,
        isGenerative: schema.isGenerative,
        isEditRequest: schema.isEditRequest,
        requirements: allCollected,
        summary: buildDynamicSummary(schema.taskType, allCollected)
      };
    }

    const answeredCount = allFields.filter((f: any) => f.id in allCollected).length;
    const totalCount = allFields.length;

    return {
      status: "question",
      fieldId: nextField.id,
      question: nextField.question,
      type: nextField.type,
      choices: nextField.choices ?? null,
      hint: nextField.hint ?? null,
      progress: {
        answered: answeredCount,
        total: totalCount,
        percent: Math.round((answeredCount / totalCount) * 100)
      }
    };
  }
};

function buildDynamicSummary(taskType: string, answers: Record<string, any>): string {
  const lines = Object.entries(answers)
    .filter(([k]) => !k.startsWith('__'))
    .map(([k, v]) => `• ${k.replace(/_/g, ' ')}: **${v}**`);
  return `**${taskType.replace(/_/g, ' ')} requirements:**\n${lines.join('\n')}`;
}
```

### 3.3 `preview_plan` tool (same as v1, minor update for dynamic schema)

Same implementation as v1. One addition: pass `schema.taskType` (from the dynamic schema) into `generateExecutionPlan` hints.

### 3.4 `execute_plan` tool

Identical to v1. No changes needed.

### 3.5 Register all four tools

**File:** `src/openclaw/tools/index.ts`

```typescript
import {
  generateRequirementSchemaTool,
  gatherRequirementsTool,
  previewPlanTool,
  executePlanTool
} from "./assistantLoop";

registerTool(generateRequirementSchemaTool);
registerTool(gatherRequirementsTool);
registerTool(previewPlanTool);
registerTool(executePlanTool);
```

---

## Phase 4: System Prompt v2 (AI decides everything)

**File:** `src/routes/assistant.ts` — `buildOpenClawSystemPrompt`

```typescript
function buildOpenClawSystemPrompt(
  userDisplayName: string | null,
  now: Date,
  userCredits?: number | null
): string {
  const name = userDisplayName ? `The user's name is ${userDisplayName}.` : "";
  const time = now.toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
  const credits = userCredits != null
    ? `The user currently has ${userCredits} credits.`
    : "";

  return `You are the WildMind AI Assistant — the intelligent creative layer of WildMind.
${name} Current time: ${time}. ${credits}

## WHAT WILDMIND CAN DO
WildMind generates:
- Images & Logos (GPT Image 1.5, Seedream v4.5, Flux 2 Pro, z-image-turbo, P-Image)
- Videos (Google Veo 3.1, Sora 2 Pro, Kling 2.6 Pro, Runway Gen 4, Wan 2.5, Seedance Pro, LTX V2)
- Music (MiniMax Music 2.0)
- Image editing: upscale, remove background, style transfer, prompt-based editing

WildMind also provides: generation history, asset management, credit balance, plan upgrades.

## YOUR DECISION FRAMEWORK
You decide everything. There is no separate routing logic. For every user message you must:

1. CLASSIFY: Is this a creative request, an account/history question, an edit request, or conversation?
2. ACT accordingly using the tool sequence below.

---

## FOR CREATIVE / GENERATION REQUESTS
When a user wants to create anything new:

### Step 1 — Generate schema
Immediately call generate_requirement_schema with the user's message.
This tool will tell you:
- Exactly what task type this is
- Whether it's feasible on WildMind
- What questions to ask
- What can already be inferred

If platformFeasible is false: tell the user clearly and offer the closest alternative.

### Step 2 — Gather requirements (one at a time)
Call gather_requirements with no latestAnswer for the first question.
Present EXACTLY the question the tool returns. Nothing more.
For choice-type fields, present choices as a numbered list.
Show progress naturally: e.g. "Quick question (2 of 4):"

### Step 3 — After each user reply
Call gather_requirements with latestAnswer: { fieldId, value: userReply }.
Continue until status is "complete".

### Step 4 — Confirm before planning
When status is "complete", show the summary from the tool and ask:
"Does this look right? I'll build the generation plan."
(If user says yes or gives no objection, proceed.)

### Step 5 — Build the plan
Call preview_plan with the requirements.
Format the result as a clean plan card (the frontend renders this specially).
Always show: what will be generated, which model, credit cost per step, total, user's balance.
End with: "Approve to start generation, or tell me what to change."

### Step 6 — Execute only on approval
User says yes / approve / go / looks good / proceed → call execute_plan.
User says no / change / modify → go back to step 2 for that field.
NEVER call execute_plan without explicit approval.

### Step 7 — Report
When execute_plan returns:
- Completed: "✓ Done! Your [task] has been saved to your history."
- Queued: "Your generation is running. Check History in a few moments."

---

## FOR ACCOUNT / HISTORY QUESTIONS
No schema. No planning. Just call the tool and answer.

Examples:
- "my credits" → get_credit_balance → answer
- "show my recent images" → get_recent_generations(type: "image", limit: 5) → answer
- "my last video" → get_recent_generations(type: "video", limit: 1) → answer
- "show my assets" → get_user_assets → answer

---

## FOR EDIT REQUESTS
- "upscale my last image" → get_recent_generations → confirm which → upscale_image
- "remove background from [asset]" → get_asset or get_recent_generations → remove_background
- "edit this image: [description]" → get the asset → edit_image

---

## RULES
- Use tools. Never invent generation results.
- One question at a time. Never bundle questions.
- Show credits cost before every execution.
- Use only WildMind's actual models listed above.
- Be concise. No filler. No apologies.
- Think before acting. If a request is ambiguous, ask ONE clarifying question before calling any generation tools.
`;
}
```

---

## Phase 5: Frontend — Streaming UI With Agent States

This is where the "thinking like Claude" experience lives.

### 5.1 New frontend hook: `useAssistantStream`

**New file:** `wild/src/hooks/useAssistantStream.ts`

```typescript
import { useState, useCallback, useRef } from 'react';

export type AgentStateType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'plan_ready'
  | 'assistant_message'
  | 'error'
  | 'done';

export interface AgentEvent {
  id: string;
  type: AgentStateType;
  data: any;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentEvents?: AgentEvent[];   // tool calls / thinking that led to this message
  planData?: PlanData | null;
}

export interface PlanData {
  planId: string;
  taskType: string;
  summary: string;
  steps: PlanStep[];
  totalEstimatedCredits: number;
  userCredits: number | null;
  canAfford: boolean | null;
}

export interface PlanStep {
  stepId: string;
  label: string;
  selectedModel: { modelId: string; label: string; provider: string; creditCost: number };
  creditCost: number;
}

export function useAssistantStream(sessionId: string, getAuthHeaders: () => Record<string, string>) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentAgentEvents, setCurrentAgentEvents] = useState<AgentEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (isStreaming) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text
    };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    setCurrentAgentEvents([]);

    const abort = new AbortController();
    abortRef.current = abort;

    const accumulatedEvents: AgentEvent[] = [];
    let assistantContent = '';
    let planData: PlanData | null = null;

    try {
      const res = await fetch('/api/assistant/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ message: text, sessionId }),
        signal: abort.signal
      });

      if (!res.ok || !res.body) throw new Error('Stream failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7).trim() as AgentStateType;
            continue; // next line has data
          }
          if (line.startsWith('data: ')) {
            try {
              // Parse the last seen event type from accumulated lines
              const eventLines = buffer.length > 0
                ? lines
                : [...lines, line];

              // Find the event type for this data line
              // (SSE parser: event type comes before data)
              // Simple approach: track event type
            } catch {}
          }
        }

        // Better SSE parser
        const fullBuffer = lines.join('\n');
        const eventBlocks = fullBuffer.split('\n\n');
        for (const block of eventBlocks) {
          if (!block.trim()) continue;
          const eventLine = block.split('\n').find(l => l.startsWith('event: '));
          const dataLine = block.split('\n').find(l => l.startsWith('data: '));
          if (!eventLine || !dataLine) continue;

          const eventType = eventLine.slice(7).trim() as AgentStateType;
          let data: any;
          try { data = JSON.parse(dataLine.slice(6)); } catch { continue; }

          const event: AgentEvent = {
            id: `${eventType}-${Date.now()}-${Math.random()}`,
            type: eventType,
            data,
            timestamp: Date.now()
          };

          switch (eventType) {
            case 'thinking':
            case 'tool_call':
            case 'tool_result':
              accumulatedEvents.push(event);
              setCurrentAgentEvents([...accumulatedEvents]);
              break;

            case 'plan_ready':
              planData = data;
              accumulatedEvents.push(event);
              setCurrentAgentEvents([...accumulatedEvents]);
              break;

            case 'assistant_message':
              assistantContent = data.content ?? '';
              break;

            case 'error':
              assistantContent = data.message ?? 'Something went wrong. Please try again.';
              break;

            case 'done':
              break;
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        assistantContent = 'Assistant temporarily unavailable. Please try again.';
      }
    }

    // Add final assistant message with all events that led to it
    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: assistantContent,
      agentEvents: [...accumulatedEvents],
      planData
    };
    setMessages(prev => [...prev, assistantMsg]);
    setCurrentAgentEvents([]);
    setIsStreaming(false);
  }, [isStreaming, sessionId, getAuthHeaders]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setCurrentAgentEvents([]);
  }, []);

  return { messages, sendMessage, isStreaming, currentAgentEvents, abort };
}
```

### 5.2 New SSE parser helper

The SSE parser above has a flaw in the streaming loop. Use this cleaner version:

**New file:** `wild/src/utils/sseParser.ts`

```typescript
export type SSEEvent = { type: string; data: any };

export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEventType = 'message';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split('\n');
        let eventType = 'message';
        let dataStr = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          if (line.startsWith('data: ')) dataStr = line.slice(6);
        }

        if (!dataStr) continue;
        try {
          yield { type: eventType, data: JSON.parse(dataStr) };
        } catch {}
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

Update `useAssistantStream` to use `parseSSEStream`:

```typescript
// Replace the stream reading loop with:
for await (const event of parseSSEStream(res.body!)) {
  const agentEvent: AgentEvent = {
    id: `${event.type}-${Date.now()}`,
    type: event.type as AgentStateType,
    data: event.data,
    timestamp: Date.now()
  };

  switch (event.type) {
    case 'thinking':
    case 'tool_call':
      accumulatedEvents.push(agentEvent);
      setCurrentAgentEvents([...accumulatedEvents]);
      break;
    case 'plan_ready':
      planData = event.data;
      accumulatedEvents.push(agentEvent);
      break;
    case 'assistant_message':
      assistantContent = event.data.content ?? '';
      break;
    case 'error':
      assistantContent = event.data.message ?? 'Something went wrong.';
      break;
    case 'done':
      break;
  }
}
```

---

## Phase 6: UI Components

### 6.1 `AgentStateDisplay` — the "thinking" animated panel

**New file:** `wild/src/app/view/HomePage/compo/AgentStateDisplay.tsx`

This shows during streaming: animated thinking dots, tool call pills, progress.

```tsx
'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Wrench, ChevronRight, Loader2 } from 'lucide-react';
import type { AgentEvent } from '@/hooks/useAssistantStream';

interface Props {
  events: AgentEvent[];
  isStreaming: boolean;
}

const TOOL_ICONS: Record<string, string> = {
  generate_requirement_schema: '🧠',
  gather_requirements:         '📋',
  preview_plan:                '📐',
  execute_plan:                '⚡',
  get_recent_generations:      '🖼️',
  get_credit_balance:          '💳',
  get_user_assets:             '📁',
  edit_image:                  '✏️',
  upscale_image:               '⬆️',
  remove_background:           '🪄',
  search_similar_creations:    '🔍',
};

const TOOL_LABELS: Record<string, string> = {
  generate_requirement_schema: 'Analyzing your request',
  gather_requirements:         'Collecting requirements',
  preview_plan:                'Building generation plan',
  execute_plan:                'Starting generation',
  get_recent_generations:      'Loading your history',
  get_credit_balance:          'Checking credits',
  get_user_assets:             'Loading assets',
  edit_image:                  'Editing image',
  upscale_image:               'Upscaling image',
  remove_background:           'Removing background',
  search_similar_creations:    'Searching similar work',
};

export function AgentStateDisplay({ events, isStreaming }: Props) {
  if (!isStreaming && events.length === 0) return null;

  const toolEvents = events.filter(e => e.type === 'tool_call');
  const isThinking = isStreaming && toolEvents.length === 0;
  const lastToolEvent = toolEvents[toolEvents.length - 1];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex items-start gap-2.5 px-1"
    >
      {/* AI avatar */}
      <div className="shrink-0 w-6 h-6 flex items-center justify-center mt-0.5">
        <img src="/core/logosquare.png" alt="AI" width={20} height={20}
          className="rounded-sm opacity-80" />
      </div>

      {/* State content */}
      <div className="flex flex-col gap-1.5 min-w-0">

        {/* Thinking state */}
        {isThinking && (
          <motion.div
            className="flex items-center gap-2 text-zinc-400 text-[13px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          >
            <ThinkingDots />
            <span>Thinking…</span>
          </motion.div>
        )}

        {/* Tool call pills */}
        {toolEvents.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {toolEvents.map((e, i) => {
              const isDone = i < toolEvents.length - 1 || !isStreaming;
              const label = TOOL_LABELS[e.data.tool] ?? e.data.tool;
              const icon = TOOL_ICONS[e.data.tool] ?? '⚙️';
              return (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.08 }}
                  className={`
                    flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px]
                    border transition-colors duration-300
                    ${isDone
                      ? 'bg-zinc-800/60 border-zinc-700 text-zinc-400'
                      : 'bg-violet-500/10 border-violet-500/30 text-violet-300'}
                  `}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                  {!isDone && (
                    <Loader2 className="w-3 h-3 animate-spin ml-0.5" />
                  )}
                  {isDone && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="text-emerald-400 text-[10px] ml-0.5"
                    >
                      ✓
                    </motion.span>
                  )}
                </motion.div>
              );
            })}

            {/* Still running indicator */}
            {isStreaming && (
              <motion.div
                className="flex items-center gap-1 text-zinc-500 text-[12px] pl-1"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                <ThinkingDots small />
              </motion.div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ThinkingDots({ small = false }: { small?: boolean }) {
  return (
    <div className={`flex items-center gap-[3px] ${small ? '' : 'py-0.5'}`}>
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className={`rounded-full bg-zinc-500 ${small ? 'w-[3px] h-[3px]' : 'w-[5px] h-[5px]'}`}
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}
```

### 6.2 `PlanApprovalCard` — clean, minimal

**New file:** `wild/src/app/view/HomePage/compo/PlanApprovalCard.tsx`

```tsx
'use client';
import { motion } from 'framer-motion';
import { Zap, CheckCircle2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { PlanData } from '@/hooks/useAssistantStream';

interface Props {
  plan: PlanData;
  onApprove: () => void;
  onReject: () => void;
  disabled?: boolean;
}

export function PlanApprovalCard({ plan, onApprove, onReject, disabled }: Props) {
  const [expanded, setExpanded] = useState(false);
  const canAfford = plan.canAfford !== false;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-zinc-700/80 bg-zinc-900/70 backdrop-blur-sm overflow-hidden w-full max-w-[340px]"
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
            Generation Plan
          </span>
          <span className="text-[11px] text-zinc-500">
            {plan.steps.length} step{plan.steps.length !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="text-[13px] text-zinc-300 leading-snug">{plan.summary}</p>
      </div>

      {/* Credit summary row */}
      <div className="px-4 py-2.5 border-t border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span className={`text-[13px] font-semibold ${canAfford ? 'text-amber-400' : 'text-red-400'}`}>
            {plan.totalEstimatedCredits} credits
          </span>
        </div>
        {plan.userCredits !== null && (
          <span className="text-[11px] text-zinc-500">
            {canAfford
              ? `${plan.userCredits - plan.totalEstimatedCredits} remaining after`
              : `you have ${plan.userCredits} — ${plan.totalEstimatedCredits - plan.userCredits} short`
            }
          </span>
        )}
      </div>

      {/* Expandable steps detail */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full px-4 py-2 flex items-center justify-between text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors border-t border-zinc-800"
      >
        <span>View steps</span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="px-4 pb-3 space-y-2.5 border-t border-zinc-800"
        >
          {plan.steps.map((step, i) => (
            <div key={step.stepId} className="flex items-start gap-2.5 pt-2.5">
              <div className="shrink-0 w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] text-zinc-500 mt-0.5">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-zinc-300">{step.label}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] text-zinc-500">{step.selectedModel.label}</span>
                  <span className="text-zinc-700">·</span>
                  <span className="text-[11px] text-amber-500/80">{step.creditCost} cr</span>
                </div>
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {/* Not affordable warning */}
      {!canAfford && (
        <div className="px-4 py-2.5 bg-red-500/10 border-t border-red-500/20">
          <p className="text-[12px] text-red-400">
            Not enough credits.{' '}
            <button className="underline hover:text-red-300">Upgrade your plan →</button>
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="px-4 pb-4 pt-3 flex gap-2 border-t border-zinc-800">
        <button
          onClick={onApprove}
          disabled={!canAfford || disabled}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 active:bg-violet-700 disabled:opacity-30 disabled:cursor-not-allowed text-white text-[13px] font-medium transition-colors"
        >
          <CheckCircle2 className="w-4 h-4" />
          Approve & Generate
        </button>
        <button
          onClick={onReject}
          disabled={disabled}
          className="flex items-center justify-center p-2 rounded-xl border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}
```

### 6.3 `AssistantMessageContent` — renders requirement questions with choices

**Update existing `AssistantMessageContent`** (or create if it doesn't exist):

When a message is a requirement question with `choices`, render them as tappable chips:

```tsx
// In AssistantMessageContent.tsx or inline in PromotionalBanner2.tsx

interface MessageData {
  content: string;
  choices?: string[];       // from gather_requirements tool
  progress?: { answered: number; total: number; percent: number };
}

export function AssistantMessageContent({
  content,
  choices,
  progress,
  onChoiceSelect
}: MessageData & { onChoiceSelect?: (choice: string) => void }) {
  return (
    <div className="space-y-2.5">
      {/* Progress indicator */}
      {progress && (
        <div className="flex items-center gap-2 mb-1">
          <div className="flex-1 h-[2px] bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-violet-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress.percent}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>
          <span className="text-[11px] text-zinc-500 shrink-0">
            {progress.answered}/{progress.total}
          </span>
        </div>
      )}

      {/* Message text */}
      <div className="text-[15px] leading-[1.55] text-zinc-100 whitespace-pre-wrap break-words">
        {content}
      </div>

      {/* Choice chips */}
      {choices && choices.length > 0 && onChoiceSelect && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {choices.map((c) => (
            <button
              key={c}
              onClick={() => onChoiceSelect(c)}
              className="px-3 py-1.5 rounded-full text-[12px] border border-zinc-700 hover:border-violet-500 hover:bg-violet-500/10 text-zinc-300 hover:text-violet-300 transition-colors"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 6.4 Update `PromotionalBanner2.tsx` — wire it all together

**File:** `wild/src/app/view/HomePage/compo/PromotionalBanner2.tsx`

Replace the entire chat state + send logic with the new hook:

```tsx
// Remove: useState for chatHistory, isAiThinking, converseSessionId
// Remove: handleSendChat entire function
// Remove: the isGenerativePrompt / detectIntent logic
// Remove: all calls to /api/assistant/converse

// Add:
import { useAssistantStream } from '@/hooks/useAssistantStream';
import { AgentStateDisplay } from './AgentStateDisplay';
import { PlanApprovalCard } from './PlanApprovalCard';
import { AssistantMessageContent } from './AssistantMessageContent';
import { useAuth } from '@/hooks/useAuth'; // or however you get the auth token

const { user, getIdToken } = useAuth();
const [sessionId] = useState(() => crypto.randomUUID());

const getAuthHeaders = useCallback(async () => {
  const token = await getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}, [getIdToken]);

const {
  messages,
  sendMessage,
  isStreaming,
  currentAgentEvents
} = useAssistantStream(sessionId, getAuthHeaders);

// Plan approval
const handleApprovePlan = useCallback(async (planId: string) => {
  await sendMessage('yes');
}, [sendMessage]);

// Handle choice selection from requirement questions
const handleChoiceSelect = useCallback((choice: string) => {
  sendMessage(choice);
}, [sendMessage]);

// Send handler (dead simple now)
const handleSend = useCallback(() => {
  const text = inputValue.trim();
  if (!text || isStreaming) return;
  setInputValue('');
  sendMessage(text);
}, [inputValue, isStreaming, sendMessage]);
```

Chat rendering (replace the messages map):

```tsx
<div className="px-4 overflow-y-auto" style={{ minHeight: '240px', maxHeight: '380px', scrollbarWidth: 'none' }}>
  <div className="space-y-4 pb-4">
    <AnimatePresence initial={false}>

      {messages.map((msg) => (
        <motion.div
          key={msg.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          {msg.role === 'assistant' && (
            <div className="shrink-0 w-6 h-6 flex items-center justify-center mt-0.5">
              <img src="/core/logosquare.png" alt="AI" width={20} height={20} className="rounded-sm" />
            </div>
          )}

          <div className="flex flex-col gap-2 max-w-[85%] min-w-0">

            {/* Agent state events that led to this message */}
            {msg.role === 'assistant' && msg.agentEvents && msg.agentEvents.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1">
                {msg.agentEvents
                  .filter(e => e.type === 'tool_call')
                  .map((e, i) => (
                    <motion.span
                      key={e.id}
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.06 }}
                      className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 border border-zinc-700 text-zinc-500 flex items-center gap-1"
                    >
                      <span className="text-[10px]">{TOOL_ICONS[e.data.tool] ?? '⚙️'}</span>
                      {TOOL_LABELS[e.data.tool] ?? e.data.tool}
                      <span className="text-emerald-500 text-[10px]">✓</span>
                    </motion.span>
                  ))
                }
              </div>
            )}

            {/* Message bubble */}
            {msg.content && (
              <div className={`rounded-2xl px-4 py-3 text-[15px] leading-[1.5] ${
                msg.role === 'user'
                  ? 'bg-zinc-700 text-zinc-100 rounded-tr-sm'
                  : 'bg-zinc-800/80 text-zinc-100 rounded-tl-sm'
              }`}>
                {msg.role === 'assistant' ? (
                  <AssistantMessageContent
                    content={msg.content}
                    choices={msg.choices}
                    progress={msg.progress}
                    onChoiceSelect={handleChoiceSelect}
                  />
                ) : (
                  <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                )}
              </div>
            )}

            {/* Plan approval card */}
            {msg.role === 'assistant' && msg.planData && (
              <PlanApprovalCard
                plan={msg.planData}
                onApprove={() => handleApprovePlan(msg.planData!.planId)}
                onReject={() => sendMessage('No, I want to change something.')}
                disabled={isStreaming}
              />
            )}
          </div>

          {msg.role === 'user' && (
            <div className="shrink-0 w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center mt-0.5">
              <User className="w-3 h-3 text-zinc-400" />
            </div>
          )}
        </motion.div>
      ))}

      {/* Live agent state during streaming */}
      {isStreaming && (
        <motion.div key="streaming-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <AgentStateDisplay events={currentAgentEvents} isStreaming={isStreaming} />
        </motion.div>
      )}

    </AnimatePresence>
  </div>
</div>
```

---

## Phase 7: Pass Message Metadata Through (choices, progress)

The `gather_requirements` tool returns `choices` and `progress`. These need to flow all the way to the chat message so the UI can render them.

### 7.1 Attach metadata to assistant message event

In `src/routes/assistant.ts` — the `/stream` route — when emitting `assistant_message`, also check Redis for any pending metadata:

```typescript
// In the stream route, after getting ocRes:

// Check for requirement question metadata
const reqMetaKey = `reqMeta:${userId}:${sessionId}`;
let reqMeta: any = null;
try {
  const cached = await redisClient.get(reqMetaKey);
  if (cached) {
    reqMeta = JSON.parse(cached);
    await redisClient.del(reqMetaKey);
  }
} catch {}

send("assistant_message", {
  content,
  choices: reqMeta?.choices ?? null,
  progress: reqMeta?.progress ?? null
});
```

### 7.2 Write metadata from `gather_requirements` tool

In `gather_requirements` handler, before returning:

```typescript
// At the end of gather_requirements handler, when returning a question:
const metaKey = `reqMeta:${context.userId}:${sessionId}`;
await redisClient.setEx(metaKey, 120, JSON.stringify({
  choices: nextField.choices ?? null,
  progress
}));
```

### 7.3 Update `ChatMessage` type

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentEvents?: AgentEvent[];
  planData?: PlanData | null;
  choices?: string[] | null;       // for choice-type requirement questions
  progress?: {                     // requirement gathering progress
    answered: number;
    total: number;
    percent: number;
  } | null;
}
```

---

## Execution Order (for your coding agent)

```
Phase 1 — Fix openclaw.config alsoAllow                              [15 min]
          Test: restart OpenClaw, check logs say "N tools registered"

Phase 3 — New tools: assistantLoop.ts                                [2.5 hrs]
          generate_requirement_schema (calls completeText/gpt-4o-mini)
          gather_requirements (uses dynamic schema from agent state)
          preview_plan (calls existing generateExecutionPlan)
          execute_plan (calls existing approveAndExecutePlan)
          Register all in tools/index.ts
          Test: POST /api/tools/invoke { tool: "generate_requirement_schema",
                args: { sessionId: "test", userMessage: "I want a logo" } }
                → should return taskType + fields[] from AI

Phase 4 — System prompt v2 in assistant.ts                           [30 min]
          Also add credit fetch before prompt build
          Test: POST /api/assistant/chat { message: "logo", sessionId: "s1" }
                → OpenClaw should call generate_requirement_schema then ask Q1

Phase 2 — New /api/assistant/stream SSE endpoint                     [1.5 hrs]
          Add Redis reads for planPreview + reqMeta keys
          Test: curl --no-buffer POST /api/assistant/stream
                → should see SSE events in terminal

Phase 7 — reqMeta writes in gather_requirements + reads in /stream   [30 min]
          planPreview writes in preview_plan + reads in /stream

Phase 5 — Frontend: useAssistantStream hook + sseParser utility      [1.5 hrs]
          Test: hook parses SSE events correctly (unit test or storybook)

Phase 6 — UI components                                              [2 hrs]
          AgentStateDisplay (thinking dots + tool pills)
          PlanApprovalCard (clean, minimal, expandable)
          AssistantMessageContent (progress bar + choice chips)
          Update PromotionalBanner2 to use the hook + new components
          Remove ALL old converse/detect-intent logic

Smoke test — Full end-to-end in browser                              [30 min]
          Type: "I want a soap brand logo"
          Should see: thinking dots → tool pills appearing → Q1 → Q2 → ... → plan card
          Approve → execute → history
```

---

## Key Files Summary

| File | New/Edit | What |
|---|---|---|
| `services/openclaw-gateway/openclaw.config.example.json` | Edit | Fix alsoAllow to real tool names |
| `src/openclaw/tools/assistantLoop.ts` | **New** | All 4 tools: schema gen, gather, plan, execute |
| `src/openclaw/tools/index.ts` | Edit | Register 4 new tools |
| `src/routes/assistant.ts` | Edit | New /stream SSE route + v2 system prompt + credit fetch + Redis reads |
| `src/orchestrator/orchestratorService.ts` | Edit/New | Extract approveAndExecutePlan as callable service |
| `wild/src/hooks/useAssistantStream.ts` | **New** | SSE stream hook: events, state, messages |
| `wild/src/utils/sseParser.ts` | **New** | Clean async SSE parser |
| `wild/src/app/view/HomePage/compo/AgentStateDisplay.tsx` | **New** | Thinking dots + tool call pills |
| `wild/src/app/view/HomePage/compo/PlanApprovalCard.tsx` | **New** | Plan card with approve/reject |
| `wild/src/app/view/HomePage/compo/AssistantMessageContent.tsx` | Edit/New | Progress bar + choice chips |
| `wild/src/app/view/HomePage/compo/PromotionalBanner2.tsx` | Edit | Replace all old logic with hook + new components |

---

## What the Experience Looks Like

```
User:   I want to create a cinematic video ad for my coffee brand

        [thinking dots appear]
        🧠 Analyzing your request  ✓
        📋 Collecting requirements  ⟳

AI:     ━━━━━━━━━━━━━━━━━━━ 0 of 4
        What is your coffee brand's name?

User:   BrewMaster

        [tool pill: 📋 Collecting requirements ✓]

AI:     ━━━━━━━━━━━━ 1 of 4
        What style should the ad have?
        [Cinematic]  [Lifestyle]  [Minimalist]  [Bold & Dramatic]

User:   [taps Cinematic]

AI:     ━━━━━━━━━━━━━━━━ 2 of 4
        How long should the video be?
        [15 seconds]  [30 seconds]  [60 seconds]

User:   30 seconds

AI:     ━━━━━━━━━━━━━━━━━━━━━━ 3 of 4
        What's the call to action? (e.g. "Shop Now", "Visit brewmaster.com")

User:   Order at brewmaster.com

        [🧠 Analyzing ✓  📐 Building plan ⟳]

AI:     Here's what I have:
        • Brand: BrewMaster
        • Style: Cinematic
        • Duration: 30 seconds
        • CTA: Order at brewmaster.com
        Ready to plan this?

User:   yes

        [📐 Building generation plan ✓]

AI:     ┌─ Generation Plan ────────────────┐
        │  Cinematic 30s video ad —        │
        │  BrewMaster coffee brand         │
        │                                  │
        │  Step 1  Script & storyboard     │
        │          GPT-4o · 10 cr          │
        │  Step 2  Video generation        │
        │          Sora 2 Pro · 400 cr     │
        │                                  │
        │  ⚡ Total: 410 credits            │
        │  You have 1,200 (790 after)      │
        │                                  │
        │  [✓ Approve & Generate]  [✕]    │
        └──────────────────────────────────┘

User:   [clicks Approve]

        [⚡ Starting generation ✓]

AI:     ✓ Your video ad is generating!
        It usually takes 2–3 minutes.
        Check History → My Creations when ready.
```

---

## Notes for Coding Agent

1. `generate_requirement_schema` calls `completeText` from your existing `modelGateway`. Use `gpt-4o-mini` or the cheapest fast model in your registry. This call should be fast (< 2s). Cache the result in agentStateStore keyed `schema:{userId}:{sessionId}` for the entire session.

2. The SSE `tool_call_trace` field depends on OpenClaw supporting it. If OpenClaw does not include it in the response, the backend can synthesize it by reading from a Redis list that each tool handler appends to during execution: `toolTrace:{userId}:{sessionId}`. Each tool handler writes `{ name, status: "called", timestamp }` before returning, and the `/stream` route reads and emits them.

3. The `gather_requirements` tool's `latestAnswer` approach means OpenClaw must pass the `fieldId` back correctly. The system prompt must include: "When calling gather_requirements after a user reply, set latestAnswer.fieldId to the exact fieldId from the previous tool result." Include this in the system prompt.

4. `preview_plan` stores its result in Redis as `planPreview:{userId}:{sessionId}` with 5-min TTL. The `/stream` route reads this after getting the OpenClaw response. This is the cleanest way to pass structured plan data without depending on OpenClaw embedding JSON in its text output.

5. Do not add a `/assistant` full-page route yet. Get the hero banner working perfectly first. The same hook and components can be dropped into a full-page view trivially once they work.
