
#!/bin/bash

# Deployment Script for Contabo
# Presumes directory structure:
# /root/wildmind-staging/
#   ├── api-gateway-services-wildmind/ (clone of staging)
#   ├── wild/ (clone of staging)
#   ├── wildmindcanvas/ (clone of staging)
#   └── credit-service/ (clone of staging)

echo "🚀 Starting Deployment..."

# 1. Pull latest changes
for dir in api-gateway-services-wildmind wild wildmindcanvas credit-service; do
  if [ -d "$dir" ]; then
    echo "⬇️ Pulling latest changes for $dir..."
    cd $dir
    git pull origin staging
    cd ..
  else
    echo "⚠️ Directory $dir not found!"
  fi
done

# 2. Build and Restart Docker Containers
echo "🐳 Rebuilding and Restarting Containers..."
# We run docker-compose from the deployment folder inside api-gateway, but set context to root level
# NOTE: The docker-compose.yml assumes it's running from api-gateway-services-wildmind/deployment/
cd api-gateway-services-wildmind/deployment

docker-compose down
docker-compose up --build -d

echo "✅ Deployment Complete! verify with 'docker ps'"
