#!/bin/bash

# deploy.sh
# Usage: ./deploy.sh [service_name]
# Services: wild, wildmindcanvas, api-gateway, credit-service, nginx, all

set -e

SERVICE=$1

# Resolve the directory where this script resides (deployment/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve the Project Root (wildmind-staging/) which is two levels up
# api-gateway-services-wildmind/deployment/ -> api-gateway-services-wildmind/ -> wildmind-staging/
PROJ_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "📂 Project Root: $PROJ_ROOT"
echo "📂 Script Dir: $SCRIPT_DIR"

if [ -z "$SERVICE" ]; then
    echo "Usage: ./deploy.sh [service_name]"
    echo "Available services: wild, wildmindcanvas, api-gateway, credit-service, nginx, all"
    exit 1
fi

# Detect Docker Compose command
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
else
    COMPOSE_CMD="docker compose"
fi
echo "🐳 Using Compose Command: $COMPOSE_CMD"

echo "🚀 Starting deployment for service: $SERVICE"

# Function to pull a repo if it exists
pull_repo() {
    local repo_dir=$1
    local full_path="$PROJ_ROOT/$repo_dir"
    
    if [ -d "$full_path/.git" ]; then
        echo "📥 Pulling latest code for $repo_dir..."
        cd "$full_path"
        
        # Stash changes if any (to avoid conflict errors on server)
        if [[ -n $(git status -s) ]]; then
            echo "   ⚠️  Stashing local changes in $repo_dir..."
            git stash
        fi
        
        git pull origin staging
    else
        echo "⚠️  Repo directory $full_path not found or not a git repo. Skipping pull."
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

# Always run compose from the deployment directory where docker-compose.yml is
cd "$SCRIPT_DIR"

if [ "$SERVICE" == "all" ]; then
    $COMPOSE_CMD up -d --build --remove-orphans
    
elif [ "$SERVICE" == "nginx" ]; then
    if $COMPOSE_CMD up -d --build nginx; then
        echo "✅ Nginx container updated."
    fi
    # Try different reload commands depending on container presence
    docker exec wildmind-nginx nginx -s reload || echo "⚠️ Nginx reload warning (container might be restarting)"

else
    # Standard build and recreate
    $COMPOSE_CMD up -d --build --force-recreate --no-deps $SERVICE
fi

# 4. Cleanup
echo "🧹 Pruning unused images..."
docker image prune -f || true

echo "✅ Deployment of $SERVICE complete!"
