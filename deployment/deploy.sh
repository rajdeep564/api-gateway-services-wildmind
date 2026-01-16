#!/bin/bash

# deploy.sh
# Usage: ./deploy.sh [service_name]
# Services: wild, wildmindcanvas, api-gateway, credit-service, nginx, all

set -e

SERVICE=$1
# We assume this script is running from wildmind-staging/api-gateway-services-wildmind/deployment
# So the root of the "wildmind-staging" folder is two levels up: ../../
ROOT_DIR="../../"

if [ -z "$SERVICE" ]; then
    echo "Usage: ./deploy.sh [service_name]"
    echo "Available services: wild, wildmindcanvas, api-gateway, credit-service, nginx, all"
    exit 1
fi

echo "🚀 Starting deployment for service: $SERVICE"

# Function to pull a repo if it exists
pull_repo() {
    local repo_dir=$1
    if [ -d "$ROOT_DIR/$repo_dir/.git" ]; then
        echo "📥 Pulling latest code for $repo_dir..."
        cd "$ROOT_DIR/$repo_dir"
        git pull origin staging
        cd - > /dev/null
    else
        echo "⚠️  Repo $repo_dir not found or not a git repo. Skipping pull."
    fi
}

# 1. ALWAYS Pull api-gateway first (to update docker-compose.yml and this script itself)
pull_repo "api-gateway-services-wildmind"

# 2. Pull the specific service repo
if [ "$SERVICE" == "wild" ]; then
    pull_repo "wild"
elif [ "$SERVICE" == "wildmindcanvas" ]; then
    pull_repo "wildmindcanvas"
elif [ "$SERVICE" == "credit-service" ]; then
    pull_repo "credit-service"
elif [ "$SERVICE" == "all" ]; then
    pull_repo "wild"
    pull_repo "wildmindcanvas"
    pull_repo "credit-service"
fi

# 3. Deploy logic
echo "🔄 Rebuilding $SERVICE..."

# Ensure we are in the deployment directory
cd "$(dirname "$0")"

if [ "$SERVICE" == "all" ]; then
    docker-compose up -d --build --remove-orphans
    
elif [ "$SERVICE" == "nginx" ]; then
    if docker-compose up -d --build nginx; then
        echo "✅ Nginx container updated."
    fi
    docker exec wildmind-nginx nginx -s reload || echo "⚠️ Nginx reload warning"

else
    # Build with --no-cache to ensure ARGs are picked up if they changed
    # We only do --no-cache if we suspect build args issues, but for standard usage:
    # docker-compose build $SERVICE
    
    # Actually, let's use standard build first. If args in compose changed, it should pick up.
    docker-compose build $SERVICE
    docker-compose up -d --no-deps $SERVICE
fi

# 4. Cleanup
echo "🧹 Pruning unused images..."
docker image prune -f

echo "✅ Deployment of $SERVICE complete!"
