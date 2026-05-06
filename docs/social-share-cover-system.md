# Social Share Cover System

## Purpose

This document explains how Kissago handles:

- Social share covers
- YouTube thumbnails
- Reel thumbnails
- Existing storyline repair
- Publish-time creator flows
- Admin diagnostics and backfills

It is the source of truth for how cover assets should behave for WhatsApp, Facebook, X, LinkedIn, Discord, and similar crawlers.

## Root Cause

Published storyline metadata was recently changed to point social crawlers at `/storyline/{id}/cover-image`. That route resolved whatever cover-like image was available at request time: gallery cover, beat image, proxied storage image, or external URL.

That broke sharing for both major flows:

- With-image stories no longer had a guaranteed stable `1200x630` public image.
- Without-image stories and external uploads still had no dedicated crawler-safe asset.

The previous gallery cover logic is still useful inside Kissago, but it is not safe enough for Open Graph metadata.

## Core Rule

Social sharing must not depend directly on beat images.

Every published storyline needs a dedicated, stable, public, crawler-safe asset for metadata. Beat images may still exist for in-app viewing, gallery display, and story playback, but social crawlers should receive a processed publishing asset.

## Asset Types

Kissago now treats these as separate image roles:

### 1. Gallery image

Used inside Kissago gallery and listing UI.

- Existing gallery logic stays unchanged.
- This is not the source of truth for social metadata.

### 2. Social share cover

Used for:

- `og:image`
- `og:image:secure_url`
- `twitter:image`
- WhatsApp and similar social previews

Requirements:

- Dedicated processed image
- Stable public URL
- Absolute HTTPS URL
- No signed token
- No auth required
- Server-rendered in metadata
- Target size: `1200x630`

### 3. YouTube thumbnail

Used as a creator-facing asset for YouTube.

- Stored separately as its own managed asset
- Input validation requires `16:9`
- Minimum resolution `1280x720`
- Max upload size `3 MB`

Important behavior:

- If a YouTube thumbnail is provided, Kissago also derives a social share cover from it.
- Social metadata still uses the derived `1200x630` cover, not the raw `1280x720` file directly.

### 4. Reel thumbnail

Used for vertical story publishing workflows.

- Target size: `1080x1920`
- Input validation requires `9:16`
- Separate from the social share cover

Important behavior:

- Reel thumbnails are not the default `og:image`.
- Social sharing still prefers a landscape `1200x630` cover.

## Data Model

Primary storyline fields:

- `share_cover_url`
- `share_cover_source`
- `share_cover_status`
- `share_cover_width`
- `share_cover_height`
- `share_cover_mime_type`
- `share_cover_updated_at`
- `share_cover_version`

Related creator asset fields:

- `youtube_thumbnail_url`
- `youtube_thumbnail_source`
- `youtube_thumbnail_status`
- `youtube_thumbnail_width`
- `youtube_thumbnail_height`
- `youtube_thumbnail_mime_type`
- `youtube_thumbnail_updated_at`
- `youtube_thumbnail_version`
- `reel_thumbnail_url`
- `reel_thumbnail_source`
- `reel_thumbnail_status`
- `reel_thumbnail_width`
- `reel_thumbnail_height`
- `reel_thumbnail_mime_type`
- `reel_thumbnail_updated_at`
- `reel_thumbnail_version`

Prompt fields:

- `social_cover_prompt`
- `youtube_thumbnail_prompt`
- `reel_thumbnail_prompt`
- `audio_cover_prompt`

Story mode fields:

- `story_format`: `visual_story` or `audio_story`
- `story_visual_mode`: `with_images` or `without_images`
- `orientation`: `landscape` or `portrait`

Allowed source values:

- `custom_generated`
- `uploaded`
- `fallback_beat`
- `branded_default`
- `migrated_existing`

Allowed status values:

- `missing`
- `generating`
- `ready`
- `failed`

## Storage

Processed assets are stored in `public-storylines` under versioned public paths:

- `/{userId}/{storylineId}/share-covers/{version}.webp`
- `/{userId}/{storylineId}/youtube-thumbnails/{version}.webp`
- `/{userId}/{storylineId}/reel-thumbnails/{version}.webp`

The migration reasserts that `public-storylines` exists, is public, and has a public read policy. Runtime diagnostics still verify the deployed state because Supabase storage configuration can drift.

Images are uploaded with long public cache headers. Replacements create a new filename/version so social platforms can re-fetch changed covers.

## Processing Rules

Server-side processing uses `sharp`.

Processed outputs:

- Social share cover: `1200x630` WebP
- YouTube thumbnail: `1280x720` WebP
- Reel thumbnail: `1080x1920` WebP

Upload validation:

