## OpenClaw Deployment (Lightsail: single instance)

### Core deployment rule

- OpenClaw is the **agent runtime** and stays private on the same Lightsail box.
- WildMind remains the public backend and workflow executor.
- OpenClaw is installed as the real upstream product, not from source in this repo.

### Target layout

- `nginx` public entrypoint
- `api-gateway-services-wildmind` public backend
- `openclaw-gateway` private runtime on `127.0.0.1:18789`
- Redis, workers, planner, workflow engine stay in WildMind

### Recommended install flow

Prefer the official OpenClaw service install flow on Linux:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw onboard --install-daemon
```

If OpenClaw is already available:

```bash
openclaw gateway install
openclaw gateway status
```

For local or foreground verification (temporary/manual only):

```bash
OPENCLAW_CONFIG_PATH=/srv/wildmind/services/openclaw-gateway/openclaw.config.example.json \
OPENCLAW_STATE_DIR=/srv/wildmind/.openclaw \
openclaw gateway --host 127.0.0.1 --port 18789
```

Do not keep `OPENCLAW_CONFIG_PATH` in the systemd service environment for live mode.
Live mode should read `~/.openclaw/openclaw.json` configured via `openclaw config set ...`.

### Repo-owned deployment wrapper

This repo only owns the wrapper in `services/openclaw-gateway/`:

- `README.md`
- `install-and-run.sh`
- `openclaw.config.example.json`
- `plugin-wildmind/`
- optional PM2 fallback

### OpenClaw config expectations

OpenClaw should be configured to:

- bind on loopback only
- enable the chat completions endpoint
- require gateway token auth
- set secure session scoping with `session.dmScope`
- enable `tools.loopDetection.enabled`
- allow the `wildmind-bridge` plugin tools for the main agent
- load a strong primary model plus fallbacks
- run with restricted tool scope (`tools.profile=minimal`, `agents.list[0].tools.deny=["*"]`, explicit WildMind `alsoAllow`)
- disable external channels and non-required memory/browser plugins

### WildMind -> OpenClaw config

Required WildMind env:

- `OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789`
- `OPENCLAW_GATEWAY_TOKEN=...`
- optional `OPENCLAW_AGENT_ID=main`

Token parity requirement:

- `OPENCLAW_GATEWAY_TOKEN` in WildMind API env must match OpenClaw gateway token configured in `~/.openclaw/openclaw.json`.

WildMind should call OpenClaw with:

- `Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}`
- forwarded user auth in a separate header such as `x-wildmind-user-authorization`
- stable session identity derived from `userId:sessionId`

### OpenClaw -> WildMind config

The `wildmind-bridge` plugin should call:

- `POST http://127.0.0.1:<WILDMIND_PORT>/api/tools/invoke`
- optional `GET http://127.0.0.1:<WILDMIND_PORT>/api/tools/schemas`

Redis parity requirement for plugin auth cache:

- OpenClaw plugin env and WildMind API env must point to the same Redis.
- `REDIS_URL` must match.
- `REDIS_PREFIX` must match (expected `sess:app:`).

Minimal verification commands on server:

```bash
grep OPENCLAW_GATEWAY_TOKEN /srv/wildmind-staging/api-gateway-services-wildmind/deployment/.env.production
openclaw config get gateway.auth.token

grep REDIS_URL /srv/wildmind-staging/api-gateway-services-wildmind/deployment/.env.production
grep REDIS_PREFIX /srv/wildmind-staging/api-gateway-services-wildmind/deployment/.env.production

# OpenClaw service environment (if using EnvironmentFile)
grep REDIS_URL /etc/openclaw-gateway.env
grep REDIS_PREFIX /etc/openclaw-gateway.env
```

WildMind should continue enforcing:

- tool allowlist
- per-user auth
- approval gates
- audit logging

### Promote local contract to Lightsail

Do not invent a separate production-only contract after local success. Promote the same tested shape:

- keep WildMind -> OpenClaw on `http://127.0.0.1:18789`
- keep the same gateway token separation from WildMind user auth
- keep the same `wildmind-bridge` plugin config structure
- keep the same stable session identity format such as `userId:sessionId`
- rerun the same validation order used locally:
  1. gateway auth
  2. WildMind proxy path
  3. plugin loading
  4. lightweight tool call
  5. high-level workflow scenario

The main difference in Lightsail should be process management, not application behavior:

- local: foreground process or manual developer start
- live: OpenClaw-managed service install and localhost-only exposure

### Nginx and network policy

- Never expose `127.0.0.1:18789` publicly.
- Only expose WildMind through nginx.
- Keep OpenClaw traffic internal to the Lightsail instance.

### Fallback process managers

PM2 or Docker are acceptable fallback/operator choices, but they are not the primary production recommendation for this plan. Prefer OpenClaw-native service install first.

