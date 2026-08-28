# Implementation Phases and Acceptance Criteria

## Phase 0 — Investigation

### Tasks

- Inspect repo structure.
- Trace story loading flow.
- Trace image/audio URL generation.
- Check auth/session behavior.
- Check current caching/storage packages.
- Measure repeated story load behavior.
- Identify Capacitor blockers.

### Acceptance criteria

- `INVESTIGATION_REPORT.md` exists.
- No implementation decisions are made without repo evidence.
- Clarifying questions are listed.

---

## Phase 1 — Add persistence interfaces

### Tasks

- Add TypeScript interfaces for story manifest, progress, media asset, resolved media.
- Add `StoryPersistence` interface.
- Add a factory to select web/native adapter later.

### Acceptance criteria

- Story player can import from one persistence module.
- No UI component directly imports IndexedDB/Cache Storage details.

---

## Phase 2 — Save and load story manifest

### Tasks

- Save story manifest after successful server fetch.
- Load cached manifest before server fetch where safe.
- Add schema version.
- Add migration/validation.

### Acceptance criteria

- Opening a previously loaded story can render from local manifest.
- If local manifest is missing, app falls back to server.
- Invalid local manifest does not crash story player.

---

## Phase 3 — Save playback progress

### Tasks

- Save current page index.
- Save current audio time if available.
- Save completed state.
- Restore progress when reopening story.

### Acceptance criteria

- User can continue a story from last watched page.
- Progress survives refresh/reopen.
- Progress updates do not cause excessive writes.

---

## Phase 4 — Web media cache

### Tasks

- Cache images/audio using Cache Storage or chosen repo-compatible approach.
- Resolve media through adapter.
- Prefetch current page and next 1–2 pages.
- Fall back to remote URL on cache failure.

### Acceptance criteria

- Second open of a story causes fewer media network transfers.
- Story still plays if caching fails.
- No large media is written to localStorage.

---

## Phase 5 — Version/hash invalidation

### Tasks

- Compare local manifest version/hash with server.
- Refresh only changed assets.
- Update local manifest safely.

### Acceptance criteria

- Changed story content updates correctly.
- Unchanged images/audio are reused.
- Expired signed URLs do not permanently break cached media.

---

## Phase 6 — Cleanup and quota

### Tasks

- Implement LRU cleanup for non-saved stories.
- Preserve current story and recent stories.
- Add storage estimate where supported.
- Add manual remove cached story option if UI allows.

### Acceptance criteria

- Cache does not grow without limit.
- Cleanup does not remove currently playing media.
- Cache failures are recoverable.

---

## Phase 7 — Capacitor adapter preparation

### Tasks

- Define native media adapter contract.
- Add platform detection only behind factory.
- Keep UI independent from native file paths.
- Document Android packaging readiness.

### Acceptance criteria

- A Capacitor Filesystem adapter can be added without rewriting story UI.
- Story player only consumes resolved URLs.
- No platform-specific code leaks into general components.

---

## Phase 8 — Final validation

### Tasks

- Add unit/integration tests where the repo supports them.
- Add manual QA checklist.
- Measure before/after load behavior.
- Document known limitations.

### Acceptance criteria

- Repeat story opening is faster.
- Media egress is reduced on repeat opens.
- No existing story creation flow breaks.
- Android app path is clearer and lower risk.