- Accepted source types: JPG, PNG, WebP
- Social cover upload max: `5 MB`
- YouTube thumbnail upload max: `3 MB`
- Reel thumbnail upload max: `3 MB`
- YouTube thumbnail must be `16:9` and at least `1280x720`
- Reel thumbnail must be `9:16` and at least `1080x1920`
- Social cover should be at least `600x315`, with `1200x630` recommended

Raw uploads and raw beat images are never used directly as `og:image`.

## Resolver

`resolveStorylineShareCover(storyline)` never returns `null`.

Metadata resolution priority:

1. Ready `share_cover_url` if it is a usable public URL
2. Story-specific branded default route
3. Global branded default route as a final emergency fallback

Publishing and repair attempt to create a ready `share_cover_url` from:

1. YouTube thumbnail-derived share cover
2. Uploaded or generated social cover
3. Processed fallback beat image
4. Branded default cover

The resolver intentionally does not point metadata at:

- Raw beat images
- Signed URLs
- Relative URLs
- Client-only images
- The old proxy route

## Metadata

`app/storyline/[id]/page.tsx` renders metadata server-side with `generateMetadata`.

Required tags are emitted through Next metadata:

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

The old `/storyline/{id}/cover-image` route remains only as a compatibility or debug route and is not used by metadata.

## Publish UI

The cover and thumbnail options appear in the publish modal at the ending beat.

Entry point:

1. User reaches an ending beat in `StoryScreen`.
2. User clicks `Publish Storyline` or `Publish as Audio Story`.
3. `PublishDialog` opens.
4. The cover controls appear in the publish dialog.

Main section titles:

- Visual stories: `Share Cover / Thumbnail`
- Audio stories: `Cover Image for Sharing`

### Standard publish modal options

For standard visual publishing, the dialog includes:

- `Copy Social Cover Prompt`
- `Upload Share Cover`
- `Generate Cover`
- `Copy YouTube Prompt`
- `Upload YouTube Thumbnail`
- `Generate YouTube Thumbnail`

For vertical stories, the dialog also includes a separate `Reel Thumbnail` block:

- `Copy Reel Prompt`
- `Upload Reel Thumbnail`
- `Generate Reel Thumbnail`

### Audio publish modal options

For audio publishing, the dialog includes:

- `Copy Audio Cover Prompt`
- `Upload Share Cover`
- `Generate Cover`

Audio publishing stays disabled until a sharing cover exists.

## Story Type Flows

### With-image visual stories

Publishing flow:

1. Creator reaches the ending beat.
2. Creator opens `Publish Storyline`.
3. Creator may upload or generate a social share cover.
4. Creator may upload or generate a YouTube thumbnail.
5. If no share cover is chosen, Kissago processes a fallback beat image into a dedicated social cover.
6. Metadata uses the processed `share_cover_url`.

Notes:

- Beat images still render in the player as before.
- Gallery logic stays unchanged.

### Without-image visual stories

Intended flow:

1. Creator reaches the ending beat.
2. Creator opens `Publish Storyline`.
3. Creator may copy the social cover prompt and generate externally.
4. Creator may upload a dedicated share cover.
5. Creator may upload a YouTube thumbnail.
6. Creator may generate these assets in-app when enabled.
7. If nothing is provided, branded default fallback is used.

Current product nuance:

- The cover controls live in the same publish dialog as standard visual publishing.
- A prompt-only story with no publishable beat images may be routed into `Publish as Audio Story` instead of standard visual publishing.
- In that case the creator still gets cover controls, but under the audio publish path.

### Vertical stories

Publishing flow:

1. Creator opens the publish dialog.
2. Creator can manage the social share cover.
3. Creator can manage the YouTube thumbnail.
4. Creator can manage the reel thumbnail separately.
5. Social metadata still uses a landscape `1200x630` share cover.

### Audio stories

Publishing flow:

1. Creator reaches the ending beat.
2. Creator chooses `Publish as Audio Story`.
3. The publish dialog shows `Cover Image for Sharing`.
4. Creator uploads a cover for free or generates one for coins.
5. Publish remains disabled until a cover exists.
6. Backend still has branded default fallback as an emergency safety net.

## YouTube Thumbnail Behavior

YouTube thumbnails are separate managed assets, not just prompts.

When a YouTube thumbnail is uploaded or generated:

1. Kissago validates the file as a YouTube thumbnail candidate.
2. Kissago stores the processed YouTube thumbnail in `youtube_thumbnail_url`.
3. Kissago derives a `1200x630` social share cover from the same source image.
4. The derived cover is stored in `share_cover_url`.
5. Social crawlers use the derived share cover, not the raw YouTube thumbnail.

This gives creators one visual concept for YouTube and social sharing while still keeping social previews platform-safe.

