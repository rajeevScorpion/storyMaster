# Cloudflare R2 Staging Integration

## Current Media Flow Summary

- Browser-side image compression produces optimized files and preview URLs before upload.
- Existing client uploads enter `uploadAsset(bucket, path, uploadBody, options)` in `lib/supabase/storage.ts`.
- Draft beat images, storyboard uploads, character reference sheets, portraits, and narration audio historically use private Supabase `story-assets`.
- Published covers and social/YouTube/reel assets historically use public Supabase `public-storylines`.
- Server load paths sign private Supabase URLs before they reach the browser.

## Kissago Environment Model

- Local feature branches are tested locally first.
- The `dev` branch is the staging release branch and is deployed as production on the staging Vercel project: `https://kissagostage.vercel.app`.
- Staging uses a separate Supabase project from production.
- The `main` branch is production and is deployed on the production Vercel project: `https://kissago.cc`.
- Production uses a separate Supabase project from staging.
- Migrations are applied to staging first, verified on web/mobile, then applied to production Supabase after rollout confidence.
- R2 is enabled only for staging in this phase. Production R2 remains guarded by `R2_PRODUCTION_ENABLED=false` until a future explicit rollout.

## New Staged R2 Flow Summary

- Browser-selected optimized `File`/`Blob` payloads request a server-generated R2 presigned PUT URL.
- Presign, completion, and delete routes verify that the authenticated user owns the target story/storyline scope.
- The browser uploads directly to R2 and then calls a completion route.
- The completion route verifies the object with R2 HEAD before writing metadata.
- Private R2 media is persisted as canonical `r2://{bucket}/{objectKey}` references.
- Server load paths convert private R2 refs to short-lived signed GET URLs.
- Save paths normalize any private R2 signed GET URL back to `r2://...` before writing Supabase.
- Public published covers use stable `https://media-stage.kissago.cc/...` URLs.
- Staging app origin is `https://kissagostage.vercel.app` and is explicitly allowed in R2 CORS.

## Existing Supabase Fallback Behavior

- Supabase Storage remains supported.
- Existing Supabase URLs continue to sign and render.
- New uploads fall back to Supabase only after an R2 presign, PUT, or HEAD confirmation failure.
- Confirmed R2 successes are not duplicated to Supabase.

## Files Changed

- Storage/config/access: `lib/media/*`, `lib/supabase/storage.ts`
- Upload APIs: `app/api/media/r2/*`
- Media flows: `lib/store/story-store.ts`, `components/story/StoryScreen.tsx`, `app/actions/narration.ts`, `lib/story/share-cover.ts`
- URL signing: `lib/media/storage-url-signing.ts`, `app/actions/persistence.ts`, `app/actions/exploration.ts`
- Admin/settings: `app/actions/admin.ts`, `components/admin/GlobalSettings.tsx`
- Setup/docs: `cloudflare/r2/*`, `.env.example`
- Migration: `supabase/migrations/045_cloudflare_r2_media_assets.sql`

## Env Variables Added

See `cloudflare/r2/README.md` for the full Vercel staging env list.

## Cloudflare Setup Steps

```bash
npx wrangler login
npx wrangler r2 bucket create kissago-media-staging
npx wrangler r2 bucket create kissago-media-private-staging
npx wrangler r2 bucket cors set kissago-media-staging --file cloudflare/r2/cors-staging.json
npx wrangler r2 bucket cors set kissago-media-private-staging --file cloudflare/r2/cors-staging.json
npx wrangler r2 bucket list
```

On Windows PowerShell, run:

```powershell
powershell -ExecutionPolicy Bypass -File cloudflare/r2/setup-staging.ps1
```

## Manual Cloudflare Dashboard Steps

- Create the R2 API token `kissago-r2-staging-read-write`.
- Grant Object Read & Write for `kissago-media-staging` and `kissago-media-private-staging`.
- Save account ID, access key ID, and secret access key.
- Connect `media-stage.kissago.cc` only to `kissago-media-staging`.
- Keep `kissago-media-private-staging` without public/custom-domain delivery.

## Testing Checklist

- Bucket creation and CORS succeed.
- Env health shows ready in Global Settings on staging.
- Beat/storyboard image uploads use optimized payloads and persist private `r2://` refs.
- Character reference uploads persist private `r2://` refs.
- Reload/save after display signing does not persist short-lived R2 signed GET URLs.
- Narration WAV uploads to private R2 and plays through a signed GET URL.
- Social, YouTube, reel, and default covers upload to public R2.
- Published Open Graph image URLs are stable public R2 URLs.
- Old Supabase-hosted stories still load.
- R2 PUT/HEAD failure falls back to Supabase once.
- R2 secrets do not appear in the browser bundle.
- Public assets carry long cache-control metadata.
- Draft/private assets are not exposed through public R2 URLs.

## Known Limitations

- Old Supabase assets are not migrated automatically.
- Narration remains WAV; MP3 conversion is future work.
- Gallery storage keys may retain legacy Supabase-compatible shapes for fallback compatibility.
- R2 signed GET URLs use the S3 endpoint, not the public custom domain.

## Future Production Rollout Notes

- Create separate production R2 buckets and a production media domain.
- Set production env values separately; keep `R2_PRODUCTION_ENABLED=false` until validation is complete.
- Copy published Supabase assets to R2 in a controlled migration.
- Update metadata rows and verify rollback by keeping original Supabase URLs available until cutover is confirmed.
