# Plan Implementation: Env Variables, OpenClaw Review, and Module Checklist

## Is WildMind OpenClaw the same as https://docs.openclaw.ai/?

**No.** They are different products:

| | **WildMind OpenClaw** (this repo) | **OpenClaw at docs.openclaw.ai** |
|---|-----------------------------------|-----------------------------------|
| **What it is** | Internal **platform agent** inside the API gateway: routes user chat to tools (generate_content, get_credit_balance, etc.) via a Tool Execution Controller. | **Self-hosted multi-channel gateway**: connects WhatsApp, Telegram, Discord, iMessage to AI agents (e.g. Pi). |
| **Where it runs** | Part of `api-gateway-services-wildmind`; one HTTP endpoint: `POST /api/assistant/openclaw`. | Standalone Gateway process (e.g. `openclaw gateway --port 18789`); separate npm package `openclaw`. |
| **Purpose** | Intent routing and tool execution for WildMind’s assistant (credits, generation, assets, navigation). | Bridge between messaging apps and AI; multi-channel, sessions, nodes. |

So: **WildMind’s OpenClaw is a custom agent layer in this codebase**, not the open-source gateway from [docs.openclaw.ai](https://docs.openclaw.ai/).

---

## Where is OpenClaw Initialized?

1. **Tool registration (at process start)**  
   - **File:** `src/routes/assistant.ts`  
   - **Code:** `registerOpenClawTools();` runs when the assistant route module is loaded.  
   - **Effect:** Registers all tools (generate_content, get_credit_balance, getUser_assets, get_recent_generations, edit_image, upscale_image, navigate_page, search_similar_creations, upgrade_plan) in the closed Tool Registry.

2. **Route mount**  
   - **File:** `src/routes/index.ts`  
   - Assistant routes are mounted at `/assistant`; `src/routes/assistant.ts` defines `router.post("/openclaw", openclawHandler)`.

3. **Request flow**  
   - `POST /api/assistant/openclaw` → `openclawHandler` (openclawController.ts) → `runOpenClawTurn(message, sessionId, context)` (openclawAgent.ts) → intent heuristics → `executeTool(name, args, context)` (toolExecutionController.ts) → Tool Registry → handler.

4. **Real OpenClaw now runs separately**  
   - The old in-process `openclawAgent` path still exists as legacy/internal compatibility code.
   - The real integration target is now a standalone OpenClaw gateway process on `127.0.0.1:18789`, with WildMind proxying to it through `POST /api/assistant/chat`.

---

## Environment Variables (Plan-Related and OpenClaw)

### Required for core API (existing)

- **Auth / Firebase:** `FIREBASE_*`, etc. (needed for `requireAuth` on `/assistant`).
- **Port:** `PORT` (default 5000 for local development in the current contract).

### Optional – plan implementation

| Env variable | Used by | Purpose |
|--------------|---------|---------|
| **REDIS_URL** | conversationState, agentStateStore, jobQueue, jobStatusStore, orchestrator worker, rate limiters | Redis for conversation store, agent state, BullMQ job queue, rate-limit store. If unset: in-memory conversation/state; no job queue (inline execution or no orchestration). |
| **REDIS_PREFIX** | conversationState, agentStateStore, redisClient | Key prefix (e.g. `sess:app:`). Default `sess:app:`. Conversation key: `{REDIS_PREFIX}conversation:{userId}:{sessionId}`. |
| **AUDIT_LOG_FILE** | utils/complianceLog.ts | Append-only file path for compliance audit log (tool_call, conversation_reset, etc.). If unset: in-memory buffer + console only. |
| **GENERATION_USAGE_LOG_FILE** | modelGateway/generationUsageLogs.ts | Append-only file path for generation usage (provider, model, credits per step). If unset: in-memory buffer only. |
| **CLAMAV_ENABLED** | middlewares/fileValidation.ts | Set to `true` to run ClamAV before accepting uploads. If unset or not `true`: no AV scan (stub allows). |
| **CLAMAV_SOCKET** | middlewares/fileValidation.ts | When CLAMAV_ENABLED=true: socket path for clamd (e.g. `/var/run/clamav/clamd.ctl`). Then `clamdscan` is used. |
| **CLAMAV_SCAN_PATH** | middlewares/fileValidation.ts | When CLAMAV_ENABLED=true and no CLAMAV_SOCKET: path to `clamscan` binary. Default `clamscan`. |
| **REFERENCE_URL_ALLOWED_DOMAINS** | utils/referenceUrlAllowlist.ts | Comma-separated domains allowed for reference image URLs (e.g. `cdn.wildmind.ai,storage.wildmind.ai`). Reject others (SSRF). |

### Orchestrator / worker (when using Redis + queue)

| Env variable | Used by | Purpose |
|--------------|---------|---------|
| **REDIS_URL** | workers/orchestratorWorker.ts, orchestrator/jobQueue.ts | **Required** for the BullMQ worker. Worker exits if unset. |
| **ORCHESTRATOR_CONCURRENCY** | workers/orchestratorWorker.ts | Concurrent jobs per worker. Default `5`. |
| **ORCHESTRATOR_STALLED_INTERVAL** | workers/orchestratorWorker.ts | Stalled job check interval (ms). Default `30000`. |
| **INTERNAL_API_BASE_URL** | workflowEngine, qualityEvaluator, etc. | Base URL for internal HTTP calls (orchestrator → generation routes). Default `http://localhost:${PORT}`. |
| **ENABLE_MODEL_SELECTION** | orchestratorAgent | Set to `false` to disable. Default enabled. |
| **ENABLE_BUDGET_GUARD** | orchestratorAgent | Set to `false` to disable. Default enabled. |
| **ENABLE_ASSET_REUSE** | orchestratorAgent | Set to `true` to enable. Default off. |
| **ENABLE_QUALITY_EVAL** | orchestratorAgent | Set to `true` to enable. Default off. |

### Rate limiting

- Rate limiters use **Redis** when `REDIS_URL` is set: `isRedisEnabled()` in `config/redisClient.ts` returns `Boolean(env.redisUrl)`. If unset, limiters use in-memory store.

---

## Module-by-Module Checklist (Plan vs Implementation)

| Module | Plan expectation | Implementation status | Env / notes |
|--------|-------------------|------------------------|-------------|
| **Critical fixes** | Session key compound; reference URL allowlist; prompt logging (length/hash/model). | Done. Keys `conversation:{userId}:{sessionId}`, `agent:state:{userId}:{sessionId}`; allowlist in conversationController; safePromptLog in gateway/orchestrator. | Set `REFERENCE_URL_ALLOWED_DOMAINS` for reference images. |
| **Tool Execution Controller** | executeTool(name, args, context); rate limit, validation, logging, retry read-only. | Done. toolExecutionController.ts; toolRegistry closed; per-user per-tool rate limit. | None specific. |
| **OpenClaw platform agent** | Top layer; tools only via controller; MAX_STEPS, guardrails. | Done. openclawAgent.runOpenClawTurn; openclawController; POST /api/assistant/openclaw; registerOpenClawTools() at load. | Requires auth (Firebase). No extra env for OpenClaw itself. |
| **Intent via tools** | OpenClaw selects tool (credit → get_credit_balance; else generate_content). | Done. Heuristic in openclawAgent (wantsCreditBalance); generate_content, get_credit_balance, etc. | — |
| **Execution memory (AgentState)** | Redis agent:state:{userId}:{sessionId}; conversation agent persists. | Done. agentStateStore.ts; Redis when env.redisUrl. | `REDIS_URL` (and optional `REDIS_PREFIX`). |
| **Conversation store** | Redis conversation:{userId}:{sessionId} when Redis set. | Done. conversationState async + Redis; conversationAgent awaits; controller async. | `REDIS_URL`, `REDIS_PREFIX`. |
| **AI-first schemas** | generateDynamicSchema first; fallback static. | Done. conversationAgent. | — |
| **Model gateway (LLM)** | completeText/completeTextGemini; ai_usage_logs; registry. | Done. modelGateway; strict model registry (reject if not in ALLOWED_LLM_MODELS). | — |
| **Generation usage logging** | Log generation steps (provider, credits). | Done. generationUsageLogs; orchestratorAgent logs after executePlan. | Optional: `GENERATION_USAGE_LOG_FILE`. |
| **Per-user rate limits** | converse, plan, approve keyed by userId. | Done. userConverseLimiter, userOrchestratorLimiter in rateLimiter.ts; applied in assistant and orchestrator routes. | Rate limit store uses Redis only when `isRedisEnabled()` is true (currently false in code). |
| **Compliance audit** | Audit log for tool_call, conversation_reset. | Done. complianceLog.logAudit; optional file. | Optional: `AUDIT_LOG_FILE`. |
| **Antivirus on uploads** | Scan before permanent storage. | Done. scanFileForMalware in fileValidation; ClamAV when enabled. | `CLAMAV_ENABLED`, `CLAMAV_SOCKET` or `CLAMAV_SCAN_PATH`. |
| **Vector memory stub** | search_similar_creations until pgvector. | Done. memory/vectorMemory.ts stub; tool registered. | — |
| **Conversation context API** | GET last N messages for session. | Done. GET /api/assistant/context?sessionId=&limit=&maxTotalChars=. | — |
| **Job payload validation** | Worker validates job.data (jobId, userId, prompt, token). | Done. orchestratorWorker.ts. | — |
| **Prompt template versioning** | AI governance; version in ai_usage_logs. | Done. promptVersions.ts; gateway options; planner + requirement extractor pass version. | — |

---

## Minimal Env to Run and Test OpenClaw

- **Auth:** Firebase env vars so `requireAuth` sets `req.uid` and `req.token` (and optionally requestId).
- **No Redis:** OpenClaw works with in-memory conversation and agent state; no job queue (approve may run inline or fail if queue not used).
- **Optional:** `REFERENCE_URL_ALLOWED_DOMAINS` if the client sends reference image URLs.

To **test OpenClaw**:

1. Start the API server (e.g. `npm run dev`).
2. Ensure `registerOpenClawTools()` runs (imported in `routes/assistant.ts`).
3. Send authenticated `POST /api/assistant/openclaw` with body `{ message, sessionId }`.
4. For “how many credits do I have?” → should hit get_credit_balance and return a reply.
5. For “make me a logo” → should hit generate_content and return tool_result (or error if generation path fails).

---

## Redis Usage

- **conversationState** and **agentStateStore** use **`env.redisUrl`** directly.
- **Rate limiters** use **`isRedisEnabled()`**, which returns `Boolean(env.redisUrl)`. So when `REDIS_URL` is set, both conversation/agent state and rate limiting use Redis.

---

## Summary

- **OpenClaw here** = WildMind’s internal platform agent (assistant route + agent + tool controller). **Not** the same as the multi-channel gateway at [docs.openclaw.ai](https://docs.openclaw.ai/).
- **Initialization:** `registerOpenClawTools()` in `routes/assistant.ts` at load; route `POST /api/assistant/openclaw` → openclawHandler → runOpenClawTurn → executeTool.
- **Env vars** for the plan: `REDIS_URL`, `REDIS_PREFIX`, `AUDIT_LOG_FILE`, `GENERATION_USAGE_LOG_FILE`, `CLAMAV_ENABLED`, `CLAMAV_SOCKET` / `CLAMAV_SCAN_PATH`, `REFERENCE_URL_ALLOWED_DOMAINS`; plus orchestrator/worker vars if using the queue.
- **Module checklist:** All listed plan items are implemented; optional behavior is controlled by the env variables above.
