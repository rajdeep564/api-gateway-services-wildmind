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

echo "────────────────────────────────────────────────"
echo "📦 WildMind AI — Lightsail Deploy"
echo "📂 Script Dir : $SCRIPT_DIR"
echo "🚀 Service     : $SERVICE"
echo "📡 ECR Registry: $ECR_REGISTRY"
echo "────────────────────────────────────────────────"

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

# ── 5. Cleanup ─────────────────────────────────────────────
echo "🧹 Pruning old images..."
docker image prune -f || true

echo "✅ Deploy of '$SERVICE' complete!"
$COMPOSE ps
