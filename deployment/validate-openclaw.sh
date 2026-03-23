#!/usr/bin/env bash
set -euo pipefail

# Validate WildMind + OpenClaw production wiring on Lightsail.
# Run this on the server host after deployment.
#
# Optional env:
#   OPENCLAW_URL           (default: http://127.0.0.1:18789)
#   WILDMIND_API_URL       (default: http://127.0.0.1:5000)
#   OPENCLAW_GATEWAY_TOKEN (optional)
#   TEST_TOKEN             (Bearer token for authenticated stream smoke test)
#   TEST_SESSION_ID        (default: smoke-1)
#   TEST_MESSAGE           (default: I want a logo)

OPENCLAW_URL="${OPENCLAW_URL:-http://127.0.0.1:18789}"
WILDMIND_API_URL="${WILDMIND_API_URL:-http://127.0.0.1:5000}"
TEST_SESSION_ID="${TEST_SESSION_ID:-smoke-1}"
TEST_MESSAGE="${TEST_MESSAGE:-I want a logo}"

echo "== OpenClaw process checks =="
openclaw gateway status || true
if openclaw plugins list | grep wildmind-bridge | grep loaded >/dev/null; then
  echo "PASS: wildmind-bridge loaded"
else
  echo "FAIL: wildmind-bridge not loaded"
  exit 1
fi

echo "== Loopback bind check (18789) =="
if ss -tlnp | grep 18789 | grep -E '127\.0\.0\.1|::1' >/dev/null; then
  echo "PASS: OpenClaw listens on loopback"
else
  echo "FAIL: OpenClaw is not loopback-only"
  ss -tlnp | grep 18789 || true
  exit 1
fi

echo "== OpenClaw health check =="
if [[ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
  curl -fsS "${OPENCLAW_URL}/health" -H "Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}" >/dev/null
else
  curl -fsS "${OPENCLAW_URL}/health" >/dev/null
fi
echo "PASS: OpenClaw health endpoint reachable"

echo "== WildMind health check =="
curl -fsS "${WILDMIND_API_URL}/health" >/dev/null
echo "PASS: WildMind health endpoint reachable"

echo "== Assistant stream smoke test (requires TEST_TOKEN) =="
if [[ -z "${TEST_TOKEN:-}" ]]; then
  echo "SKIP: TEST_TOKEN not set (set TEST_TOKEN to run authenticated stream smoke test)"
else
  payload=$(printf '{"message":"%s","sessionId":"%s"}' "${TEST_MESSAGE}" "${TEST_SESSION_ID}")
  # Read only first chunk so command does not block forever on SSE.
  if curl -N -sS -X POST "${WILDMIND_API_URL}/api/assistant/stream" \
    -H "Authorization: Bearer ${TEST_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${payload}" | head -n 8 >/tmp/wildmind-openclaw-stream-smoke.log; then
    echo "PASS: stream endpoint returned SSE output"
  else
    echo "FAIL: stream endpoint smoke test failed"
    exit 1
  fi
fi

echo "== Redis pluginAuth key check (informational) =="
if command -v redis-cli >/dev/null 2>&1; then
  redis-cli keys "sess:app:pluginAuth:*" | head -n 20 || true
else
  echo "SKIP: redis-cli not installed"
fi

echo "All validation checks completed."

