# 02 — Target Architecture

Implement a server-owned durable media pipeline.

## Target flow

```text
User clicks Generate
  ↓
API creates durable generation job in DB
  ↓
API returns job/story status immediately
  ↓
Background worker processes job
  ↓
Worker calls image generation provider
  ↓
Worker downloads/fetches generated full-quality image server-side
  ↓
Worker uploads original to Cloudflare R2 private path
  ↓
Worker creates compressed variants server-side
  ↓
Worker uploads display/thumbnail/share variants to R2
  ↓
DB records media keys, status, dimensions, sizes, retention expiry
  ↓
UI polls/refetches status and renders available display image
```

## Principles

- The browser is not the source of truth.
- The user should not need to keep the tab open.
- No generated image should be lost because of browser close, refresh, or poor network after the job is accepted.
- The app should render compressed display images by default.
- Originals remain private.
- High-resolution downloads/exports require entitlement checks and retention checks.
- Public stories must not expose private original files.
- All heavy operations must be retryable and idempotent.

## Suggested components

### API layer
- `POST /api/stories/:storyId/generation-jobs`
- `GET /api/stories/:storyId/status`
- `GET /api/stories/:storyId/media`
- `POST /api/stories/:storyId/publish`
- `POST /api/stories/:storyId/private`
- `POST /api/stories/:storyId/share-settings`
- `POST /api/media/:mediaId/download-url`

### Worker layer
- generation worker
- compression worker
- cleanup worker
- retry/dead-letter handling

### Storage layer
- Cloudflare R2 private original objects
- Cloudflare R2 derived display objects
- signed URL generation for private downloads
- lifecycle rules as safety net

### Database layer
- story status
- media records
- generation job records
- plan entitlements
- admin media settings

## Avoid

- Returning large base64 image data to the browser.
- Client-side compression as primary pipeline.
- Long-lived public original URLs.
- Compression in the same HTTP request that starts generation.
- Permanent high-quality storage for all users.
