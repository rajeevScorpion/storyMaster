# Storage Abstraction Spec

## Objective

Introduce a single persistence API used by the story player and story library. This prevents the app from becoming tied to browser-only storage and keeps the Android/iOS Capacitor path open.

## Suggested file locations

Decide exact locations after repo investigation. Possible locations:

```txt
src/lib/persistence/
src/services/persistence/
src/features/stories/persistence/
app/lib/persistence/
```

Do not create a new structure if the repo already has a clear convention.

## Core interfaces

```ts
export type PlatformKind = 'web' | 'android' | 'ios';

export type StoryMediaKind = 'image' | 'audio';

export type StoryMediaAsset = {
  assetId: string;
  storyId: string;
  pageId?: string;
  kind: StoryMediaKind;
  remoteUrl: string;
  contentType?: string;
  hash?: string;
  version?: string | number;
  byteSize?: number;
};

export type ResolvedMedia = {
  assetId: string;
  source: 'remote' | 'cache-storage' | 'indexeddb' | 'capacitor-filesystem';
  url: string;
  localPath?: string;
  cacheHit: boolean;
  resolvedAt: string;
};

export type StoryProgress = {
  storyId: string;
  userId?: string;
  currentPageIndex: number;
  currentAudioTimeMs?: number;
  completed: boolean;
  updatedAt: string;
};

export type CachedStoryManifest = {
  storyId: string;
  userId?: string;
  title: string;
  version?: string | number;
  schemaVersion: number;
  updatedAt?: string;
  cachedAt: string;
  lastOpenedAt?: string;
  pages: CachedStoryPage[];
};

export type CachedStoryPage = {
  pageId: string;
  order: number;
  text: string;
  image?: StoryMediaAsset;
  audio?: StoryMediaAsset;
  durationMs?: number;
};

export type PrefetchOptions = {
  mode?: 'current-page' | 'next-pages' | 'full-story';
  currentPageIndex?: number;
  nextPageCount?: number;
  networkOnly?: boolean;
};

export type StorageStats = {
  estimatedUsageBytes?: number;
  estimatedQuotaBytes?: number;
  cachedStoryCount: number;
  cachedAssetCount?: number;
};

export type CleanupOptions = {
  maxStories?: number;
  maxAgeDays?: number;
  preserveStoryIds?: string[];
};

export interface StoryPersistence {
  getStoryManifest(storyId: string): Promise<CachedStoryManifest | null>;
  saveStoryManifest(manifest: CachedStoryManifest): Promise<void>;
  removeStory(storyId: string): Promise<void>;

  getProgress(storyId: string): Promise<StoryProgress | null>;
  saveProgress(progress: StoryProgress): Promise<void>;

  resolveMedia(asset: StoryMediaAsset): Promise<ResolvedMedia>;
  prefetchMedia(asset: StoryMediaAsset): Promise<ResolvedMedia>;
  prefetchStory(storyId: string, options?: PrefetchOptions): Promise<void>;

  getStorageStats(): Promise<StorageStats>;
  cleanup(options?: CleanupOptions): Promise<void>;
}
```

## Factory

Use a factory to select adapter.

```ts
export function createStoryPersistence(): StoryPersistence {
  // Decide exact detection based on dependencies available in repo.
  // For future Capacitor:
  // if (Capacitor.isNativePlatform()) return new CapacitorStoryPersistenceAdapter();
  return new WebStoryPersistenceAdapter();
}
```

## Web adapter behavior

Minimum behavior:

- save manifests and progress in IndexedDB;
- use Cache Storage for image/audio if available;
- fall back to remote URL if cache fails;
- never block story playback because cache write failed;
- log cache errors in development.

## Future native adapter behavior

When Capacitor is added:

- save downloaded media via `@capacitor/filesystem`;
- store local path in manifest/index;
- convert local file path before rendering in WebView;
- use `@capacitor/preferences` only for tiny values;
- consider SQLite only after the current data volume justifies it.

## Error handling

The persistence layer should be resilient.

Rules:

```txt
Cache read failure      → use remote URL
Cache write failure     → continue playback, log warning
Manifest missing        → fetch from server
Version mismatch        → refresh affected manifest/assets
Media missing locally   → fetch remote, then repair cache
User logout             → apply product decision: clear private cached data or retain only safe public cache
```

## Feature flags

Add flags if the repo has config support:

```ts
ENABLE_STORY_MANIFEST_CACHE=true
ENABLE_MEDIA_CACHE=true
ENABLE_STORY_PROGRESS_CACHE=true
ENABLE_OFFLINE_SAVE=false
```

Do not invent environment variable conventions if the repo already has its own config pattern.
