# Investigation Report

## Summary

Kissago is a TypeScript Next.js 15 App Router application using React 19, Zustand, Supabase, Vercel, and optional Cloudflare R2 media storage. The server remains the authoritative source for stories. The current client keeps the active story only in memory; IndexedDB is used solely as a retry queue for pending beat images.

The persistence implementation should therefore add a separate, user-partitioned IndexedDB database for playable story manifests and progress, plus Cache Storage for media. Signed URLs must not be treated as asset identity.

## Current Architecture

- Framework: Next.js App Router with React 19 and TypeScript.
- Build/deployment: `next build`, standalone Next.js output, deployed through Vercel. R2 public delivery uses `media-stage.kissago.cc` and `media.kissago.cc`.
- State: Zustand stores in `lib/store`; no Zustand persistence middleware.
- Readers: client story tree readers at `/story/[id]` and `/explore/[id]`; server-loaded published reader at `/storyline/[id]` with a client player.
- API model: Server Actions for story loading/mutation and Next.js route handlers for R2 media operations.

## Story Data Flow

- `/story/[id]` calls `useStoryStore.loadStoryFromCloud`, which invokes `loadStory` in `app/actions/persistence.ts`.
- `/explore/[id]` calls `useStoryStore.exploreStoryTree`, which invokes `loadStoryTree` in `app/actions/exploration.ts`.
- `/storyline/[id]` loads metadata and beats server-side through `loadStorylineWithBeats`, then passes the result to `StorylinePlayer`.
- `StorySession` contains the complete branching `StoryMap`; published storylines contain an ordered `StoryBeat[]` path.
- Stories dual-write the complete JSONB map and normalized `beats` rows.

## Media Storage And URL Behavior

- Private generated images and narration live in Supabase Storage or private R2, depending on feature flags and environment.
- Public covers and published assets may use public Supabase/R2 URLs.
- Private media URLs are signed for 3,600 seconds during story loading.
- R2 references are stored as `r2://bucket/key`; audio playback converts them to the authenticated same-origin `/api/media/r2/object` endpoint.
- R2 public assets default to `public, max-age=31536000, immutable`; private assets default to `private, max-age=3600`.
- Many generated beat images and audio files overwrite stable paths such as `image.webp` and `audio.<extension>`. Database sync timestamps are therefore required as cache versions.

## Auth And Session Behavior

- Supabase SSR stores auth in cookies and middleware refreshes sessions.
- `AuthProvider` validates the user with `supabase.auth.getUser()` and listens for auth changes.
- Private story routes require authentication. Existing logout behavior clears in-memory story-library data and redirects to `/signed-out`.
- Local persistence must be partitioned by user and cleared on sign-out or account change.

## Existing Packages And Constraints

- Existing: Zustand and a hand-written IndexedDB helper for pending beat images.
- Not installed: Dexie, idb, localForage, Workbox, React Query, SWR, service-worker tooling, or Capacitor packages.
- No automated test runner is currently configured.
- The existing pending-image database is intentionally staging-only and should remain separate.

## Performance Baseline

The repository has no checked-in browser trace or reproducible authenticated fixture, so exact transfer timings cannot be measured from the terminal. Code inspection confirms every cold route load refetches story data and signs media again; only the browser HTTP cache can currently avoid repeated media transfer. Before/after browser measurements remain a manual QA requirement.

## Capacitor Risks

- The app cannot currently use a straightforward static export: it depends on Server Components, Server Actions, cookies, dynamic metadata, and Node route handlers.
- A future Capacitor app will need either a bundled client shell that calls remote APIs or a dedicated mobile frontend package.
- WebView storage alone is not sufficient for durable native media. The persistence API must allow a future Filesystem adapter.
- Audio autoplay and background/foreground behavior require Android and iOS WebView testing.

## Recommended Implementation Plan

- Add a platform-neutral persistence API under `lib/persistence`.
- Store manifests, progress, and media metadata in a new IndexedDB database.
- Store media responses in Cache Storage under stable synthetic asset keys.
- Derive asset identity from provider/bucket/object path, and use media sync timestamps for invalidation.
- Render cached media through short-lived blob URLs without mutating canonical story data.
- Cache the current beat plus two reachable beats and clean with per-user LRU limits.
- Roll out behind the existing database-backed feature-flag system.
- Define, but do not install, a Capacitor Filesystem adapter.

## Clarifying Questions

Resolved by product direction:

- Apply to `/story`, `/explore`, and `/storyline`.
- Automatically cache the current beat and next two beats.
- Permit offline access only for the locally authenticated same user.
- Clear private cache on sign-out or account change.
- Do not add manual offline-download UI in this release.
