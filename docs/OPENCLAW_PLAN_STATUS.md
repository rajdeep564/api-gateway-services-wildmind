# OpenClaw Integration — Plan Status

## Where is the microservice?

The **OpenClaw microservice** is the real OpenClaw Gateway (external product, [docs.openclaw.ai](https://docs.openclaw.ai)). It is **not** source code in this repo.

| What | Where |
|------|--------|
| **Runbook + deployment wrapper** | `services/openclaw-gateway/` (this repo root, next to `api-gateway-services-wildmind`) |
| **Install/run script** | `services/openclaw-gateway/install-and-run.sh` |
| **OpenClaw plugin bridge** | `services/openclaw-gateway/plugin-wildmind/` |
| **OpenClaw binary/runtime** | You install it on the server via the official OpenClaw install flow and run it as a service on `127.0.0.1:18789` |

WildMind only provides the **Tool API** (`POST /api/tools/invoke`) and the **chat proxy** (`POST /api/assistant/chat` → OpenClaw). OpenClaw runs as a separate process and calls back into WildMind.

---

## Phase plan status

| Phase | Status | Notes |
|-------|--------|--------|
| **1 — Tool API** | Done | `POST /api/tools/invoke`, `GET /api/tools/schemas`, allowlist, auth, audit, normalized errors |
| **2 — Docs + deployment model correction** | Done | Wrapper docs now reflect real OpenClaw service install, gateway auth, plugin bridge, loop detection, and session scoping |
| **3 — OpenClaw bridge skeleton** | Done | `plugin-wildmind/` added with manifest, tool registration scaffold, and WildMind Tool API client |
| **4 — Assistant routing** | In progress | Chat proxy exists; next correction is clean separation of gateway auth vs user auth forwarding |
| **5 — Tool policy + approvals** | In progress | WildMind approval gates exist; OpenClaw config now scopes toward bridge tools, but production validation is still required |

---

## What is left

- **Finish auth boundary correction** — WildMind should call OpenClaw with gateway auth while forwarding user auth separately for plugin tool calls.
- **Validate plugin loading in a real OpenClaw install** — confirm manifest discovery, optional tool opt-in, and runtime context access for forwarded user auth.
- **Run Lightsail validation** — service install, localhost reachability, tool bridge, approvals, audit, and one full end-to-end generation scenario.
- **Replace remaining WildMind stubs** — `add_to_portfolio`, `add_text`, `get_user_style`, `save_user_preference`.
