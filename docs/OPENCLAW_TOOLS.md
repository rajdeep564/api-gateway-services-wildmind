## OpenClaw Tool API (WildMind)

OpenClaw calls WildMind tools over HTTP. WildMind enforces **auth**, **allowlist**, and **audit logging**.

### Endpoint

`POST /api/tools/invoke`

### Request

```json
{
  "tool": "generate_content",
  "args": {
    "message": "create a cinematic coffee ad",
    "sessionId": "abc123"
  }
}
```

- `tool` is required and must match a tool registered in `src/openclaw/toolRegistry.ts`.
- `args` is an object. `sessionId` is passed inside args for tools that require session context.
- Auth is required (cookie session or `Authorization: Bearer ...`).

### Success response

```json
{
  "success": true,
  "result": {}
}
```

### Failure response

```json
{
  "success": false,
  "error_code": "MODEL_TIMEOUT",
  "error_message": "Provider timeout",
  "retryable": true
}
```

### Error codes (v1)

- `UNKNOWN_TOOL`
- `VALIDATION_ERROR`
- `RATE_LIMITED`
- `MODEL_TIMEOUT`
- `NOT_IMPLEMENTED`
- `INTERNAL_ERROR`

### Approval-required behavior

- **generate_content** — Approval is handled in the generation pipeline (orchestrator plan → user approves). Tool returns conversation response (e.g. spec_ready); frontend drives plan and approve.
- **delete_asset**, **upgrade_plan** — Tool API returns `approval_required: true` and `planId` unless the caller sends `x-wildmind-approved: true` after the user confirmed in the UI.

### Tool list (allowlist)

| Category   | Tool name                  | Notes |
| ---------- | -------------------------- | ----- |
| Generation | generate_content           | Approval via orchestrator flow |
| Generation | generate_logo, generate_image, generate_video, generate_music | Stub (NOT_IMPLEMENTED) or alias to generate_content |
| Canvas     | edit_image, upscale_image, remove_background | Implemented (remove_background via workflow) |
| Canvas     | add_text                   | Stub (NOT_IMPLEMENTED) |
| Gallery    | get_user_assets, get_recent_generations | Implemented |
| Gallery    | get_asset, delete_asset, add_to_portfolio | get_asset and delete_asset implemented; add_to_portfolio stub |
| Account    | get_credit_balance, upgrade_plan | Implemented; upgrade_plan approval-required |
| Memory     | search_similar_creations   | Implemented (stub until pgvector) |
| Memory     | get_user_style, save_user_preference | Stub (NOT_IMPLEMENTED) |
| Navigation | navigate_page             | Implemented |
| Generation | generate_logo, generate_image, generate_video, generate_music | Implemented (alias to generate_content with task hint) |

### Tool schemas (optional)

`GET /api/tools/schemas` returns the registered tool definitions (name/description/parameters).

