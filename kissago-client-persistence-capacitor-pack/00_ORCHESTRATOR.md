# Orchestrator: Kissago Client Persistence + Capacitor Readiness

## Mission

Create a persistence layer for Kissago stories that improves performance, reduces repeated image/audio egress, and keeps the app ready for a future Capacitor Android/iOS build.

## Core principle

**Server is source of truth. Client cache is a fast local playable copy.**

Never make local storage the canonical source of story ownership, purchase status, moderation state, user identity, or final story content.

---

## Execution sequence

### Phase 0 — Investigation only

Before implementation, inspect the codebase and document findings.

Deliverable:

- `INVESTIGATION_REPORT.md`

Use:

- `01_REPO_INVESTIGATION_FIRST.md`
- `11_CLARIFYING_QUESTIONS.md`

Do not write persistence code until this is complete.

---

### Phase 1 — Architecture decision

Create a short decision record from the investigation.

Deliverable:

- `CLIENT_PERSISTENCE_ADR.md`

Use:

- `02_DECISION_LOG_TEMPLATE.md`
- `03_TARGET_ARCHITECTURE.md`

Decide based on actual repo facts:

- IndexedDB wrapper or existing storage package;
- Cache Storage/service worker or direct browser cache;
- whether media should be cached as Responses, Blobs, or URLs;
- whether Capacitor Filesystem adapter should be implemented now or only defined.

---

### Phase 2 — Storage abstraction

Implement a platform-neutral persistence interface.

Required concept:

```ts
interface StoryPersistence {
  getStoryManifest(storyId: string): Promise<CachedStoryManifest | null>;
  saveStoryManifest(manifest: CachedStoryManifest): Promise<void>;
  getProgress(storyId: string): Promise<StoryProgress | null>;
  saveProgress(progress: StoryProgress): Promise<void>;
  resolveMedia(asset: StoryMediaAsset): Promise<ResolvedMedia>;
  prefetchStory(storyId: string, options?: PrefetchOptions): Promise<void>;
  removeStory(storyId: string): Promise<void>;
}
```

Use:

- `04_STORAGE_ABSTRACTION_SPEC.md`

---

### Phase 3 — Story manifest and progress

Persist:

- story metadata;
- pages/scenes;
- asset references;
- version/hash fields;
- current page;
- current audio time;
- completion state;
- last watched timestamp.

Use:

- `05_STORY_MANIFEST_AND_SCHEMA.md`

---

### Phase 4 — Media persistence

For web:

- use Cache Storage where appropriate;
- use browser/CDN cache headers;
- avoid storing base64 in localStorage;
- prefetch current page + next 1–2 pages;
- optionally cache full story after watch starts or when user taps “Save offline”.

For future Capacitor native:

- use Capacitor Filesystem for images/audio;
- keep local file path in metadata;
- convert native file paths to WebView-friendly URLs with `Capacitor.convertFileSrc` when rendering.

Use:

- `06_MEDIA_CACHE_AND_FILESYSTEM.md`

---

### Phase 5 — Sync, invalidation, and egress reduction

Implement:

- version/hash-based asset validation;
- stale-while-revalidate style story loading;
- safe cleanup for old stories;
- storage estimate/quota handling;
- logging for cache hit/miss.

Use:

- `07_SYNC_INVALIDATION_AND_EGRESS.md`

---

### Phase 6 — Capacitor readiness

Prepare the repo so the next implementation step can be Android packaging.

Do not force Capacitor setup unless requested. Instead, make the persistence layer compatible.

Use:

- `08_CAPACITOR_READINESS.md`

---

### Phase 7 — Tests and acceptance

Add tests/checks for:

- first story load;
- second story load from cache;
- offline replay of cached story;
- progress restore;
- version mismatch refresh;
- missing media fallback;
- cache cleanup;
- mobile WebView compatibility assumptions.

Use:

- `09_IMPLEMENTATION_PHASES_AND_ACCEPTANCE.md`
- `10_TESTING_QA_CHECKLIST.md`

---

## Final deliverable expected from AI coder

After implementation, provide:

1. Summary of repo findings.
2. Files changed.
3. Storage design chosen and why.
4. Known limitations.
5. Manual test steps.
6. Capacitor readiness notes.
7. Questions still needing product/technical answers.
