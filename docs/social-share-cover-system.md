# Social Share Cover System

## Root Cause

Published storyline metadata was recently changed to point social crawlers at `/storyline/{id}/cover-image`. That route resolved whatever cover-like image was available at request time: gallery cover, a beat image, a private storage object proxied by the app, or an external URL. It could return missing images, raw/private images, vertical images, or redirects that social crawlers handle inconsistently.

That broke both older flows:

- With-image stories no longer had a guaranteed stable 1200x630 public image.
- Without-image stories and external uploads still had no dedicated crawler-safe asset.

The previous gallery cover logic is still useful inside Kissago, but it is not safe enough for Open Graph metadata.

## Architecture

Social sharing now uses a dedicated published asset on `storylines`, separate from gallery covers, beat images, character sheets, and player visuals.

Primary fields:

- `share_cover_url`
- `share_cover_source`
- `share_cover_status`
- `share_cover_width`
- `share_cover_height`
- `share_cover_mime_type`
- `share_cover_updated_at`
- `share_cover_version`

Related creator assets:

- `youtube_thumbnail_url`
- `youtube_thumbnail_*`
- `reel_thumbnail_url`
- `reel_thumbnail_*`
- `social_cover_prompt`
- `youtube_thumbnail_prompt`
- `reel_thumbnail_prompt`
- `audio_cover_prompt`

Story mode fields:

- `story_format`: `visual_story` or `audio_story`
- `story_visual_mode`: `with_images` or `without_images`
- `orientation`: `landscape` or `portrait`

The migration also reasserts that `public-storylines` exists, is public, and has a public read policy. Runtime diagnostics still verify the actual deployed state because storage configuration can drift.

## Storage

Processed cover assets are stored in `public-storylines` under versioned paths:

- `/{userId}/{storylineId}/share-covers/{version}.webp`
- `/{userId}/{storylineId}/youtube-thumbnails/{version}.webp`
- `/{userId}/{storylineId}/reel-thumbnails/{version}.webp`

Images are uploaded with long public cache headers. Replacements use a new filename/version, so social platforms can refetch changed covers.

## Processing

Server-side processing uses `sharp`.

- Social share cover: 1200x630 WebP
- YouTube thumbnail: 1280x720 WebP, upload UI validates 16:9, minimum 1280x720, max 3 MB
- Reel thumbnail: 1080x1920 WebP, upload UI validates 9:16, minimum 1080x1920, max 3 MB

Raw uploads and raw beat images are never used directly as `og:image`. YouTube thumbnails can be uploaded/generated, and publishing derives the 1200x630 social cover from that thumbnail for platform-safe metadata.

## Resolver

`resolveStorylineShareCover(storyline)` never returns null.

Priority:

1. Ready `share_cover_url` if it is an absolute HTTPS non-signed URL
2. Story-specific branded default cover route
3. Global branded default cover route as an emergency fallback

During publishing and repair, the system attempts to create the ready `share_cover_url` from:

1. YouTube thumbnail-derived cover
2. Uploaded/generated social cover
3. Processed fallback beat image
4. Branded default cover

The resolver intentionally does not point metadata at raw beat images, signed URLs, relative URLs, or the old proxy route.

## Metadata

`app/storyline/[id]/page.tsx` renders metadata server-side with `generateMetadata`.

Required server-rendered tags are emitted through Next metadata:

- canonical URL
- `og:url`
- `og:type`
- `og:title`
- `og:description`
- `og:image`
- `og:image:secure_url`
- `og:image:width = 1200`
- `og:image:height = 630`
- `og:image:type`
- `twitter:card = summary_large_image`
- `twitter:title`
- `twitter:description`
- `twitter:image`

The old `/storyline/{id}/cover-image` route remains only as a compatibility/debug redirect and is not used by metadata.

## Story Type Handling

With-image visual stories:

- Creator can generate/upload a custom cover or skip.
- If skipped, the best beat image is processed into a stable 1200x630 share cover.

Without-image visual stories:

- Creator can copy prompts, upload a share cover, generate a cover, or rely on branded default fallback.
- Uploads are distinct from beat, gallery, and character reference uploads.

Vertical stories:

- Social previews still use a landscape 1200x630 share cover.
- Reel thumbnails are separate 1080x1920 assets.
- The player and vertical playback UI are unchanged.

Audio stories:

- Publish requires a cover upload or generated cover.
- Upload is free.
- Generation uses the configured pricing action.
- Backend still creates a branded default fallback if asset processing fails.

## Admin Settings

Migration `043_robust_storyline_social_covers.sql` seeds:

- `social_share_cover_system_enabled`
- `visual_story_cover_generation_enabled`
- `visual_story_cover_generation_coin_cost`
- `audio_story_cover_generation_enabled`
- `audio_story_cover_generation_coin_cost`
- `vertical_reel_thumbnail_generation_enabled`
- `vertical_reel_thumbnail_generation_coin_cost`
- `allow_free_cover_upload`
- `allow_audio_story_cover_upload`
- `allow_youtube_thumbnail_upload`
- `default_story_cover_template_enabled`
- `default_audio_story_cover_template_enabled`
- `cover_generation_model`
- `cover_generation_storage_bucket`
- `max_cover_generation_retries`

Pricing actions:

- `generate_social_share_cover`
- `generate_audio_story_cover`
- `generate_reel_thumbnail`

## Repair

The admin repair endpoint processes existing published storylines without paid AI generation.

For each published storyline missing a ready share cover:

1. Check whether an existing ready URL is valid.
2. Process the best beat/gallery cover image into a 1200x630 share cover when possible.
3. Create a branded default share cover if no usable image exists.
4. Save URL, source, status, dimensions, MIME type, and version.
5. Log failures and mark failed rows clearly.

## Diagnostics

Admin page: `/admin/share-covers`

It shows:

- Current share cover fields
- YouTube and reel thumbnail fields
- Resolver output
- Absolute/crawler-safe/signed-token checks
- Public bucket verification
- Image HTTP status/content type/content length
- Raw HTML `og:image` and `twitter:image`
- Share page and image URLs
- Facebook, X, and LinkedIn debug links

## Testing Checklist

Build:

```bash
npm run build
```

Crawler checks:

```bash
curl -A "facebookexternalhit/1.1" https://your-domain/storyline/{id}
curl -I https://your-public-cover-url
```

Manual cases:

- With-image landscape storyline: social image exists, gallery unchanged, beat rendering unchanged.
- Without-image landscape storyline: prompt copy works, upload works, default fallback exists.
- With-image vertical storyline: `og:image` is 1200x630; reel thumbnail stays separate.
- Without-image vertical storyline: social and reel prompts/uploads work separately.
- Audio story: publish is disabled until a cover exists; generated cover uses configured coin action.
- Cover replacement: URL/version changes.
- Crawler access: public image returns HTTP 200 without cookies, auth, headers, or signed token.
