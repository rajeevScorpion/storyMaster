# Story Manifest and Schema

## Purpose

The story manifest is the local/cache-friendly representation of a Kissago story. It should contain enough information to replay the story quickly without immediately refetching everything from the server.

## Required manifest fields

```ts
export type CachedStoryManifest = {
  storyId: string;
  userId?: string;
  title: string;
  summary?: string;
  coverImage?: StoryMediaAsset;

  schemaVersion: number;
  version?: string | number;
  contentHash?: string;
  updatedAt?: string;

  cachedAt: string;
  lastOpenedAt?: string;
  cacheStatus?: 'metadata-only' | 'partial-media' | 'full-media';

  pages: CachedStoryPage[];
};
```

## Page fields

```ts
export type CachedStoryPage = {
  pageId: string;
  order: number;
  text: string;
  image?: StoryMediaAsset;
  audio?: StoryMediaAsset;
  durationMs?: number;
  wordTimingsUrl?: string;
  wordTimingsHash?: string;
};
```

## Media asset fields

```ts
export type StoryMediaAsset = {
  assetId: string;
  storyId: string;
  pageId?: string;
  kind: 'image' | 'audio';
  remoteUrl: string;
  contentType?: string;
  hash?: string;
  version?: string | number;
  byteSize?: number;
  localPath?: string;
  cachedAt?: string;
};
```

## Progress fields

```ts
export type StoryProgress = {
  storyId: string;
  userId?: string;
  currentPageIndex: number;
  currentAudioTimeMs?: number;
  completed: boolean;
  lastWatchedAt: string;
};
```

## Important design rules

### 1. Include schema version

Always include:

```ts
schemaVersion: 1
```

This allows future migration when Kissago changes story structure.

### 2. Include asset hash/version

Every image/audio should ideally have:

```ts
hash: 'sha256-or-storage-etag'
```

or:

```ts
version: 3
```

This is required for safe cache invalidation.

### 3. Do not rely on URL alone

URLs can change because of:

- signed URL expiry;
- CDN changes;
- storage migration;
- regenerated assets;
- user edits.

Use a stable `assetId` and `hash/version` where possible.

### 4. Store localPath only as optional

The same manifest model should work on web and native. On web, media may live in Cache Storage and not have a file path. On Capacitor, media may have local filesystem paths.

### 5. Avoid base64 in manifest

Never store image/audio base64 inside the manifest.

## Migration plan

Create migration helpers:

```ts
function migrateCachedStoryManifest(input: unknown): CachedStoryManifest {
  // Validate schemaVersion.
  // Upgrade older versions.
  // Reject unsupported future versions.
}
```

## Validation

Before saving manifest:

- ensure `storyId` exists;
- ensure pages are ordered;
- ensure media assets have `assetId` and `remoteUrl`;
- ensure no huge base64 payload exists;
- ensure user-private content follows logout/cache policy.
