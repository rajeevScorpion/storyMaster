# 09 — Publish, Private, Unlisted, and Quality Toggle

Users need control over story visibility and share/publish quality.

## Story visibility modes

### Private
- Only creator can view.
- Story should not appear in public gallery.
- Media access must require authorization.

### Unlisted
- Shareable by tokenized link.
- Not listed in gallery/discovery.
- Anyone with valid link can view public-safe derived assets.
- Owner can revoke/regenerate share token.

### Public
- Can appear in gallery/discovery if platform supports it.
- Should use public-safe derived images.
- May require moderation before listing.

## Schema fields

```ts
visibility: 'private' | 'public' | 'unlisted'
publishedAt?: Date
unpublishedAt?: Date
publicShareToken?: string
allowPublicIndexing: boolean
moderationStatus?: 'none' | 'pending' | 'approved' | 'rejected'
preferredShareQuality?: 'standard' | 'high'
preferredPublishQuality?: 'standard' | 'high'
```

## User controls

In story settings:
- Private
- Unlisted share link
- Public publish

Before publishing/sharing for eligible tiers:

```text
Quality
(•) Standard quality — faster loading, recommended
( ) High quality — better visual quality, available for your plan
```

## Tier behavior

Free:
- Standard quality only
- No HQ download/export
- Publish permission configurable by admin

Plus:
- Standard + high quality toggle while HQ asset/original is available
- 10-day default HQ retention

Studio:
- Standard + high quality toggle
- 30-day default HQ retention
- Consider future batch export or premium publish quality defaults

## Server rules

Never trust client quality selection. Server must validate:
- tier entitlement
- story ownership
- media readiness
- original/derived HQ availability
- moderation/publishing setting

## Public asset rule

Even if high quality is selected for public publish:
- do not expose private original directly
- use a high-quality derived public asset or controlled delivery route

## UI states

Show clear states:
- “Processing images...”
- “Ready”
- “High quality available until 13 July 2026”
- “High quality expired; standard quality still available”
- “Public publishing is disabled by admin”
- “This story is pending review”
