import { toMediaFetchUrl } from '@/lib/media/client';
import {
  MANIFEST_STORE,
  MEDIA_STORE,
  PROGRESS_STORE,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  manifestRecordKey,
  progressRecordKey,
  type ManifestRecord,
  type MediaRecord,
  type ProgressRecord,
} from './database';
import { getMediaCacheKey } from './identity';
import { logPersistenceEvent } from './logging';
import { migrateCachedStoryManifest } from './manifest';
import type {
  CachedStoryManifest,
  CleanupOptions,
  ResolvedMedia,
  StorageStats,
  StoryManifestScope,
  StoryMediaAsset,
  StoryPersistence,
  StoryProgress,
} from './types';

const CACHE_NAME = 'kissago-story-media-v1';
const inflightDownloads = new Map<string, Promise<Response>>();
const objectUrls = new Map<string, { url: string; refs: number }>();

function canUseCacheStorage(): boolean {
  return typeof caches !== 'undefined';
}

function mediaRecordKey(asset: StoryMediaAsset): string {
  return [asset.userId, asset.assetId, asset.version].join(':');
}

async function deleteMediaRecord(record: MediaRecord): Promise<void> {
  if (canUseCacheStorage()) {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(record.cacheKey);
  }
  await idbDelete(MEDIA_STORE, record.key);
}

