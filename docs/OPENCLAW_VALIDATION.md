## OpenClaw Validation Runbook

### Goal

Validate the corrected integration in the same order the production stack will use it on Lightsail.

### Local-first rule

Run this validation in two stages:

1. local developer machine
2. Lightsail production-like environment

For local development, validate the API path first and keep the UI out of scope until the OpenClaw runtime path is proven.

Canonical local values:

- WildMind API: `http://127.0.0.1:5000`
- OpenClaw Gateway: `http://127.0.0.1:18789`
- Redis: `redis://127.0.0.1:6379`

See `OPENCLAW_LOCAL_DEV.md` for the full local startup checklist.

## Local developer validation

### 1. Start dependencies

1. Start Redis locally.
2. Start WildMind API locally.
3. Start OpenClaw locally with the `wildmind-bridge` plugin.

### 2. API-first smoke test

Run the local smoke script from `api-gateway-services-wildmind`:

```bash
WILDMIND_AUTH_BEARER=replace-me npm run smoke:openclaw-local
```

Or with a cookie:

```bash
WILDMIND_AUTH_COOKIE="app_session=..." npm run smoke:openclaw-local
```

Expected:

- authenticated request reaches `POST /api/assistant/chat`
- WildMind forwards gateway auth to OpenClaw
- OpenClaw bridge plugin calls `POST /api/tools/invoke`
- final JSON response returns to the caller

### 3. Lightweight tool path

Use a prompt that should trigger a simple tool call first:

- `Show my recent generations`
- `What is my credit balance?`

### 4. High-level workflow path

After the lightweight path works, try a workflow prompt:

- `Create a logo for my coffee brand`
- `Create a 60 second cinematic coffee advertisement`

For approval-driven cases, continue through the existing WildMind orchestrator plan and approval flow.

### 1. Service install

Run on the Lightsail host:

```bash
openclaw gateway status
systemctl --user status openclaw-gateway.service
```

Expected:

- OpenClaw service is installed
- gateway is listening on `127.0.0.1:18789`
- no public nginx route exposes the OpenClaw port

### 2. Gateway auth

Verify the gateway token from the WildMind host:

```bash
curl -sS http://127.0.0.1:18789/v1/chat/completions \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"main","user":"health:check","messages":[{"role":"user","content":"ping"}]}'
```

Expected:

- authenticated response from OpenClaw
- unauthenticated requests fail

### 3. WildMind proxy path

Call `POST /api/assistant/chat` through WildMind with a real user session:

- confirm WildMind calls OpenClaw using gateway auth
- confirm `x-wildmind-user-authorization` is forwarded separately
- confirm `x-wildmind-session-key` matches `userId:sessionId`

### 4. Plugin loading

Confirm the `wildmind-bridge` plugin is loaded by OpenClaw:

- plugin manifest is discovered
- optional tools are enabled for the `main` agent through allowlist config
- tool names do not clash with core OpenClaw tools

### 5. Tool bridge

Trigger one lightweight tool:

1. ask for recent generations
2. OpenClaw selects `get_recent_generations`
3. plugin calls `POST /api/tools/invoke`
4. WildMind returns normalized JSON
5. OpenClaw uses that result in the same turn

### 6. Approval path

Trigger one approval-gated action:

1. ask to delete an asset or upgrade the plan
2. confirm WildMind returns `approval_required: true`
3. verify audit logging records the attempted action
4. verify the approved follow-up call succeeds only after explicit confirmation

### 7. High-level workflow path

Run one real generation scenario:

1. user asks for a logo, campaign, or 60-second advertisement
2. WildMind proxies to OpenClaw
3. OpenClaw chooses a high-level tool such as `generate_content` or `create_campaign`
4. WildMind planner/workflow stack decomposes the request internally
5. provider execution, stitching, and scoring stay inside WildMind
6. final response returns through OpenClaw and WildMind

### 8. Safety checks

Confirm:

- loop detection is enabled
- main agent allowlist is limited to WildMind bridge tools
- gateway token is not exposed to the browser
- OpenClaw port is not reachable publicly
- WildMind still enforces per-user auth and session isolation
