#!/bin/bash
# ============================================================
# deploy.sh — WildMind AI Lightsail Deployment (ECR Pull Model)
#
# Usage: ./deploy.sh [service_name]
# Services: wild, wildmindcanvas, api-gateway, credit-service,
#           mirror-worker, nginx, all
#
# All images are pulled from AWS ECR (pre-built by GitHub Actions).
# NEVER builds images on the server.
# ============================================================
set -e

SERVICE=${1:-all}
ECR_ACCOUNT="213128717650"
ECR_REGION="ap-south-1"
ECR_REGISTRY="${ECR_ACCOUNT}.dkr.ecr.${ECR_REGION}.amazonaws.com"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_SMOKE_GATE="${OPENCLAW_SMOKE_GATE:-1}"

echo "────────────────────────────────────────────────"
echo "📦 WildMind AI — Lightsail Deploy"
echo "📂 Script Dir : $SCRIPT_DIR"
echo "🚀 Service     : $SERVICE"
echo "📡 ECR Registry: $ECR_REGISTRY"
echo "────────────────────────────────────────────────"

restart_openclaw_if_available() {
  if ! command -v openclaw >/dev/null 2>&1; then
    echo "ℹ️  OpenClaw CLI not found on host — skipping OpenClaw restart/check."
    return 0
  fi

  echo "🔁 Restarting OpenClaw gateway..."
  openclaw gateway stop || true
  sleep 2
  openclaw gateway start
}

openclaw_plugin_smoke_gate() {
  if [[ "$OPENCLAW_SMOKE_GATE" != "1" ]]; then
    echo "ℹ️  OPENCLAW_SMOKE_GATE disabled; skipping plugin gate."
    return 0
  fi
  if ! command -v openclaw >/dev/null 2>&1; then
    echo "ℹ️  OpenClaw CLI not found on host — skipping plugin gate."
    return 0
  fi

  echo "🧪 OpenClaw plugin smoke gate..."
  if openclaw plugins list | grep wildmind-bridge | grep loaded >/dev/null; then
    echo "✅ wildmind-bridge loaded"
  else
    echo "❌ wildmind-bridge not loaded — halting deployment"
    exit 1
  fi
}

# ── 1. Detect compose command ──────────────────────────────
if command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  COMPOSE="docker compose"
fi
echo "🐳 Compose cmd : $COMPOSE"

# ── 2. Authenticate with ECR ───────────────────────────────
echo "🔑 Logging in to ECR..."
aws ecr get-login-password --region "$ECR_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

# ── 3. Pull latest images ──────────────────────────────────
cd "$SCRIPT_DIR"

echo "⬇️  Pulling images from ECR..."
if [ "$SERVICE" == "all" ]; then
  $COMPOSE pull
else
  $COMPOSE pull "$SERVICE"
fi

# ── 4. Deploy / restart ────────────────────────────────────
echo "▶️  Deploying $SERVICE..."
if [ "$SERVICE" == "all" ]; then
  $COMPOSE up -d --remove-orphans

elif [ "$SERVICE" == "nginx" ]; then
  $COMPOSE up -d --no-deps --force-recreate nginx
  docker exec wildmind-nginx nginx -s reload 2>/dev/null || true

else
  $COMPOSE up -d --no-deps --force-recreate "$SERVICE"
fi

# ── 4.5 OpenClaw restart + plugin gate (for API-related deploys) ────────────
if [ "$SERVICE" == "all" ] || [ "$SERVICE" == "api-gateway" ]; then
  restart_openclaw_if_available
  openclaw_plugin_smoke_gate
fi

# ── 5. Cleanup ─────────────────────────────────────────────
echo "🧹 Pruning old images..."
docker image prune -f || true

echo "✅ Deploy of '$SERVICE' complete!"
$COMPOSE ps