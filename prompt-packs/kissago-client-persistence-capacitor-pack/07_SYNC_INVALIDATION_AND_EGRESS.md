# Sync, Invalidation, and Egress Reduction

## Goal

Open stories quickly from local cache while ensuring updates from the server are respected.

## Loading strategy: local-first with background validation

```txt
1. User opens story.
2. Try local manifest immediately.
3. If found, render cached story and start playback when media is available.
4. In background, fetch server manifest/version.
5. If same version/hash, keep local cache.
6. If changed, update manifest and only changed media assets.
7. If no local cache, fetch from server and save manifest.
```

## Server manifest requirement

The server should return a lightweight manifest before or with story details.

```ts
type ServerStoryManifest = {
  storyId: string;
  version: string | number;
  schemaVersion: number;
  updatedAt: string;
  contentHash?: string;
  pages: {
    pageId: string;
    order: number;
    text: string;
    imageUrl: string;
    imageHash?: string;
    imageVersion?: string | number;
    audioUrl: string;
    audioHash?: string;
    audioVersion?: string | number;
    durationMs?: number;
  }[];
};
```

## Asset invalidation

Use this decision order:

```txt
1. If asset hash changed → refetch asset.
2. Else if asset version changed → refetch asset.
3. Else if URL changed but hash/version same → update remote URL, keep local media if valid.
4. Else keep cache.
```

## File naming recommendation

Prefer immutable filenames:

```txt
storyId/pageId/image-{hash}.webp
storyId/pageId/audio-{hash}.mp3
```

Avoid overwriting:

```txt
storyId/pageId/image.webp
storyId/pageId/audio.mp3
```

If files are overwritten at the same URL, browser/CDN caching becomes more error-prone.

## Cache headers

For immutable generated media:

```txt
Cache-Control: public, max-age=31536000, immutable
```

For user/private or frequently changing manifests:

```txt
Cache-Control: private, max-age=60, stale-while-revalidate=300
```

Confirm existing hosting/CDN behavior before changing headers.

## Signed URL strategy

If media uses signed URLs:

- do not store signed URL as permanent identity;
- store stable `assetId`;
- refresh signed URL when expired;
- consider app-controlled stable proxy URL;
- consider public immutable URLs only if privacy requirements allow.

## Egress metrics to log

Add development logging or analytics events if available:

```txt
story_cache_manifest_hit
story_cache_manifest_miss
story_media_cache_hit
story_media_cache_miss
story_media_prefetch_success
story_media_prefetch_failed
story_cache_cleanup_completed
story_version_mismatch
```

Do not log private story text unless analytics policy allows it.

## Storage estimate

For web:

```ts
if ('storage' in navigator && 'estimate' in navigator.storage) {
  const estimate = await navigator.storage.estimate();
}
```

Use this to avoid aggressive caching on low-storage devices.

## Offline behavior

Define behavior explicitly:

```txt
Cached full story + cached media       → playable offline
Cached metadata only                   → show text/cover, require network for media
Missing audio                          → play story visually, show audio unavailable/retry
Missing image                          → show placeholder and retry
Unsupported schema                     → ask user to update app
```

## Logout behavior

Ask product/backend before implementation.

Possible policies:

1. Clear all cached private stories on logout.
2. Keep public/generated media but clear user progress.
3. Keep cache encrypted/native only.
4. Ask user: “Remove downloaded stories from this device?”

Do not guess.
