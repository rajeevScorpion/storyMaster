# 10 — Admin Panel Controls

Add or extend admin settings. Use existing admin architecture if present.

## Media pipeline settings

```text
Media processing mode: client_legacy | server_pipeline | hybrid_canary
Server-side media pipeline enabled: true/false
Client-side legacy processing enabled: true/false
Client-side compression fallback enabled: true/false
Default mode for new generation jobs: client_legacy | server_pipeline
Hybrid canary percentage: 0-100
Hybrid canary allowed tiers: Free | Plus | Studio
Free original retention hours: number
Plus original retention days: number
Studio original retention days: number
Display max width: number
Thumbnail max width: number
Display WebP quality: number
Thumbnail WebP quality: number
Share low max width: number
Share high max width: number
Share high quality: number
Cleanup job enabled: true/false
Cleanup batch size: number
```

## Publishing settings

```text
Public publishing enabled: true/false
Unlisted sharing enabled: true/false
Require moderation before public listing: true/false
Allow Free users to publish: true/false
Allow Plus high-quality publish/share: true/false
Allow Studio high-quality publish/share: true/false
Default publish quality by tier
```

## Operational settings

```text
Generation worker concurrency
Compression worker concurrency
Max retry attempts
Dead-letter queue enabled
Presigned URL expiry seconds
```

## Admin dashboard metrics

Show:
- jobs queued
- jobs processing
- jobs failed
- compression failures
- R2 upload failures
- cleanup deletions
- originals expiring today
- storage by variant if available

## Admin actions

- Requeue failed generation job
- Requeue failed compression job
- Mark story hidden/unpublished
- Revoke unlisted share token
- Force cleanup expired originals
- Temporarily disable public publishing

## Safety

Changing retention settings should affect future assets by default.

If admin wants to retroactively apply shorter retention, require explicit confirmation because users may lose expected HQ access.


## Processing mode safety rules

- The admin processing mode must affect new generation jobs only.
- Existing jobs/media must render according to the assets already saved for them.
- Each job/media record must store `processing_mode`.
- Switching from server mode back to legacy mode must not require redeploy.
- Switching modes must not delete objects, invalidate existing story media, or rewrite old records automatically.
- If `server_pipeline` is disabled while jobs are already processing, allow those jobs to finish or mark them safely retryable based on existing queue architecture. Do not abandon records in an invisible state.
- Add an admin warning before enabling `server_pipeline` globally.
- Add a visible status showing the currently active media processing mode.
