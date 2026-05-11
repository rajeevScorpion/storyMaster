# Kissago R2 Staging Setup

R2 is enabled for staging through environment variables and Global Settings. The private bucket must not be connected to a public/custom domain.

Kissago staging runs from `https://kissagostage.vercel.app`; that origin is included explicitly in the R2 CORS policy.

## Wrangler Commands

```bash
npx wrangler login
npx wrangler r2 bucket create kissago-media-staging
npx wrangler r2 bucket create kissago-media-private-staging
npx wrangler r2 bucket cors set kissago-media-staging --file cloudflare/r2/cors-staging.json
npx wrangler r2 bucket cors set kissago-media-private-staging --file cloudflare/r2/cors-staging.json
npx wrangler r2 bucket list
```

Or run the helper script for your shell:

```bash
bash cloudflare/r2/setup-staging.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File cloudflare/r2/setup-staging.ps1
```

## Manual Cloudflare Steps

1. Create an R2 API token:
   - Cloudflare Dashboard -> Storage & databases -> R2 -> Manage API Tokens -> Create API Token
   - Name: `kissago-r2-staging-read-write`
   - Permissions: Object Read & Write
   - Bucket access: specific buckets only
   - Buckets: `kissago-media-staging` and `kissago-media-private-staging`
   - Save `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`

2. Connect the public custom domain:
   - Cloudflare Dashboard -> R2 -> Buckets -> `kissago-media-staging` -> Settings -> Custom Domains -> Connect Domain
   - Domain: `media-stage.kissago.cc`
   - Confirm DNS and public access.

3. Keep `kissago-media-private-staging` private:
   - Do not connect a custom domain.
   - Do not enable public delivery for this bucket.
   - Kissago stores private objects as `r2://bucket/key` and resolves playback URLs with short-lived signed GET URLs server-side.

## Vercel Staging Env

```bash
CLOUDFLARE_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=kissago-media-staging
R2_PRIVATE_BUCKET_NAME=kissago-media-private-staging
R2_PUBLIC_BASE_URL=https://media-stage.kissago.cc
R2_ENDPOINT=https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ENABLED=true
R2_STORAGE_MODE=hybrid
R2_ENVIRONMENT=staging
R2_PRODUCTION_ENABLED=false
R2_PUBLIC_DELIVERY_ENABLED=true
R2_CACHE_CONTROL_PUBLIC=public, max-age=31536000, immutable
R2_CACHE_CONTROL_PRIVATE=private, max-age=3600
```

Never prefix `R2_ACCESS_KEY_ID` or `R2_SECRET_ACCESS_KEY` with `NEXT_PUBLIC_`.

## Production Setup

After creating the production buckets and production R2 API token, run:

```powershell
powershell -ExecutionPolicy Bypass -File cloudflare/r2/setup-production.ps1
```

Defaults:

```text
Public bucket: kissago-media-production
Private bucket: kissago-media-private-production
Public domain: media.kissago.cc
Zone ID: c7e22e411b36b4f531af9682acf8909a
```

Override with parameters if needed:

```powershell
powershell -ExecutionPolicy Bypass -File cloudflare/r2/setup-production.ps1 -ZoneId <ZONE_ID> -PublicDomain media.kissago.cc
```

The script connects only the public production bucket to the custom domain. The private production bucket must remain without a custom domain or public `r2.dev` URL.
