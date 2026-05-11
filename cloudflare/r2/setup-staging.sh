#!/usr/bin/env bash
set -euo pipefail

PUBLIC_BUCKET="${R2_BUCKET_NAME:-kissago-media-staging}"
PRIVATE_BUCKET="${R2_PRIVATE_BUCKET_NAME:-kissago-media-private-staging}"
CORS_FILE="cloudflare/r2/cors-staging.json"

echo "This script assumes Wrangler is installed or available through npx."
echo "If you are not logged in, run: npx wrangler login"

npx wrangler r2 bucket create "$PUBLIC_BUCKET"
npx wrangler r2 bucket create "$PRIVATE_BUCKET"
npx wrangler r2 bucket cors set "$PUBLIC_BUCKET" --file "$CORS_FILE"
npx wrangler r2 bucket cors set "$PRIVATE_BUCKET" --file "$CORS_FILE"
npx wrangler r2 bucket list

echo "Next manual step: connect media-stage.kissago.cc to $PUBLIC_BUCKET only."
