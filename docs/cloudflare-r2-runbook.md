# Cloudflare R2 Integration Runbook

Use this as the practical checklist for adding Cloudflare R2 as a media storage layer.

## Mental Model

- Supabase stores app data, metadata, and canonical media references.
- R2 stores the heavy media files.
- Private media is stored as `r2://bucket/object-key` in Supabase.
- Private media is displayed through short-lived server-generated signed GET URLs.
- Public published media is stored as stable custom-domain URLs such as `https://media-stage.kissago.cc/...`.
- Old Supabase Storage URLs can continue working during a hybrid rollout.

## 1. Choose Buckets

Create two buckets per environment:

```text
Public media bucket:  kissago-media-staging
Private media bucket: kissago-media-private-staging
```

For production later, use separate production buckets and domain names.

## 2. Create R2 Buckets

```bash
npx wrangler login
npx wrangler r2 bucket create kissago-media-staging
npx wrangler r2 bucket create kissago-media-private-staging
npx wrangler r2 bucket list
```

## 3. Apply CORS

R2 CORS should allow the app origins that upload directly from the browser.

Example staging origins:

```text
https://kissagostage.vercel.app
https://*.vercel.app
http://localhost:3000
```

Apply:

```bash
npx wrangler r2 bucket cors set kissago-media-staging --file cloudflare/r2/cors-staging.json
npx wrangler r2 bucket cors set kissago-media-private-staging --file cloudflare/r2/cors-staging.json
npx wrangler r2 bucket cors list kissago-media-staging
npx wrangler r2 bucket cors list kissago-media-private-staging
```

## 4. Create R2 API Token

Cloudflare Dashboard:

```text
Storage & databases
→ R2
→ Manage API Tokens
→ Create API Token
```

Recommended staging token:

```text
Name: kissago-r2-staging-read-write
Permissions: Object Read & Write
Bucket access: Specific buckets only
Buckets:
  - kissago-media-staging
  - kissago-media-private-staging
```

Save:

```text
CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
```

Never expose R2 access keys with `NEXT_PUBLIC_`.

## 5. Add Cloudflare DNS Zone

If you want a custom R2 media domain like `media-stage.kissago.cc`, Cloudflare must manage DNS for `kissago.cc`.

Cloudflare Dashboard:

```text
Domains
→ Add domain
→ kissago.cc
→ Select Free plan
→ Review DNS records
```

Set Vercel records to DNS-only at first:

```text
A      kissago.cc   216.198.79.1
CNAME  www          <vercel-dns-target>
CNAME  dev          <vercel-dns-target>
```

Keep mail records DNS-only:

```text
MX
TXT SPF
DKIM/DMARC if present
```

At the registrar, replace old nameservers with Cloudflare nameservers.

Example:

```text
merlin.ns.cloudflare.com
zoe.ns.cloudflare.com
```

Wait until Cloudflare shows the zone as active.

## 6. Connect Public R2 Custom Domain

Connect only the public bucket.

Cloudflare Dashboard:

```text
Storage & databases
→ R2
→ kissago-media-staging
→ Settings
→ Custom Domains
→ Connect Domain
```

Domain:

```text
media-stage.kissago.cc
```

Do not connect a custom domain to the private bucket.

Verify:

```bash
npx wrangler r2 bucket domain list kissago-media-staging
npx wrangler r2 bucket domain list kissago-media-private-staging
```

Expected:

```text
kissago-media-staging: media-stage.kissago.cc active
kissago-media-private-staging: no custom domains
```

## 7. Add Environment Variables

Staging Vercel env:

```env
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

Because Kissago staging runs as the staging Vercel project's production deployment, add these to that project's production env.
`R2_ENVIRONMENT=staging` is the explicit safety signal that allows R2 on the staging Vercel project even though Vercel labels that deployment as `production`. Keep `R2_PRODUCTION_ENABLED=false` there.

## 8. Apply Database Migration

Apply the staging Supabase migration first:

```text
supabase/migrations/045_cloudflare_r2_media_assets.sql
```

This adds:

```text
media_assets metadata table
media storage feature flags
```

Apply to production Supabase only after staging validation.

## 9. Expected Upload Behavior

Private beat/storyboard upload:

```text
Browser compresses image
→ browser requests server presigned R2 PUT
→ browser uploads optimized file to private R2
→ server confirms object with HEAD
→ Supabase stores r2://kissago-media-private-staging/stories/...
```

Private playback/display:

```text
Supabase stores r2://...
→ server resolves short-lived signed GET URL
→ browser displays temporary R2 URL
```

Public cover upload:

```text
Cover is optimized/generated
→ server uploads to public R2
→ Supabase stores https://media-stage.kissago.cc/stories/...
```

Supabase fallback:

```text
R2 upload fails
→ fallback to Supabase Storage
```

If R2 succeeds, do not duplicate the same payload to Supabase.

## 10. Manual Verification

Private upload checks:

```sql
select
  asset_type,
  storage_provider,
  bucket,
  object_key,
  public_url,
  is_public,
  created_at
from media_assets
order by created_at desc
limit 20;
```

Expected private row:

```text
storage_provider = r2
bucket = kissago-media-private-staging
public_url = null
is_public = false
```

Beat row check:

```sql
select
  story_id,
  node_id,
  image_url,
  image_gallery
from beats
order by created_at desc
limit 20;
```

Expected private reference:

```text
r2://kissago-media-private-staging/stories/...
```

Public cover check:

```sql
select
  asset_type,
  storage_provider,
  bucket,
  object_key,
  public_url,
  is_public,
  cache_control,
  created_at
from media_assets
where bucket = 'kissago-media-staging'
order by created_at desc
limit 20;
```

Expected public row:

```text
public_url = https://media-stage.kissago.cc/stories/...
is_public = true
cache_control = public, max-age=31536000, immutable
```

HTTP check:

```bash
curl -I https://media-stage.kissago.cc/stories/<storyId>/covers/<file>.webp
```

Expected:

```text
HTTP 200
Content-Type: image/webp
Cache-Control: public, max-age=31536000, immutable
```

## 11. Production Rollout Later

For production:

- Create separate production buckets.
- Use a production public media domain.
- Add production R2 env vars to the production Vercel project only.
- Keep `R2_PRODUCTION_ENABLED=false` until ready.
- Apply migration to production Supabase only after staging passes.
- Optionally migrate old Supabase public assets to R2 with a controlled script.
- Keep Supabase fallback available during rollout.

## 12. Security Checklist

- Do not expose `R2_ACCESS_KEY_ID` or `R2_SECRET_ACCESS_KEY` to the browser.
- Do not prefix R2 secrets with `NEXT_PUBLIC_`.
- Keep private bucket public access disabled.
- Do not connect a custom domain to the private bucket.
- Store private media as `r2://...`, not public URLs.
- Use signed GET URLs only at runtime.
- Rotate any token that was pasted into logs, chat, screenshots, or ticket systems.
