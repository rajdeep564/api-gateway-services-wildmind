## OpenClaw Integration Security (WildMind)

### Non-negotiables

- **Allowlist only**: tool name must exist in `src/openclaw/toolRegistry.ts`.
- **Auth required**: every tool invocation requires valid auth; WildMind derives `userId` from token/session only.
- **Session isolation**: state keys include both `userId` and `sessionId` (`conversation:{userId}:{sessionId}`, `agent:state:{userId}:{sessionId}`).
- **Audit logging**: every tool call is logged via `src/utils/complianceLog.ts`.

### Auth boundary

- **Gateway auth** protects OpenClaw itself.
- **User auth** protects WildMind data and tool execution.
- The browser must never receive the OpenClaw gateway token.
- WildMind API Gateway should call OpenClaw with `OPENCLAW_GATEWAY_TOKEN`.
- OpenClaw plugin/tool bridge should call WildMind Tool API with the original WildMind user authorization.
- WildMind should continue deriving `userId` from verified auth, never from OpenClaw-provided tool args.

### Approval-required tools (policy)

These actions require explicit human approval before execution:

- **generate_content** — Approval is handled in the generation pipeline: conversation → spec_ready → client calls `POST /api/orchestrator/plan` → user reviews plan → `POST /api/orchestrator/approve/:planId`. The Tool API returns the conversation response (e.g. spec_ready); the frontend drives the approval flow.
- **delete_asset** — Tool API returns `approval_required: true` and `planId` unless the request includes `x-wildmind-approved: true` (after user confirmed in UI).
- **upgrade_plan** — Same as delete_asset; approval gate at Tool API.

In v1, approval for delete_asset and upgrade_plan is implemented as a Tool API response shape:

```json
{
  "success": true,
  "approval_required": true,
  "planId": "...",
  "result": {}
}
```

The approval workflow for generation is completed through the existing orchestrator approval endpoint.

### Prompt injection precautions

- Tool results should be treated as **untrusted data**.
- OpenClaw should not blindly paste raw tool output into prompts; prefer structured extraction and truncation.

### Tool policy and loop safety

- OpenClaw should restrict the main agent to the WildMind bridge tools only.
- Enable OpenClaw loop detection in config.
- Keep destructive tools such as `delete_asset` and `upgrade_plan` behind explicit approval.
- Keep provider-level and workflow-engine internals private to WildMind.

### Network policy

- OpenClaw should bind to `127.0.0.1:18789` only.
- Nginx should not expose the OpenClaw port publicly.
- Tool API traffic between OpenClaw and WildMind should stay on the same Lightsail instance over localhost.

