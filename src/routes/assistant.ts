/**
 * WildMind — Conversation Assistant Route
 *
 * Mounts at: /api/assistant
 *
 * POST /api/assistant/converse          — Process one conversation turn
 * POST /api/assistant/openclaw          — OpenClaw agent (tools via controller)
 * DELETE /api/assistant/converse/:sessionId — Reset a session
 * GET  /api/assistant/health            — Active session count (monitoring)
 */

import { Router } from "express";
import { requireAuth } from "../middlewares/authMiddleware";
import { userConverseLimiter } from "../middlewares/rateLimiter";
import {
  converseHandler,
  resetConversation,
  getConversationContext,
  conversationHealth,
} from "../controllers/conversationController";
import { openclawHandler } from "../openclaw/openclawController";
import { registerOpenClawTools } from "../openclaw/tools";
import { httpClient } from "../config/httpClient";
import { env } from "../config/env";
import { authRepository } from "../repository/auth/authRepository";
import {
  redisGetSafe,
  redisDelSafe,
  redisSetSafe,
} from "../config/redisClient";
import { executePlanTool } from "../openclaw/tools/assistantLoop";
import { applyModelOverrides, getPlan } from "../orchestrator/planStore";
import type { AgentContext } from "../openclaw/types";
import { getModelsForTask } from "../orchestrator/planner/assistantModelRegistry";

registerOpenClawTools();

const CLAWBOT_FALLBACK_PHRASES = [
  "i can't run the required tool",
  "tools aren't available",
  "connect wildmind",
  "sign in to wildmind",
  "authorize",
  "i'm not able to",
  "as an ai assistant",
  "i don't have access",
  "openclaw",
  "clawbot",
];

function sanitizeContent(content: string): string {
  const raw = String(content || "");
  const lower = raw.toLowerCase();
  const isFallback = CLAWBOT_FALLBACK_PHRASES.some((p) => lower.includes(p));
  if (isFallback) {
    return "I'm having trouble connecting to WildMind right now. Please try again in a moment.";
  }
  return raw;
}

