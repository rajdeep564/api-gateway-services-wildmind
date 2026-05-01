#!/bin/bash

# SSL Setup & Bootstrap Script (Production)
# Usage: ./setup_ssl_prod.sh

set -e

DOMAINS=("api.wildmindai.com" "www.wildmindai.com" "studios.wildmindai.com")
EMAIL="your-email@example.com"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "STEP 1: Preparing certbot folders..."
mkdir -p /home/ubuntu/wildmind/certbot/conf/live
mkdir -p /home/ubuntu/wildmind/certbot/www

echo "STEP 2: Creating dummy certificates to bootstrap nginx..."
for domain in "${DOMAINS[@]}"; do
  dir="/home/ubuntu/wildmind/certbot/conf/live/$domain"
  if [ ! -f "$dir/fullchain.pem" ]; then
    mkdir -p "$dir"
    openssl req -x509 -nodes -newkey rsa:4096 -days 1 \
      -keyout "$dir/privkey.pem" \
      -out "$dir/fullchain.pem" \
      -subj "/CN=localhost"
  fi
done

echo "STEP 3: Starting nginx with production compose..."
docker compose -f docker-compose.prod.yml up -d nginx
sleep 5

echo "STEP 4: Requesting real certificates..."
for domain in "${DOMAINS[@]}"; do
  rm -rf "/home/ubuntu/wildmind/certbot/conf/live/$domain"
  docker run --rm \
    -v "/home/ubuntu/wildmind/certbot/conf:/etc/letsencrypt" \
    -v "/home/ubuntu/wildmind/certbot/www:/var/www/certbot" \
    certbot/certbot certonly --webroot -w /var/www/certbot \
    -d "$domain" \
    --email "$EMAIL" \
    --rsa-key-size 4096 \
    --agree-tos \
    --force-renewal \
    --non-interactive
done

echo "STEP 5: Reloading nginx..."
docker exec wildmind-nginx nginx -s reload

echo "SSL setup complete for production domains."
