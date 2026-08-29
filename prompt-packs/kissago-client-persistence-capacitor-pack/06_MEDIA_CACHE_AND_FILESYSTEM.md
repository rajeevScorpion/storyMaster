# Media Cache and Capacitor Filesystem Strategy

## Goal

Avoid repeatedly downloading story images and audio while keeping the implementation compatible with future Capacitor Android/iOS apps.

## Web media cache

Preferred web strategy:

```txt
Cache Storage API for image/audio responses
IndexedDB for metadata and media index
Browser/CDN cache headers for immutable generated assets
```

## Capacitor native media cache

Preferred native strategy:

```txt
Capacitor Filesystem for image/audio files
IndexedDB or SQLite for metadata and local path index
Capacitor Preferences for tiny settings only
```

## Why not localStorage?

Do not store media in localStorage.

Reasons:

- not suitable for large binary data;
- synchronous API can block UI;
- base64 increases size;
- poor cleanup/query behavior;
- not future-proof for media-heavy offline stories.

## Web implementation concept

```ts
async function prefetchMediaWeb(asset: StoryMediaAsset): Promise<ResolvedMedia> {
  const cache = await caches.open('kissago-story-media-v1');
  const request = new Request(asset.remoteUrl, { mode: 'cors' });

  const cached = await cache.match(request);
  if (cached) {
    return {
      assetId: asset.assetId,
      source: 'cache-storage',
      url: asset.remoteUrl,
      cacheHit: true,
      resolvedAt: new Date().toISOString(),
    };
  }

  const response = await fetch(request);
  if (!response.ok) throw new Error(`Failed to fetch media: ${response.status}`);

  await cache.put(request, response.clone());

  return {
    assetId: asset.assetId,
    source: 'cache-storage',
    url: asset.remoteUrl,
    cacheHit: false,
    resolvedAt: new Date().toISOString(),
  };
}
```

Adjust based on actual CORS, signed URL, and auth behavior.

## Important signed URL issue

If Supabase or another service returns short-lived signed URLs, using the signed URL as the cache key may cause repeated downloads.

Investigate first:

```md
Are image/audio URLs signed?
How long do they last?
Can assets be served through stable app-controlled URLs?
Can immutable generated files be public with hard-to-guess names?
```

Possible solutions:

1. Stable public CDN URLs for non-sensitive generated media.
2. Longer-lived signed URLs for generated story assets.
3. App-controlled proxy route such as `/api/story-assets/:assetId`.
4. Cache by stable asset ID in IndexedDB and refresh remote URL separately.

Do not choose without checking current code and privacy requirements.

## Capacitor Filesystem implementation concept

When Android/iOS implementation begins:

```ts
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

async function resolveNativeFileUrl(localPath: string) {
  return Capacitor.convertFileSrc(localPath);
}
```

Native strategy:

```txt
stories/{storyId}/{assetId}.webp
stories/{storyId}/{assetId}.mp3
```

Use app-owned storage directories. Decide exact directory after native testing.

## Directory rule of thumb

For Capacitor app:

```txt
Directory.Data     → saved/recent stories that should remain with app data
Directory.Cache    → temporary previews that may be cleared
Directory.Documents → only if user-visible export/sharing is required
```

Do not put story cache in user-visible Documents unless product explicitly wants it.

## Prefetch policy

Start conservative:

```txt
When story opens:
- load current page media first;
- prefetch next 1–2 pages;
- background prefetch rest only on good network or explicit offline save.
```

Suggested options:

```ts
const DEFAULT_PREFETCH_POLICY = {
  nextPageCount: 2,
  fullStoryOnWifiOnly: false,
  maxAutoCachedStories: 10,
};
```

## Offline save option

Add later:

```txt
Save story offline
Remove offline story
Storage used
```

This gives users control over device storage.

## Cleanup policy

Use LRU cleanup:

```txt
Preserve:
- currently open story;
- last 5–10 watched stories;
- explicitly saved offline stories.

Remove:
- old temporary media;
- incomplete failed downloads;
- media whose hash no longer matches manifest.
```

## Rendering rule

The story player should receive a playable/displayable URL only.

```ts
const resolved = await persistence.resolveMedia(page.audio);
audio.src = resolved.url;
```

The UI should not need to know if the URL is remote, Cache Storage-backed, or Capacitor file-backed.