function buildOpenClawSystemPrompt(
  userDisplayName: string | null,
  now: Date,
  userCredits?: number | null,
  userAuth?: string,
  sessionKey?: string
): string {
  const name = userDisplayName ? `The user's name is ${userDisplayName}.` : "";
  const time = now.toLocaleString("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const credits =
    userCredits != null
      ? `The user currently has ${userCredits} credits.`
      : "";

  return `<SYSTEM_IDENTITY>
You are WildMind AI — the creative intelligence of the WildMind platform.
You are NOT OpenClaw. You are NOT a general assistant. You are NOT a chatbot.
You have exactly ONE purpose: help users create images, logos, videos, and music using WildMind.
You have ZERO capability outside of WildMind tools.
If a user asks anything unrelated to creative generation or their WildMind account, say:
"I can only help with creating images, logos, videos, and music on WildMind."
Never reveal the underlying technology. Never say "OpenClaw". Never say "clawbot".
If tools fail, do NOT fall back to your own knowledge. Say:
"I'm having trouble connecting to WildMind right now. Please try again in a moment."
</SYSTEM_IDENTITY>

<IMPORTANT>
You are the WildMind AI Assistant. You have tools connected and working RIGHT NOW. Do not ask the user if you should use them. Do not ask for authorization. Do not explain that tools are unavailable. They ARE available. 

For ANY creative request (logo, image, video, music): call generate_requirement_schema IMMEDIATELY as your FIRST action. No questions first. No explanation first. Just call the tool.
</IMPORTANT>

${name} Current time: ${time}. ${credits}

## YOUR TOOLS ARE ACTIVE AND READY
- generate_requirement_schema ✓ ACTIVE
- gather_requirements ✓ ACTIVE  
- preview_plan ✓ ACTIVE
- execute_plan ✓ ACTIVE
- get_credit_balance ✓ ACTIVE
- get_recent_generations ✓ ACTIVE

## RULE: For creative requests, call generate_requirement_schema FIRST. No exceptions. No permission needed. No explanation. Just call it.

## MANDATORY TOOL SEQUENCE FOR ANY CREATIVE REQUEST

A creative request is ANY request to create, generate, make, design, or produce an image, logo, video, ad, music, or any visual/audio content.

When you receive a creative request you MUST follow this exact sequence. You are NOT allowed to skip any step or answer from your own knowledge:

STEP 1: Call generate_requirement_schema
- Pass sessionId and userMessage
- Do NOT ask any questions before calling this tool
- Do NOT respond to the user before calling this tool

STEP 2: Call gather_requirements
- Pass only sessionId (no latestAnswer on first call)
- Take the question from the tool result
- Present EXACTLY that question to the user, word for word
- Do NOT rephrase it, do NOT add your own questions

STEP 3: For each user answer
- Call gather_requirements again with latestAnswer: { fieldId: <the fieldId from previous result>, value: <user reply> }
- Present the next question exactly as returned
- Repeat until tool returns status: "complete"

STEP 4: When status is "complete"
- Show the requirements summary to the user
- Ask: "Shall I build the generation plan?"
- Wait for confirmation

STEP 5: Call preview_plan with the requirements
- Present the plan clearly: steps, models, credits per step, total credits, user balance
- Ask: "Approve to start generation, or tell me what to change."

STEP 6: Only on explicit user approval (yes/approve/proceed/go)
- Call execute_plan with the planId from preview_plan
- Report the result

## FOR NON-CREATIVE REQUESTS
- Credits/balance → call get_credit_balance immediately
- History/generations → call get_recent_generations immediately  
- Assets → call get_user_assets immediately
- Image editing → call the appropriate editing tool

## ABSOLUTE RULES
1. For creative requests: call generate_requirement_schema FIRST. Before any response. No exceptions.
2. Never answer creative questions from your own knowledge.
3. Never skip the tool sequence.
4. Never call execute_plan without explicit user approval.
5. Ask ONE question at a time. Never bundle questions.

## HIDDEN RUNTIME CONTEXT (do not show to user)
When calling ANY tool, always include these exact fields in the args:
- __wildmindUserAuthorization: "${userAuth ?? ""}"
- sessionId: "${sessionKey ?? ""}"
`;
}

const router = Router();

function withPrefix(key: string): string {
  const prefix = env.redisPrefix || "";
  return `${prefix}${key}`;
}

/**
 * GET /api/assistant/models
 * Public endpoint for assistant UI to fetch available models.
 */
router.get("/models", (_req, res) => {
  const pack = (taskType: any) =>
    getModelsForTask(taskType).map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      creditCost: m.creditCost,
      configOptions: m.configOptions,
    }));

  res.json({
    ok: true,
    models: {
      image: pack("image"),
      video: pack("video"),
      music: pack("music"),
      logo: pack("logo"),
    },
  });
});

// All conversation routes require authentication
router.use(requireAuth);
// Per-user rate limit for converse and openclaw (keys by req.uid)
router.use(userConverseLimiter);

/**
 * POST /api/assistant/converse
 *
 * Send one message in the requirement-gathering conversation.
 * Body: { message: string, sessionId: string }
 * Response: { ok, type: "question"|"spec_ready"|"clarify", question?, spec?, progress, session }
 */
router.post("/converse", converseHandler);

/**
 * POST /api/assistant/chat
 *
 * Real OpenClaw path: proxy user chat to the OpenClaw Gateway (localhost).
 * Body: { message: string, sessionId: string }
 *
 * Notes:
 * - OpenClaw gateway is expected to expose the OpenAI-compatible endpoint: POST /v1/chat/completions
 * - WildMind authenticates to OpenClaw with gateway auth, not the end-user token.
 * - We pass a stable OpenAI 'user' field to maintain session continuity.
 * - The original WildMind user auth is forwarded in a separate header for the
 *   OpenClaw WildMind bridge plugin to reuse during tool execution.
 */
