# Target Architecture

## High-level design

```txt
Server / Supabase / CDN
        ↓
Story API returns manifest + asset URLs + versions/hashes
        ↓
Kissago client persistence layer
        ↓
Story player consumes local-first resolved story data
```

## Golden rule

Local cache should improve speed and reduce repeated egress, but the server remains the source of truth.

## Storage split

### Web version

```txt
Story metadata        → IndexedDB
Story progress        → IndexedDB
Images/audio          → Cache Storage API and browser/CDN cache
Tiny preferences      → localStorage or Capacitor Preferences web fallback
```

### Future Capacitor Android/iOS version

```txt
Story metadata        → IndexedDB initially, SQLite later if needed
Story progress        → IndexedDB initially, SQLite later if needed
Images/audio          → Capacitor Filesystem
Tiny preferences      → Capacitor Preferences
```

## Why separate metadata from media?

Story metadata needs query/update behavior:

- list cached stories;
- update progress;
- compare story versions;
- track last watched;
- manage cache status.

Media needs file/response behavior:

- download image/audio;
- play from local path/cache;
- clean old assets;
- avoid base64 in localStorage;
- prepare for native Filesystem.

## Local-first story opening

Desired flow:

```txt
User opens story
  ↓
Check local manifest
  ↓
If cached: render instantly with cached/local media
  ↓
In background: fetch server manifest/version
  ↓
If same version: keep local copy
  ↓
If changed: update metadata and changed assets only
```

## Required abstraction

Create a persistence service that hides platform-specific implementation.

```ts
export interface StoryPersistence {
  getStoryManifest(storyId: string): Promise<CachedStoryManifest | null>;
  saveStoryManifest(manifest: CachedStoryManifest): Promise<void>;

  getProgress(storyId: string): Promise<StoryProgress | null>;
  saveProgress(progress: StoryProgress): Promise<void>;

  resolveMedia(asset: StoryMediaAsset): Promise<ResolvedMedia>;
  prefetchMedia(asset: StoryMediaAsset): Promise<ResolvedMedia>;

  prefetchStory(storyId: string, options?: PrefetchOptions): Promise<void>;
  removeStory(storyId: string): Promise<void>;

  getStorageStats(): Promise<StorageStats>;
  cleanup(options?: CleanupOptions): Promise<void>;
}
```

## Platform adapters

```txt
StoryPersistence
  ├── WebStoryPersistenceAdapter
  │     ├── IndexedDB manifest/progress
  │     └── Cache Storage media
  │
  └── CapacitorStoryPersistenceAdapter
        ├── IndexedDB/SQLite manifest/progress
        └── Capacitor Filesystem media
```

## Story player contract

The story player should not know whether a media item came from:

- remote URL;
- browser cache;
- IndexedDB blob;
- Capacitor file path;
- CDN.

It should receive a resolved URL:

```ts
export type ResolvedMedia = {
  assetId: string;
  source: 'remote' | 'cache-storage' | 'indexeddb' | 'capacitor-filesystem';
  url: string;
  localPath?: string;
  cacheHit: boolean;
};
```

## Avoid

Do not:

- store large base64 media in localStorage;
- make UI directly depend on IndexedDB implementation details;
- overwrite cached assets without version/hash checks;
- assume signed URLs are stable;
- assume WebView storage is permanent;
- add Capacitor plugins before checking app build constraints.
