#!/bin/bash

# SSL Setup & Bootstrap Script
# Usage: ./setup_ssl.sh

DOMAINS=("dev-api.wildmindai.com" "onstaging-wildmindai.com" "onstaging-studios.wildmindai.com")
EMAIL="your-email@example.com" # Change this or rely on interactive prompt if needed (command below uses interactive)
STAGING=0 # Set to 1 for testing (LetsEncrypt Staging), 0 for Production

echo "🧱 STEP 1: Preparing folders on HOST..."
mkdir -p ../../../nginx
mkdir -p ../../../certbot/conf/live
mkdir -p ../../../certbot/www
echo "✅ Folders created."

echo "🧱 STEP 2: Creating Dummy Certificates (to allow Nginx to start)..."
for domain in "${DOMAINS[@]}"; do
  dir="../../../certbot/conf/live/$domain"
  if [ ! -f "$dir/fullchain.pem" ]; then
    echo "   Creating dummy cert for $domain..."
    mkdir -p "$dir"
    openssl req -x509 -nodes -newkey rsa:4096 -days 1 \
      -keyout "$dir/privkey.pem" \
      -out "$dir/fullchain.pem" \
      -subj "/CN=localhost"
  else
    echo "   Certificate for $domain already exists."
  fi
done

echo "🧱 STEP 3: Starting Nginx..."
# Ensure we are in the deployment directory
cd "$(dirname "$0")"
docker-compose up -d nginx
echo "   Waiting for Nginx to start..."
sleep 5

echo "🧱 STEP 4: Deleting Dummy Certs & Requesting Real Ones..."
# We delete dummy certs so Certbot sees them as missing/invalid and issues new ones
for domain in "${DOMAINS[@]}"; do
  echo "   Requesting cert for $domain..."
  rm -rf "../../../certbot/conf/live/$domain"
  
  # Run Certbot
  docker run --rm \
    -v "$(pwd)/../../../certbot/conf:/etc/letsencrypt" \
    -v "$(pwd)/../../../certbot/www:/var/www/certbot" \
    certbot/certbot certonly --webroot -w /var/www/certbot \
    -d "$domain" \
    --email "$EMAIL" \
    --rsa-key-size 4096 \
    --agree-tos \
    --force-renewal \
    --non-interactive
done

echo "🧱 STEP 5: Reloading Nginx with Real Certs..."
docker exec wildmind-nginx nginx -s reload

echo "✅ SSL Setup Complete! Verify at https://dev-api.wildmindai.com"
