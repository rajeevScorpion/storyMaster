# Client Persistence ADR Template

Create this as `CLIENT_PERSISTENCE_ADR.md` after investigation.

# ADR: Kissago Client-Side Story Persistence

## Status

Proposed / Accepted / Superseded

## Date

YYYY-MM-DD

## Context

Kissago users create and watch stories with images and audio. Reopening stories currently causes repeated server/media loading, increasing latency and egress. We need a client persistence layer that works for web today and does not block future Capacitor Android/iOS packaging.

## Repository facts discovered

- Frontend framework:
- Story player location:
- Story data source:
- Image storage:
- Audio storage:
- URL type:
- Current cache headers:
- Existing storage packages:
- Auth/session constraints:
- Capacitor risks:

## Decision

Chosen approach:

```md
Metadata storage:
Progress storage:
Media storage on web:
Media storage on native Capacitor:
Cache invalidation:
Cleanup policy:
```

## Why this decision fits the codebase

Explain based on actual inspected code, not assumptions.

## Alternatives considered

### Alternative 1: localStorage only

Rejected because:

- too small for media-heavy data;
- synchronous API;
- poor fit for story/audio/image persistence;
- not reliable enough for serious app storage.

### Alternative 2: IndexedDB for everything including media blobs

Accept/reject based on repo findings.

Pros:

- easy browser support;
- stores structured data and blobs.

Cons:

- Capacitor docs warn WebView storage can be transient;
- native app media may be better stored with Filesystem.

### Alternative 3: Cache Storage for media + IndexedDB for metadata

Accept/reject based on repo findings.

Pros:

- natural web/PWA media cache;
- clean separation of metadata and assets;
- service worker compatible.

Cons:

- not the final native persistence layer for Capacitor media.

### Alternative 4: SQLite + Filesystem immediately

Accept/reject based on repo findings.

Pros:

- stronger native persistence path;
- better structured data at scale.

Cons:

- may be overkill before Android packaging;
- adds native dependency earlier.

## Consequences

Positive:

- faster repeat story opening;
- reduced image/audio egress;
- progress restore;
- offline-ready foundation;
- Android app path stays open.

Tradeoffs:

- cache invalidation complexity;
- storage cleanup required;
- signed URL strategy may need backend changes;
- native filesystem adapter may be needed for full Capacitor offline mode.

## Open questions

List unanswered questions that require Rajeev/product/backend confirmation.
