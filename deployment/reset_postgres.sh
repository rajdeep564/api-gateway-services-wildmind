#!/bin/bash

# CAUTION: This script DELETES the credit-service database data.
# Use only to reset credentials loop logic.

echo "🛑 Stopping credit-service-postgres..."
docker stop credit-service-postgres || true
docker rm credit-service-postgres || true

echo "🗑️ Removing Docker Volume (deployment_postgres-data)..."
# Try both common names depending on folder name
docker volume rm deployment_postgres-data || true
docker volume rm wildmind-staging_postgres-data || true
docker volume rm api-gateway-services-wildmind_postgres-data || true

echo "🚀 Restarting Postgres with NEW credentials..."
docker-compose up -d credit-postgres

echo "✅ Postgres reset! Password is now: wildmind"
