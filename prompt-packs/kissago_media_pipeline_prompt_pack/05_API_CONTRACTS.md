# 05 — API Contracts

Adapt endpoints to existing routing style.

## Start generation

`POST /api/stories/:storyId/generation-jobs`

Request:
```json
{
  "type": "story_image",
  "prompt": "...",
  "model": "...",
  "sceneId": "optional",
  "sequenceNo": 1
}
```

Response:
```json
{
  "jobId": "job_123",
  "storyId": "story_123",
  "mediaId": "media_123",
  "status": "queued",
  "message": "Your image generation has started. You can safely leave this page."
}
```

Rules:
- Must authenticate user.
- Must check user owns story.
- Must create durable DB records before enqueueing.
- Must not wait for image generation to finish.
- Must return quickly.

## Story status

`GET /api/stories/:storyId/status`

Response:
```json
{
  "storyId": "story_123",
  "status": "processing",
  "visibility": "private",
  "media": [
    {
      "mediaId": "media_123",
      "sequenceNo": 1,
      "status": "compressing",
      "displayUrl": null,
      "thumbnailUrl": null,
      "hqAvailable": true,
      "hqExpiresAt": "2026-07-13T00:00:00.000Z"
    }
  ]
}
```

## Media listing

`GET /api/stories/:storyId/media`

Rules:
- Private stories require owner access.
- Public stories can return public-safe derived media.
- Unlisted stories require valid share token unless owner.
- Never return raw private original keys to client.

## HQ download URL

`POST /api/media/:mediaId/download-url`

Request:
```json
{
  "quality": "high"
}
```

Response:
```json
{
  "url": "short-lived-signed-url",
  "expiresInSeconds": 300
}
```

Rules:
- Authenticate user.
- Check ownership or valid permission.
- Check plan/tier entitlement.
- Check original has not expired.
- Generate short-lived signed URL only at click time.
- Never store long-lived signed URLs in DB.

## Publish story

`POST /api/stories/:storyId/publish`

Request:
```json
{
  "visibility": "public",
  "quality": "standard"
}
```

Rules:
- `visibility` may be `public`, `private`, or `unlisted`.
- `quality=high` requires higher-tier entitlement and available high-quality derived asset/original.
- If public moderation is enabled, mark story as pending review instead of visible.

## Update quality setting

`POST /api/stories/:storyId/share-settings`

Request:
```json
{
  "preferredShareQuality": "standard",
  "preferredPublishQuality": "high"
}
```

Rules:
- Validate server-side.
- If not eligible for high quality, return a structured error with upgrade hint.


## Processing mode routing API/admin contracts

Add or adapt endpoints according to the existing admin/settings pattern. Names are illustrative.

```http
GET /api/admin/media-settings
```
Returns current media processing mode and related rollout settings.

```json
{
  "media_processing_mode": "client_legacy",
  "server_pipeline_enabled": false,
  "client_legacy_enabled": true,
  "hybrid_canary_percentage": 0
}
```

```http
PATCH /api/admin/media-settings
```
Updates the mode. Validate allowed values and permissions.

```json
{
  "media_processing_mode": "server_pipeline"
}
```

Generation creation should return the effective processing mode:

```json
{
  "job_id": "...",
  "story_id": "...",
  "status": "queued",
  "effective_processing_mode": "server_pipeline"
}
```

If mode is `client_legacy`, preserve the current API/browser flow as much as possible and only add the minimum metadata needed to track the mode.