async function fetchAndCache(asset: StoryMediaAsset): Promise<Response> {
  const key = mediaRecordKey(asset);
  const existing = inflightDownloads.get(key);
  if (existing) return existing.then((response) => response.clone());

  const promise = (async () => {
    const response = await fetch(toMediaFetchUrl(asset.remoteUrl), { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Media fetch failed: ${response.status}`);
    if (canUseCacheStorage()) {
      const cacheKey = getMediaCacheKey(asset.userId, asset.assetId, asset.version);
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, response.clone());
      const blob = await response.clone().blob();
      await idbPut<MediaRecord>(MEDIA_STORE, {
        key,
        userId: asset.userId,
        storyId: asset.storyId,
        assetId: asset.assetId,
        version: asset.version,
        cacheKey,
        byteSize: asset.byteSize ?? blob.size,
        cachedAt: Date.now(),
        lastAccessedAt: Date.now(),
      });
    }
    return response;
  })();

  inflightDownloads.set(key, promise);
  try {
    return (await promise).clone();
  } finally {
    inflightDownloads.delete(key);
  }
}

async function getCachedResponse(asset: StoryMediaAsset): Promise<Response | null> {
  if (!canUseCacheStorage()) return null;
  const record = await idbGet<MediaRecord>(MEDIA_STORE, mediaRecordKey(asset));
  if (!record) return null;
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(record.cacheKey);
  if (!response) {
    await idbDelete(MEDIA_STORE, record.key);
    return null;
  }
  await idbPut<MediaRecord>(MEDIA_STORE, { ...record, lastAccessedAt: Date.now() });
  return response;
}

function responseToObjectUrl(asset: StoryMediaAsset, response: Response): Promise<string> {
  const key = mediaRecordKey(asset);
  const existing = objectUrls.get(key);
  if (existing) {
    existing.refs += 1;
    return Promise.resolve(existing.url);
  }
  return response.blob().then((blob) => {
    const url = URL.createObjectURL(blob);
    objectUrls.set(key, { url, refs: 1 });
    return url;
  });
}

export class WebStoryPersistenceAdapter implements StoryPersistence {
  async getStoryManifest(scope: StoryManifestScope): Promise<CachedStoryManifest | null> {
    const key = manifestRecordKey(scope);
    const record = await idbGet<ManifestRecord>(MANIFEST_STORE, key);
    const manifest = migrateCachedStoryManifest(record?.manifest);
    if (!manifest || manifest.userId !== scope.userId) {
      if (record) await idbDelete(MANIFEST_STORE, key);
      logPersistenceEvent('story_cache_manifest_miss', { storyId: scope.storyId, readerKind: scope.readerKind });
      return null;
    }
    const now = new Date().toISOString();
    manifest.lastOpenedAt = now;
    await idbPut<ManifestRecord>(MANIFEST_STORE, { ...record!, lastOpenedAt: Date.now(), manifest });
    logPersistenceEvent('story_cache_manifest_hit', { storyId: scope.storyId, readerKind: scope.readerKind });
    return manifest;
  }

  async saveStoryManifest(manifest: CachedStoryManifest): Promise<void> {
    const key = manifestRecordKey(manifest);
    const previous = await idbGet<ManifestRecord>(MANIFEST_STORE, key);
    const nextVersions = new Set(manifest.assets.map((asset) => mediaRecordKey(asset)));
    if (previous) {
      const stale = previous.manifest.assets.filter((asset) => !nextVersions.has(mediaRecordKey(asset)));
      await Promise.all(stale.map(async (asset) => {
        const record = await idbGet<MediaRecord>(MEDIA_STORE, mediaRecordKey(asset));
        if (record) await deleteMediaRecord(record);
      }));
      if (previous.manifest.sourceUpdatedAt !== manifest.sourceUpdatedAt) {
        logPersistenceEvent('story_version_mismatch', { storyId: manifest.storyId });
      }
    }
    await idbPut<ManifestRecord>(MANIFEST_STORE, {
      key,
      userId: manifest.userId,
      storyId: manifest.storyId,
      readerKind: manifest.readerKind,
      lastOpenedAt: Date.parse(manifest.lastOpenedAt) || Date.now(),
      manifest,
    });
  }

  async getProgress(scope: StoryManifestScope): Promise<StoryProgress | null> {
    const record = await idbGet<ProgressRecord>(PROGRESS_STORE, progressRecordKey(scope));
    return record?.progress && record.progress.userId === scope.userId ? record.progress : null;
  }

  async saveProgress(progress: StoryProgress): Promise<void> {
    const key = progressRecordKey(progress);
    await idbPut<ProgressRecord>(PROGRESS_STORE, {
      key,
      userId: progress.userId,
      storyId: progress.storyId,
      readerKind: progress.readerKind,
      progress,
    });
  }

  async resolveMedia(asset: StoryMediaAsset): Promise<ResolvedMedia> {
    try {
      const cached = await getCachedResponse(asset);
      if (cached) {
        const url = await responseToObjectUrl(asset, cached);
        logPersistenceEvent('story_media_cache_hit', { assetId: asset.assetId });
        return { assetId: asset.assetId, source: 'cache-storage', url, cacheHit: true, resolvedAt: new Date().toISOString() };
      }

      void fetchAndCache(asset)
        .then(() => logPersistenceEvent('story_media_prefetch_success', { assetId: asset.assetId }))
        .catch((error) => logPersistenceEvent('story_media_prefetch_failed', { assetId: asset.assetId, error: String(error) }));

      logPersistenceEvent('story_media_cache_miss', { assetId: asset.assetId });
      return { assetId: asset.assetId, source: 'remote', url: toMediaFetchUrl(asset.remoteUrl), cacheHit: false, resolvedAt: new Date().toISOString() };
    } catch (error) {
      logPersistenceEvent('story_media_prefetch_failed', { assetId: asset.assetId, error: String(error) });
      return { assetId: asset.assetId, source: 'remote', url: toMediaFetchUrl(asset.remoteUrl), cacheHit: false, resolvedAt: new Date().toISOString() };
    }
  }

  async prefetchMedia(asset: StoryMediaAsset): Promise<ResolvedMedia> {
    try {
      const cached = await getCachedResponse(asset);
      if (!cached) await fetchAndCache(asset);
      logPersistenceEvent(cached ? 'story_media_cache_hit' : 'story_media_prefetch_success', { assetId: asset.assetId });
      return { assetId: asset.assetId, source: 'cache-storage', url: asset.remoteUrl, cacheHit: Boolean(cached), resolvedAt: new Date().toISOString() };
    } catch (error) {
      logPersistenceEvent('story_media_prefetch_failed', { assetId: asset.assetId, error: String(error) });
      return { assetId: asset.assetId, source: 'remote', url: toMediaFetchUrl(asset.remoteUrl), cacheHit: false, resolvedAt: new Date().toISOString() };
    }
  }

  async removeStory(userId: string, storyId: string): Promise<void> {
    const [manifests, progress, media] = await Promise.all([
      idbGetAll<ManifestRecord>(MANIFEST_STORE, 'by_user', userId),
      idbGetAll<ProgressRecord>(PROGRESS_STORE, 'by_user', userId),
      idbGetAll<MediaRecord>(MEDIA_STORE, 'by_story', IDBKeyRange.only([userId, storyId])),
    ]);
    await Promise.all([
      ...manifests.filter((record) => record.storyId === storyId).map((record) => idbDelete(MANIFEST_STORE, record.key)),
      ...progress.filter((record) => record.storyId === storyId).map((record) => idbDelete(PROGRESS_STORE, record.key)),
      ...media.map(deleteMediaRecord),
    ]);
  }

  async clearUser(userId: string): Promise<void> {
    const [manifests, progress, media] = await Promise.all([
      idbGetAll<ManifestRecord>(MANIFEST_STORE, 'by_user', userId),
      idbGetAll<ProgressRecord>(PROGRESS_STORE, 'by_user', userId),
      idbGetAll<MediaRecord>(MEDIA_STORE, 'by_user', userId),
    ]);
    await Promise.all([
      ...manifests.map((record) => idbDelete(MANIFEST_STORE, record.key)),
      ...progress.map((record) => idbDelete(PROGRESS_STORE, record.key)),
      ...media.map(deleteMediaRecord),
    ]);
    for (const [key, value] of objectUrls) {
      if (key.startsWith(`${userId}:`)) {
        URL.revokeObjectURL(value.url);
        objectUrls.delete(key);
      }
    }
  }

  async getStorageStats(userId: string): Promise<StorageStats> {
    const [manifests, media, estimate] = await Promise.all([
      idbGetAll<ManifestRecord>(MANIFEST_STORE, 'by_user', userId),
      idbGetAll<MediaRecord>(MEDIA_STORE, 'by_user', userId),
      typeof navigator !== 'undefined' && navigator.storage?.estimate
        ? navigator.storage.estimate()
        : Promise.resolve({ usage: undefined, quota: undefined }),
    ]);
    return {
      estimatedUsageBytes: estimate.usage,
      estimatedQuotaBytes: estimate.quota,
      cachedStoryCount: new Set(manifests.map((record) => record.storyId)).size,
      cachedAssetCount: media.length,
    };
  }

  async cleanup(options: CleanupOptions): Promise<void> {
    const maxStories = options.maxStories ?? 10;
    const maxAgeMs = (options.maxAgeDays ?? 30) * 24 * 60 * 60 * 1000;
    const preserve = new Set(options.preserveStoryIds ?? []);
    const manifests = await idbGetAll<ManifestRecord>(MANIFEST_STORE, 'by_user', options.userId);
    const stories = new Map<string, number>();
    for (const record of manifests) stories.set(record.storyId, Math.max(stories.get(record.storyId) ?? 0, record.lastOpenedAt));
    const ordered = Array.from(stories.entries()).sort((left, right) => right[1] - left[1]);
    const remove = new Set<string>();
    ordered.forEach(([storyId, openedAt], index) => {
      if (!preserve.has(storyId) && (Date.now() - openedAt > maxAgeMs || index >= maxStories)) remove.add(storyId);
    });

    const stats = await this.getStorageStats(options.userId);
    if (stats.estimatedUsageBytes && stats.estimatedQuotaBytes && stats.estimatedUsageBytes / stats.estimatedQuotaBytes >= 0.8) {
      let projected = stats.estimatedUsageBytes;
      const media = await idbGetAll<MediaRecord>(MEDIA_STORE, 'by_user', options.userId);
      for (const [storyId] of ordered.slice().reverse()) {
        if (projected / stats.estimatedQuotaBytes < 0.7) break;
        if (preserve.has(storyId)) continue;
        remove.add(storyId);
        projected -= media.filter((record) => record.storyId === storyId).reduce((sum, record) => sum + record.byteSize, 0);
      }
    }

    await Promise.all(Array.from(remove, (storyId) => this.removeStory(options.userId, storyId)));
    logPersistenceEvent('story_cache_cleanup_completed', { userId: options.userId, removedStories: remove.size });
  }

  releaseMedia(url: string): void {
    for (const [key, value] of objectUrls) {
      if (value.url !== url) continue;
      value.refs -= 1;
      if (value.refs <= 0) {
        URL.revokeObjectURL(value.url);
        objectUrls.delete(key);
      }
      return;
    }
  }
}
