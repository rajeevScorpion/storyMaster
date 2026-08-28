# Reference Upload and Preprocessing

## UX requirements

- Separate Character and World sections.
- Show current entitlement, for example `1 of 2 character references used`.
- Show accepted file types, size and minimum quality.
- Name/label is optional.
- Allow replace/remove before generation begins.
- Show private-use notice and ownership confirmation.
- Show processing state per item.
- Prevent story submission while a required adoption is unresolved, unless the product explicitly supports description-only fallback and the user is informed.

## Server validation

Never trust client validation alone.

Validate:

- Authenticated owner
- Feature enabled
- Tier entitlement
- Story ownership
- Count limit
- MIME and extension match
- File size
- Image decode
- Dimensions
- Corrupt payload
- Duplicate checksum
- Safe filename handling
- Moderation policy
- Reference type
- Story state permits adding a reference

## Character-specific checks

- One clear primary subject
- Not a collage
- Not a heavily obstructed face/body when the downstream model requires visibility
- Group images should produce a crop/reject flow, not silent arbitrary selection
- UI screenshots should be rejected or cleaned through explicit crop
- Do not infer the user's relationship to the subject

## World-specific checks

- Environment/location is reasonably visible
- Avoid accepting a portrait as a world without user correction
- Detect UI screenshots, text-heavy boards and collages
- Extract environment even when people are present, but do not accidentally create unnamed characters from bystanders

## Processing

- Generate normalized preview/thumbnail.
- Preserve original privately according to retention settings.
- Use the existing client/server image-processing mode, but server-side durable processing is preferred for this feature when available.
- If legacy client-side mode is active, do not pretend processing is durable. Use the existing safe fallback and document limitations.
- Do not expose permanent public URLs.
- Use signed URLs or internal provider fetch mechanisms.

## Idempotency

Use a stable idempotency key from:

- user
- story
- source checksum
- reference type
- style version
- adoption version

Duplicate submission must return the existing adoption/job rather than charge and process again.
