# ADR: Kissago Client-Side Story Persistence

## Status

Accepted

## Date

2026-06-15

## Context

Kissago currently reloads story manifests from Supabase and regenerates signed media URLs whenever a reader is reopened. Active story state is held in memory, while IndexedDB is used only for pending beat-image upload retries. The new layer must improve repeat playback without replacing server authority or blocking a future Capacitor application.

## Decision

- Metadata and progress: a dedicated, schema-versioned IndexedDB database partitioned by user ID.
- Web media: Cache Storage responses indexed by stable synthetic asset IDs, exposed to players through revocable blob URLs.
- Native media: a future Capacitor Filesystem adapter implementing the same interface.
- Invalidation: media sync timestamp first, story `updated_at` fallback, never signed URL alone.
- Loading: local-first rendering followed by background server revalidation.
- Prefetch: current beat plus two reachable beats.
- Cleanup: 10 recent stories per user, 30-day maximum age, and quota-pressure eviction.
- Security: cached private data is available only to the matching local Supabase user and removed on sign-out/account change.

## Why This Fits The Repository

The application already uses browser IndexedDB directly and has no storage wrapper dependency. A small internal wrapper avoids adding a large dependency and keeps behavior explicit. Cache Storage naturally holds binary responses and avoids base64 expansion. Stable cache keys solve the repository's one-hour signed URL rotation, while sync timestamps handle overwritten beat paths.

The story UI already centralizes audio in `useAudioPlayer` and uses a small number of story reader components, allowing persistence to stay behind hooks and adapters rather than leaking browser APIs throughout the UI.

## Alternatives Considered

- `localStorage`: rejected because it is synchronous, size-limited, and unsuitable for media.
- IndexedDB blobs for all media: rejected because Cache Storage is a better web response cache and native media will ultimately use Filesystem.
- Service worker/Workbox: deferred because cold offline shell support is outside this release and no PWA setup exists.
- SQLite and Capacitor Filesystem now: deferred because the current Next.js app is not yet bundle-ready for Capacitor.

## Consequences

Repeat opens can render cached text immediately and reuse previously downloaded images/audio. Cache invalidation and cleanup become explicit responsibilities. Offline web playback works after the application shell has loaded, but cold offline startup is not guaranteed without a service worker. Private cache is not encrypted at rest.

## Native Adapter Contract

A future native adapter will store manifest/progress metadata through an IndexedDB or SQLite implementation, write media under an app-owned `stories/{storyId}/{assetId}` directory using Capacitor Filesystem, and return WebView-safe URLs through `Capacitor.convertFileSrc`. No reader component should import Capacitor APIs.