## Existing Storylines

### Existing with-image storylines

Recommended repair flow:

1. Run `Repair Missing Beat Image URLs` if historical beat URLs may be incomplete.
2. Run `Repair Social Share Covers`.
3. If a usable beat image exists, Kissago processes it into a dedicated `1200x630` public share cover.
4. Metadata uses that processed cover.

### Existing without-image storylines

If no usable beat image exists:

- Repair creates a branded default cover.
- The storyline remains crawler-safe.
- A better custom cover can still be uploaded or generated later.

### Existing vertical storylines

- Repair still creates or validates a landscape social share cover.
- Reel thumbnails remain separate and optional.

### Existing audio storylines

- Repair does not use paid AI generation.
- If no creator cover exists, repair falls back to a branded default cover.

## New Storylines

### New standard visual storylines

At publish time:

- Creator can upload or generate a social cover
- Creator can upload or generate a YouTube thumbnail
- Creator can copy prompts for external generation
- If nothing is selected, Kissago falls back to a processed beat cover or branded default

### New prompt-only stories

At publish time:

- If the story is publishable as a standard visual storyline, creator gets the standard `Share Cover / Thumbnail` section.
- If the story is routed through audio publishing, creator gets the audio sharing cover flow.

### New vertical storylines

At publish time:

- Creator gets social share cover controls
- Creator gets YouTube thumbnail controls
- Creator gets reel thumbnail controls

### New audio storylines

At publish time:

- Upload cover is free
- Generate cover uses configured pricing
- Publish stays disabled until a cover exists

## Why Generic Green Covers Appear

If shared story previews all look like the same green abstract image, that usually means the storyline is using the branded default cover.

The key diagnostic signal is:

- `Source: branded_default`

That means:

- The crawler image is not missing
- The system successfully provided a fallback cover
- A story-specific uploaded, generated, or beat-derived share cover was not available for that storyline

This is a safety success, not a crawler failure. The preview exists, but it is generic.

## Admin Backfills

Admin backfill page: `/admin/backfill`

There are two separate repair tools.

### Repair Missing Beat Image URLs

Purpose:

- Repairs beat rows where the storage object exists but the durable `image_url` was not written correctly.

Use this when:

- Historical beat images exist in storage
- Story playback or fallback logic cannot find them reliably

This repair does not primarily create social metadata covers. It repairs the underlying beat image references.

### Repair Social Share Covers

Purpose:

- Processes existing published storylines into dedicated `1200x630` public share covers.

For each published storyline:

1. If a ready cover already exists, leave it as ready.
2. If a usable beat image exists, process it into a dedicated social share cover.
3. If no usable beat image exists, create a branded default cover.
4. Save URL, source, status, dimensions, MIME type, and version.

Typical result fields:

- `processedFromBeat`: number of storylines repaired from beat images
- `defaulted`: number of storylines that received branded default covers
- `failed`: number of repair failures

Example meaning:

- `processedFromBeat: 7` means seven storylines received story-specific processed covers from beat images.
- `defaulted: 5` means five storylines had no usable beat image and were given branded defaults.

## Diagnostics

Admin diagnostics page: `/admin/share-covers`

It shows:

- Current storyline cover fields
- YouTube and reel thumbnail fields
- Resolver output
- Absolute URL, crawler-safety, and signed-token checks
- Public bucket verification attempt
- Image HTTP status, content type, and content length
- Raw HTML `og:image`
- Raw HTML `twitter:image`
- Share page URL
- Debug links for Facebook, X, and LinkedIn

### How to read diagnostics

Most important fields:

- `Raw HTML og:image`
- `Raw HTML twitter:image`

Those are the URLs that social crawlers actually see in server-rendered HTML.

Important nuance:

- `Resolved image URL` is diagnostic helper output.
- `Raw HTML og:image` is the crawler truth.

If those differ, the metadata value in raw HTML is the thing to trust first.

### Bucket verification caveat

If diagnostics shows a bucket lookup error such as schema access failure, that does not automatically mean the image is private.

Stronger real-world signals are:

- image URL returns HTTP `200`
- content type is an image MIME type
- URL is public and unsigned
- raw HTML metadata includes the image URL

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

Manual verification:

- With-image landscape storyline: social image exists, gallery unchanged, beat rendering unchanged
- Without-image landscape storyline: prompt copy works, upload works, default fallback exists
- With-image vertical storyline: `og:image` is `1200x630`; reel thumbnail stays separate
- Without-image vertical storyline: social and reel prompts or uploads work separately
- Audio story: publish is disabled until a cover exists; generated cover uses configured coin action
- Cover replacement: URL or version changes
- Crawler access: public image returns HTTP `200` without cookies, auth, headers, or signed token