router.post("/chat", async (req, res) => {
  const userId = (req as any).uid as string;
  const requestId = (req as any).requestId ?? `req-${Date.now()}`;
  const { message, sessionId } = req.body ?? {};

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ ok: false, error: "MISSING_MESSAGE" });
    return;
  }
  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ ok: false, error: "MISSING_SESSION_ID" });
    return;
  }

  const gatewayUrl =
    env.openclawGatewayUrl || "http://127.0.0.1:18789";

  const userAuthHeader =
    (req.headers.authorization as string | undefined) ??
    ((req.headers as any).Authorization as string | undefined);
  const reqToken = (req as any).token as string | undefined;
  const effectiveAuth =
    userAuthHeader || (reqToken ? `Bearer ${reqToken}` : undefined);

  const gatewayAuthHeader = env.openclawGatewayToken
    ? `Bearer ${env.openclawGatewayToken}`
    : undefined;
  const sessionKey = `${userId}:${sessionId}`;

  try {
    const userAuthHeader =
      (req.headers.authorization as string | undefined) ??
      ((req.headers as any).Authorization as string | undefined);
    const reqToken = (req as any).token as string | undefined;
    const effectiveAuth =
      userAuthHeader || (reqToken ? `Bearer ${reqToken}` : undefined);

    // Pre-write user auth to Redis so the plugin can read it during tool execution
    const pluginAuthKey = withPrefix(`pluginAuth:${userId}:${sessionId}`);
    if (effectiveAuth) {
      await redisSetSafe(pluginAuthKey, effectiveAuth, 300);
    }
    const user = await authRepository.getUserById(userId);
    const userDisplayName =
      (user?.displayName?.trim() || user?.username?.trim()) || null;
    const now = new Date();
    const systemPrompt = buildOpenClawSystemPrompt(
      userDisplayName,
      now,
      null,
      effectiveAuth ?? "",
      sessionKey,
    );

    const ocRes = await httpClient.post(
      `${gatewayUrl}/v1/chat/completions`,
      {
        model: env.openclawAgentId || "main",
        user: sessionKey,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message.trim() },
        ],
        user_context: {
          wildmindUserAuthorization: effectiveAuth ?? "",
          wildmindSessionKey: sessionKey,
        },
      },
      {
        headers: {
          ...(gatewayAuthHeader ? { Authorization: gatewayAuthHeader } : {}),
          ...(effectiveAuth
            ? { "x-wildmind-user-authorization": effectiveAuth }
            : {}),
          "x-wildmind-session-key": sessionKey,
          "x-openclaw-agent-id": env.openclawAgentId || "main",
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
        timeout: 60_000,
      }
    );

    const content =
      ocRes?.data?.choices?.[0]?.message?.content ??
      ocRes?.data?.choices?.[0]?.text ??
      undefined;
    res.json({
      ok: true,
      type: "openclaw",
      content,
      raw: ocRes.data,
    });
  } catch (err: any) {
    const msg = err?.response?.data ?? err?.message ?? "OpenClaw gateway request failed";

    res.status(502).json({
      ok: false,
      error: "OPENCLAW_UNAVAILABLE",
      message: typeof msg === "string" ? msg : "OpenClaw gateway request failed",
    });
  }
});

/**
 * POST /api/assistant/stream
 *
 * SSE streaming endpoint that proxies to OpenClaw and emits structured events
 * (thinking, tool_call, assistant_message, plan_ready, done, error).
 *
 * Body: { message: string, sessionId: string }
 */
