## OpenClaw Local Development

### Goal

Validate the real OpenClaw integration locally before running the same contract on Lightsail.

The local path should prove:

`client -> WildMind API -> OpenClaw Gateway -> wildmind-bridge plugin -> WildMind Tool API -> WildMind workflow`

### UI surfaces using OpenClaw

- **Home hero chat (PromotionalBanner2)**  
  Non-generative Q&A first calls backend `POST /api/assistant/chat` (OpenClaw). On 502 or `OPENCLAW_UNAVAILABLE`, it falls back to the Next.js route that proxies to `POST /api/chat/assistant` (GPT-5 Nano). Same session id is used for OpenClaw context.
- **Floating AI Companion (AiCompanion)**  
  When `NEXT_PUBLIC_USE_OPENCLAW_COMPANION=1` (or `true`) is set in the frontend env, the companion tries backend `POST /api/assistant/chat` first with a stable session id; on failure it falls back to `POST /api/chat/companion` (Replicate). Without the flag, only the companion endpoint is used.

### Canonical local ports

Use these values consistently in local development:

- WildMind API Gateway: `http://127.0.0.1:5000`
- OpenClaw Gateway: `http://127.0.0.1:18789`
- Redis: `redis://127.0.0.1:6379`

### Required local environment

#### WildMind API Gateway

Minimum relevant env values:

```env
PORT=5000
REDIS_URL=redis://127.0.0.1:6379
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=replace-me
OPENCLAW_AGENT_ID=main
```

Also ensure your normal WildMind auth and provider env values are present:

- Firebase auth env vars
- at least one model/provider key used by OpenClaw
- any WildMind provider keys required by the tool you want to test

#### OpenClaw Gateway

Important env values:

```env
OPENCLAW_GATEWAY_TOKEN=replace-me
OPENCLAW_CONFIG_PATH=C:\\path\\to\\services\\openclaw-gateway\\openclaw.config.example.json
OPENCLAW_STATE_DIR=C:\\path\\to\\.openclaw
```

The example plugin config expects WildMind at:

```json
{
  "apiBaseUrl": "http://127.0.0.1:5000"
}
```

#### Environment loading (runner scripts)

The OpenClaw runner scripts (`install-and-run.ps1` and `install-and-run.sh`) load environment variables automatically so you do not need to set them in the terminal:

1. If `services/openclaw-gateway/.env` exists, they load from that file.
2. Otherwise they load from `api-gateway-services-wildmind/.env` (when run from the repo).

Only variables that are **not already set** in the shell are applied. So `OPENCLAW_GATEWAY_TOKEN`, `OPENAI_API_KEY`, and other keys from the backend `.env` are inherited when you run `.\install-and-run.ps1` or `./install-and-run.sh` without exporting them manually.

### Startup order

#### 1. Start Redis

From `api-gateway-services-wildmind`:

```bash
docker-compose up -d redis
```

#### 2. Start WildMind API

For OpenClaw local validation, start the API alone first:

```bash
npm run dev:api
```

If you need async worker behavior too:

```bash
npm run dev:workers
```

Notes:

- `npm run dev` starts both API and workers together.
- `orchestratorWorker` requires `REDIS_URL`.
- some orchestration code can fall back to inline execution in dev, but worker-based flows are more production-like.

#### 3. Start OpenClaw

From `services/openclaw-gateway`, run the script. It loads env from `api-gateway-services-wildmind/.env` when no local `.env` exists (see **Environment loading** above).

##### Windows PowerShell

```powershell
.\install-and-run.ps1 run
```

##### Linux/macOS

```bash
./install-and-run.sh run
```

If you prefer to set the token in the shell: `$env:OPENCLAW_GATEWAY_TOKEN="replace-me"` (PowerShell) or `export OPENCLAW_GATEWAY_TOKEN=replace-me` (Bash).

### Local smoke test

Run from `api-gateway-services-wildmind` with a real WildMind user auth value.

Bearer token:

```bash
WILDMIND_AUTH_BEARER=replace-me npm run smoke:openclaw-local
```

Cookie session:

```bash
WILDMIND_AUTH_COOKIE="app_session=..." npm run smoke:openclaw-local
```

Optional overrides:

```env
WILDMIND_API_BASE_URL=http://127.0.0.1:5000
OPENCLAW_SMOKE_MESSAGE=Show my recent generations
OPENCLAW_SMOKE_SESSION_ID=my-local-session
OPENCLAW_SMOKE_TOOL_TEST=1
```

With `OPENCLAW_SMOKE_TOOL_TEST=1`, the script sends a second request ("What is my credit balance?") and asserts a non-empty reply, to validate the gateway → agent → wildmind-bridge path.

### Suggested local test sequence

#### Lightweight test first

Start with one low-risk prompt:

- `Show my recent generations`
- `What is my credit balance?`

This verifies:

- WildMind auth is valid
- WildMind can reach OpenClaw
- OpenClaw accepts gateway auth
- the `wildmind-bridge` plugin loaded
- the plugin can call WildMind Tool API

#### Workflow test second

Then try one high-level workflow prompt:

- `Create a logo for my coffee brand`
- `Create a cinematic poster for my product`

For complex generation, WildMind may continue through the existing planner and approval path after the OpenClaw turn.

### Known local caveats

- `wild/src/app/api/assistant/chat/route.ts` is used as fallback only (proxies to backend `POST /api/chat/assistant`).
- `POST /api/assistant/converse` is still the requirement-gathering flow for the generative path, not the OpenClaw chat path.
- Some WildMind tools still depend on external services or provider credentials.
- `get_credit_balance` may look healthy in development even if the real credit service is not fully wired, due to dev fallbacks.

### Promote to live after local success

Only after the local API path is stable:

1. keep the same gateway token split between OpenClaw gateway auth and WildMind user auth
2. keep OpenClaw bound to localhost
3. use the same `wildmind-bridge` plugin config shape
4. switch from foreground local runs to managed service install on Lightsail
5. execute `OPENCLAW_VALIDATION.md` again in the live environment
