# Repo Investigation First

The coder must investigate before implementation. Do not assume the stack or current behavior.

## 1. Project structure

Check:

- Is this Next.js App Router, Next.js Pages Router, Vite, CRA, Remix, or another stack?
- Is the story player client-rendered or server-rendered?
- Are there monorepo packages?
- Is there already a shared `lib`, `services`, `hooks`, or `stores` folder?
- Is TypeScript used consistently?

Record findings:

```md
Frontend framework:
Router:
Build command:
Story player location:
State management:
Existing persistence packages:
```

## 2. Story fetch flow

Trace exactly how a story loads.

Find:

- API endpoint or Supabase query used to fetch story list;
- API endpoint or Supabase query used to fetch a single story;
- whether stories are fetched on server or client;
- whether image/audio URLs are returned directly or generated later;
- whether story creation writes all data at once or incrementally.

Questions to answer:

```md
Where is story data fetched?
What is the story object shape?
Are images/audio generated during story creation or lazily?
Are audio files separate per page or one file per story?
Are there timestamps/durations for audio?
```

## 3. Media URL investigation

This is critical for reducing egress.

Find:

- Are story images stored in Supabase Storage, Cloudflare, Vercel, or another CDN?
- Are story audio files stored in Supabase Storage, ElevenLabs output, Cloudflare R2, or another service?
- Are URLs public?
- Are URLs signed?
- If signed, what is the expiry time?
- Are filenames versioned or overwritten?
- Are cache headers configured during upload?

Record:

```md
Image storage provider:
Audio storage provider:
URL type: public / signed / proxied / unknown
Signed URL expiry:
Cache-Control header:
Filename versioning strategy:
```

## 4. Auth/session investigation

Check:

- Is auth handled by Supabase Auth?
- Is session stored in cookies, localStorage, IndexedDB, or server session?
- Does the story player need auth to fetch media?
- Can cached media be viewed after logout?

Do not change auth behavior without approval.

## 5. Existing cache/state packages

Search package files for:

- `dexie`
- `idb`
- `localforage`
- `workbox`
- `@capacitor/*`
- `zustand`
- `redux`
- `tanstack/react-query`
- `swr`
- `pouchdb`
- `service-worker`

Record what exists before adding anything.

## 6. Current performance symptoms

Find or instrument:

- how many network requests happen on reopening one story;
- total image/audio transfer size;
- time to first visible story page;
- time to first playable audio;
- repeated downloads after refresh/reopen;
- cache headers in browser devtools.

Baseline metrics:

```md
First load time:
Second load time before persistence:
Image requests repeated? yes/no
Audio requests repeated? yes/no
Total transfer first load:
Total transfer second load:
```

## 7. Capacitor viability investigation

Check:

- Can the app build as static/client bundle if needed?
- Are there server-only imports in the story player?
- Does the UI rely on Node APIs not available in WebView?
- Does media playback work on mobile Safari/Android Chrome?
- Are any APIs blocked by WebView/CORS?
- Does the app require `server.url` live loading, or can assets be bundled?

Record risks clearly.

## 8. Investigation output format

Create `INVESTIGATION_REPORT.md` with this structure:

```md
# Investigation Report

## Summary

## Current architecture

## Story data flow

## Media storage and URL behavior

## Auth/session behavior

## Existing packages and constraints

## Performance baseline

## Capacitor risks

## Recommended implementation plan

## Clarifying questions
```
