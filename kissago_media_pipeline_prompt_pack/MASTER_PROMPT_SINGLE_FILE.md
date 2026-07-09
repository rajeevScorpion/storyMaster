# Master Prompt — Kissago Durable Cloudflare Media Pipeline

You are an AI coding agent working on Kissago. Build a durable, server-owned media pipeline for story image generation and publishing using Cloudflare R2.

## Non-negotiable behavior

Users must be able to fire-and-forget:
- They start image/story generation.
- They may close the browser immediately.
- Server continues work.
- Image gets generated, saved, compressed, and linked to story.
- On next load, UI fetches and displays the image normally.

## Storage behavior

Use Cloudflare R2:
- Original full-quality image is private.
- Compressed display image is used for normal UI viewing.
- Thumbnail is used for galleries/cards.
- Standard share/export uses optimized safe asset.
- High-quality share/export is available only for entitled tiers and valid retention window.

## Tier behavior

Free:
- compressed viewing only
- no HQ download/export
- original retained only briefly for internal processing if configured

Plus:
- compressed viewing
- HQ download/export for admin-configurable days, default 10
- low/high toggle before share/publish if enabled

Studio:
- compressed viewing
- HQ download/export for admin-configurable days, default 30
- low/high toggle before share/publish if enabled

## Publish/private behavior

Users can set stories:
- private
- unlisted
- public

Public/unlisted stories must use derived public-safe assets. Never expose private original as permanent public asset.

## Implementation rules

1. Investigate before coding.
2. Do not assume the stack.
3. Do not break existing working features.
4. Use feature flags.
5. Work in phases and commit after each phase.
6. Use DB as source of truth for job state, media state, retention, and visibility.
7. Queue/worker must be retry-safe and idempotent.
8. Generate signed URLs only at click time after entitlement checks.
9. Do not store long-lived signed URLs.
10. Add admin controls for retention, compression, publishing, and cleanup.
11. Add tests for fire-and-forget, browser close, private/public/unlisted, entitlement, retention, and cleanup.

## First task

Inspect the repository and create `INVESTIGATION_REPORT.md` before implementation. Include current stack, current media flow, current generation flow, current storage, risks, relevant files, and proposed phased implementation.

Then implement in phases:
- Phase 0: feature flags and investigation
- Phase 1: durable job/media schema
- Phase 2: queue/worker
- Phase 3: R2 original save
- Phase 4: compression variants
- Phase 5: tier retention and HQ download
- Phase 6: private/public/unlisted stories
- Phase 7: low/high quality share/publish toggle
- Phase 8: admin controls and observability
- Phase 9: tests, migration, and cleanup


## Addendum: admin processing mode toggle

Do not hard-replace the existing client-side image download/compression/re-upload cloud-save flow. Add an admin-selectable media processing mode: `client_legacy`, `server_pipeline`, and optionally `hybrid_canary`. Default to the current working flow until admin changes it. Store the effective processing mode on every job/media record. The admin toggle affects new jobs only. Existing stories must continue to render. Switching back from server mode to legacy mode must not require redeploy and must not delete or rewrite media. Test both paths before handoff.
