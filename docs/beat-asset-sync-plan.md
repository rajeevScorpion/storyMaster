# Incremental Beat Asset Sync Plan

## Summary

- Replace story-wide asset uploads during cloud save with beat-level image/audio sync.
- Keep image durability on the same device by caching only pending beat images in IndexedDB until upload plus DB patch succeeds.
- Persist beat media status in Supabase so refreshes and other devices can distinguish pending, ready, failed, and not-requested beats.
- Roll out behind admin flags so the current behavior remains instantly reversible.

## Key Decisions

- IndexedDB is image-only and staging-only. It is not a second app database.
- The primary DB truth for media remains canonical storage URLs plus explicit media status fields on `beats` and `story_map`.
- The active browser keeps rendering the local generated image after upload succeeds; refresh naturally reloads from signed storage URLs.
- Audio gets durable status tracking in v1, but no local offline audio cache.

## Implementation Outline

1. Add beat media status columns and feature flags via migration `033_incremental_beat_asset_sync.sql`.
2. Extend beat/story types and persistence actions to read, write, and normalize media status fields.
3. Add a client-only IndexedDB helper for pending beat images and a serialized upload queue in the story store.
4. Change story checkpoint saves to persist text/tree state without story-wide image uploads when incremental sync is enabled.
5. Update story loading to overlay same-device pending images and retry sync on load, focus, online, and manual save tap.
6. Update admin controls and story save indicator semantics for pending versus failed beat media.

## Acceptance Criteria

- Beat 2 upload never re-uploads beat 1 image when incremental sync is enabled.
- Refresh during a pending beat upload on the same device never loses the generated image.
- Other devices can load the beat immediately and see a pending media state when the image is not ready yet.
- DB rows never store base64 or signed storage URLs.