router.post("/stream", async (req, res) => {
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
  (res as any).flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if ((res as any).flush) {
      (res as any).flush();
    }
  };
  const keepaliveInterval = setInterval(() => {
    res.write(": keepalive\n\n");
    if ((res as any).flush) {
      (res as any).flush();
    }
  }, 15_000);

  const sessionKey = `${userId}:${sessionId}`;

  // Write user auth to Redis so wildmind-bridge plugin can read it during tool execution
  const userAuthHeader =
    (req.headers.authorization as string | undefined) ??
    ((req.headers as any).Authorization as string | undefined);
  // For cookie-authenticated requests, requireAuth stores the verified token at req.token
  const reqToken = (req as any).token as string | undefined;
  const effectiveAuth =
    userAuthHeader || (reqToken ? `Bearer ${reqToken}` : undefined);
  const pluginAuthKey = withPrefix(`pluginAuth:${userId}:${sessionId}`);
  if (effectiveAuth) {
    await redisSetSafe(pluginAuthKey, effectiveAuth, 300);
  }

  let processedMessage = (message as string).trim();
  let injectedPlanId: string | null = null;
  let injectedModelOverrides: Record<string, string> | null = null;
  const approveMatch = processedMessage.match(/^approve:([a-zA-Z0-9_-]+)(?::(.+))?$/);
  if (approveMatch) {
    injectedPlanId = approveMatch[1];
    if (approveMatch[2]) {
      try {
        const decoded = decodeURIComponent(String(approveMatch[2]));
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === "object") {
          injectedModelOverrides = parsed as Record<string, string>;
        }
      } catch {
        // ignore invalid overrides
      }
    }
    processedMessage = `Yes, I approve the plan. Please execute plan ID: ${injectedPlanId}.`;
  }
  const switchMatch = processedMessage.match(/^switch_model:([^:]+):([^:]+):(.+)$/);

  try {
    const user = await authRepository.getUserById(userId);
    const displayName =
      (user?.displayName?.trim() || user?.username?.trim()) || null;
    const now = new Date();

    // Phase 2: keep existing behavior; credits can be added later
    const systemPrompt = buildOpenClawSystemPrompt(
      displayName,
      now,
      null,
      effectiveAuth ?? "",
      sessionKey,
    );

    const gatewayAuthHeader = env.openclawGatewayToken
      ? `Bearer ${env.openclawGatewayToken}`
      : undefined;
    const gatewayUrl = env.openclawGatewayUrl || "http://127.0.0.1:18789";

    // Emit initial thinking state
    send("thinking", { text: "Thinking…", phase: "start" });

    // Deterministic model switch: update plan store and re-emit plan_ready (skip OpenClaw)
    if (switchMatch) {
      const [, planId, stepId, newModelId] = switchMatch;
      try {
        // Apply override (mutates stored plan + modelOverrides)
        applyModelOverrides(planId, { [stepId]: newModelId });
        const entry = getPlan(planId);
        if (!entry) {
          send("assistant_message", { content: "❌ Plan not found or expired." });
          send("done", {});
          res.end();
          return;
        }
        if (entry.userId !== userId) {
          send("assistant_message", { content: "❌ You do not own this plan." });
          send("done", {});
          res.end();
          return;
        }

        const planData = {
          ok: true,
          planId,
          plan: entry.executionPlan,
          taskType: entry.executionPlan.taskType,
          totalEstimatedCredits: entry.executionPlan.totalEstimatedCredits ?? 0,
          totalEstimatedDurationSeconds:
            entry.executionPlan.totalEstimatedDurationSeconds ?? null,
        };
        send("plan_ready", planData);
        send("done", {});
        res.end();
        return;
      } catch (e: any) {
        send("assistant_message", {
          content: `❌ Failed to switch model: ${e?.message ?? "Unknown error"}`,
        });
        send("done", {});
        res.end();
        return;
      }
    }

    // Deterministic approval: execute plan directly (skip model dependency)
    if (injectedPlanId) {
      try {
        const toolContext: AgentContext = {
          userId,
          sessionId,
          requestId,
          token: reqToken,
        };

        const result = (await executePlanTool.handler(
          { planId: injectedPlanId, sessionId, modelOverrides: injectedModelOverrides ?? undefined },
          toolContext,
        )) as any;

        send("tool_call", {
          tool: "execute_plan",
          status: "done",
          label: TOOL_LABELS["execute_plan"],
        });

        const ok = Boolean(result?.ok);
        send("assistant_message", {
          content: ok
            ? "✅ Your generation has started! It will appear in your history when complete."
            : `❌ ${result?.message ?? "Failed to start generation."}`,
        });

        if (ok && result?.jobId) {
          send("job_queued", {
            jobId: result.jobId,
            planId: injectedPlanId,
            status: "queued",
            message: result?.message ?? "Generation started.",
          });
        }

        send("done", {});
        res.end();
        return;
      } catch (err: any) {
        send("assistant_message", {
          content: `❌ Failed to start generation: ${err?.message ?? "Unknown error"}`,
        });
        send("done", {});
        res.end();
        return;
      }
    }

    // Call OpenClaw in non-streaming mode and reconstruct events
    const ocRes = await httpClient.post(
      `${gatewayUrl}/v1/chat/completions`,
      {
        model: env.openclawAgentId || "main",
        user: sessionKey,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: processedMessage },
        ],
        // Request tool call details in response if OpenClaw supports it
        stream: false,
        user_context: {
          wildmindUserAuthorization: effectiveAuth ?? "",
          wildmindSessionKey: sessionKey,
        },
      },
      {
        headers: {
          ...(gatewayAuthHeader ? { Authorization: gatewayAuthHeader } : {}),
          ...(effectiveAuth
            ? { "x-wildmind-user-authorization": effectiveAuth }
            : {}),
          "x-wildmind-session-key": sessionKey,
          "x-openclaw-agent-id": env.openclawAgentId || "main",
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
        timeout: 120_000,
      }
    );

    const rawData = ocRes?.data;

    // Read Redis side-effects written by tool handlers to reconstruct tool call trace
    const schemaKeyFull = withPrefix(`schema:${userId}:${sessionId}`);
    const schemaWasWritten = await redisGetSafe(schemaKeyFull);

    const reqMetaKeyFull = withPrefix(`reqMeta:${userId}:${sessionId}`);
    let reqMeta: any = null;
    try {
      reqMeta = await redisGetSafe(reqMetaKeyFull);
    } catch {
      // non-fatal
    }

    const planPreviewKeyFull = withPrefix(`planPreview:${userId}:${sessionId}`);
    let planData: any = null;
    try {
      planData = await redisGetSafe(planPreviewKeyFull);
      if (planData) {
        await redisDelSafe(planPreviewKeyFull);
      }
    } catch {
      // non-fatal
    }

    // Check for job queued by execute_plan tool
    const jobQueuedKey = withPrefix(`jobQueued:${userId}:${sessionId}`);
    let jobData: any = null;
    try {
      jobData = await redisGetSafe(jobQueuedKey);
      if (jobData) {
        await redisDelSafe(jobQueuedKey);
      }
    } catch {
      // non-fatal
    }

    // Emit tool_call events based on which tools actually ran
    if (schemaWasWritten) {
      send("tool_call", {
        tool: "generate_requirement_schema",
        status: "done",
        label: TOOL_LABELS["generate_requirement_schema"],
      });
    }
    if (reqMeta) {
      send("tool_call", {
        tool: "gather_requirements",
        status: "done",
        label: TOOL_LABELS["gather_requirements"],
      });
    }
    if (planData) {
      send("tool_call", {
        tool: "preview_plan",
        status: "done",
        label: TOOL_LABELS["preview_plan"],
      });
    }

    // If user approved a specific plan, persist that planId for execute_plan fallback
    if (injectedPlanId) {
      const approvedPlanKey = withPrefix(`approvedPlanId:${userId}:${sessionId}`);
      await redisSetSafe(approvedPlanKey, injectedPlanId, 300);
    }

    const rawContent =
      rawData?.choices?.[0]?.message?.content ??
      rawData?.choices?.[0]?.text ??
      "";
    const content = sanitizeContent(rawContent);

    // Emit the assistant message
    send("assistant_message", { content });

    if (reqMeta) {
      send("req_meta", reqMeta);
    }

    if (planData) {
      send("plan_ready", planData);
    }

    if (jobData) {
      send("job_queued", jobData);
    }

    send("done", {});
    res.end();
  } catch (err: any) {
    const status = err?.response?.status;
    const is502 = typeof status === "number" && status >= 500;
    send("error", {
      code: is502 ? "OPENCLAW_UNAVAILABLE" : "INTERNAL_ERROR",
      message: err?.message ?? "Failed",
    });
    res.end();
  } finally {
    clearInterval(keepaliveInterval);
  }
});

