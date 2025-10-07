#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/app/staging"
cd "$APP_DIR"

: "${SERVICE_ACCOUNT_PATH:?SERVICE_ACCOUNT_PATH not set}"

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
VAL="$(aws ssm get-parameter --name "$SERVICE_ACCOUNT_PATH" --with-decryption --query 'Parameter.Value' --output text --region "$REGION")"

# Base64 to avoid newline/quote issues in .env
if base64 --help 2>&1 | grep -q '\-w'; then
  B64="$(printf '%s' "$VAL" | base64 -w 0)"
else
  B64="$(printf '%s' "$VAL" | base64)"
fi

echo "FIREBASE_SERVICE_ACCOUNT_B64=$B64" >> .env