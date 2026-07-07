# 07 — Cloudflare R2 Storage and Media Variants

Cloudflare R2 is the object storage layer. Use private originals and derived display assets.

## Bucket strategy

Preferred simple approach:
- One R2 bucket with strict key prefixes and access controls.

Alternative:
- Separate private bucket for originals and public/CDN bucket for derived assets.

Choose based on existing code and deployment simplicity.

## Suggested key structure

```text
stories/{userId}/{storyId}/media/{mediaId}/original.{ext}
stories/{userId}/{storyId}/media/{mediaId}/display.webp
stories/{userId}/{storyId}/media/{mediaId}/thumbnail.webp
stories/{userId}/{storyId}/media/{mediaId}/share-low.webp
stories/{userId}/{storyId}/media/{mediaId}/share-high.webp
```

For public URLs, avoid exposing user email or personal data in object keys. Use internal IDs only.

## Variant definitions

### Original
- Full quality returned by image provider.
- Private.
- Tier-retained.
- Used for high-quality export/download while valid.

### Display
- Web-optimized image for normal story viewing.
- Recommended max width: 1440px or admin setting.
- Format: WebP/AVIF where supported by current stack, otherwise fallback.
- Long-lived.

### Thumbnail
- Used for dashboard/gallery/cards.
- Recommended max width: 512px.
- Long-lived.

### Share Low
- Used for standard quality publishing/sharing/export.
- Optimized for social sharing and fast loading.

### Share High
- Higher quality derived asset for Plus/Studio publish/share.
- Still a derived safe asset, not the private original.
- May be retained according to tier or recreated while original is available.

## Metadata to store

For each object where possible:
- content type
- byte size
- width/height
- checksum/hash
- variant name
- generated model/provider
- storyId/mediaId

## Access rules

- Originals: never public.
- Display/thumbnail for private stories: serve through authorized route or signed/controlled URL.
- Display/thumbnail for public stories: may be public/CDN-friendly.
- HQ download: short-lived signed URL generated only after entitlement check.

## Compression library

Use the best fit for the current runtime:
- Node server: Sharp is usually preferred.
- Serverless/edge-only runtime: verify compatibility; may require external worker service.
- Cloudflare Workers: native image processing may require different strategy; investigate current platform support before choosing.

Do not add a heavy image library to an incompatible runtime without testing deployment.