/**
 * POST /api/assistant/openclaw
 *
 * OpenClaw platform agent: routes to tools (generate_content, get_credit_balance) via Tool Execution Controller.
 * Body: { message: string, sessionId: string }
 */
router.post("/openclaw", openclawHandler);

/**
 * DELETE /api/assistant/converse/:sessionId
 *
 * Reset a conversation session (start over).
 */
router.delete("/converse/:sessionId", resetConversation);

/**
 * GET /api/assistant/context
 *
 * Conversation context API: last N messages for the session (for OpenClaw/agents).
 * Query: sessionId (required), limit (optional, default 20, max 50), maxTotalChars (optional, cap total content length for LLM).
 */
router.get("/context", getConversationContext);

/**
 * GET /api/assistant/health
 *
 * Returns active session count for monitoring.
 */
router.get("/health", conversationHealth);

// Human-readable labels for tool names shown in the UI
const TOOL_LABELS: Record<string, string> = {
  generate_requirement_schema: "Analyzing your request",
  gather_requirements: "Collecting requirements",
  preview_plan: "Building your plan",
  execute_plan: "Starting generation",
  get_recent_generations: "Loading your history",
  get_credit_balance: "Checking credits",
  get_user_assets: "Loading assets",
  get_asset: "Fetching asset",
  edit_image: "Editing image",
  upscale_image: "Upscaling image",
  remove_background: "Removing background",
  delete_asset: "Deleting asset",
  search_similar_creations: "Searching similar work",
  navigate_page: "Navigating",
};

export default router;
