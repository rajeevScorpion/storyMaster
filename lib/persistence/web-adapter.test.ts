import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deletePersistenceDatabaseForTests } from './database';
import { WebStoryPersistenceAdapter } from './web-adapter';
import type { CachedTreeStoryManifest, StoryMediaAsset } from './types';

class MemoryCache {
  private records = new Map<string, Response>();

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.records.get(String(request))?.clone();
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.records.set(String(request), response.clone());
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.records.delete(String(request));
  }

  clear(): void {
    this.records.clear();
  }
}

const cache = new MemoryCache();
Object.defineProperty(globalThis, 'caches', {
  configurable: true,
  value: { open: vi.fn(async () => cache) },
});

const createObjectURL = vi.fn(() => `blob:test-${createObjectURL.mock.calls.length}`);
const revokeObjectURL = vi.fn();
Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

function manifest(userId: string, storyId: string, lastOpenedAt = new Date().toISOString()): CachedTreeStoryManifest {
  return {
    schemaVersion: 1,
    readerKind: 'story',
    userId,
    storyId,
    title: storyId,
    sourceUpdatedAt: 'v1',
    cachedAt: lastOpenedAt,
    lastOpenedAt,
    assets: [],
    payload: { storySessionId: storyId } as CachedTreeStoryManifest['payload'],
  };
}

function asset(version = 'v1'): StoryMediaAsset {
  return {
    assetId: 'r2:private:stories/story-1/beat/image.webp:image',
    storyId: 'story-1',
    pageId: 'beat-1',
    userId: 'user-1',
    kind: 'image',
    remoteUrl: 'https://media.example/image.webp',
    version,
  };
}

beforeEach(async () => {
  await deletePersistenceDatabaseForTests();
  cache.clear();
  vi.clearAllMocks();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

describe('WebStoryPersistenceAdapter', () => {
  it('partitions manifests and progress by user', async () => {
    const adapter = new WebStoryPersistenceAdapter();
    await adapter.saveStoryManifest(manifest('user-1', 'story-1'));
    await adapter.saveProgress({
      readerKind: 'story',
      userId: 'user-1',
      storyId: 'story-1',
      currentNodeId: 'beat-2',
      audioTimeMs: 1200,
      completed: false,
      updatedAt: new Date().toISOString(),
    });

    expect(await adapter.getStoryManifest({ readerKind: 'story', userId: 'user-1', storyId: 'story-1' })).not.toBeNull();
    expect(await adapter.getStoryManifest({ readerKind: 'story', userId: 'user-2', storyId: 'story-1' })).toBeNull();
    expect((await adapter.getProgress({ readerKind: 'story', userId: 'user-1', storyId: 'story-1' }))?.audioTimeMs).toBe(1200);
  });

  it('returns remote media on cache miss and reuses cached media later', async () => {
    const adapter = new WebStoryPersistenceAdapter();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['image']), { status: 200, headers: { 'Content-Type': 'image/webp' } })
    );

    const first = await adapter.resolveMedia(asset());
    expect(first.source).toBe('remote');
    expect(first.cacheHit).toBe(false);
    expect(first.url).toBe(asset().remoteUrl);
    expect(createObjectURL).not.toHaveBeenCalled();

    await adapter.prefetchMedia(asset());

    const second = await adapter.resolveMedia(asset());
    adapter.releaseMedia(second.url);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      asset().remoteUrl,
      { credentials: 'same-origin' }
    );
    expect(second.source).toBe('cache-storage');
    expect(second.cacheHit).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('invalidates media when an asset version changes', async () => {
    const adapter = new WebStoryPersistenceAdapter();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['image']), { status: 200, headers: { 'Content-Type': 'image/webp' } })
    );
    const firstAsset = asset('v1');
    await adapter.prefetchMedia(firstAsset);
    await adapter.saveStoryManifest({ ...manifest('user-1', 'story-1'), assets: [firstAsset] });
    await adapter.saveStoryManifest({
      ...manifest('user-1', 'story-1'),
      sourceUpdatedAt: 'v2',
      assets: [{ ...firstAsset, version: 'v2' }],
    });

    const resolved = await adapter.resolveMedia({ ...firstAsset, version: 'v2' });
    expect(resolved.cacheHit).toBe(false);
  });

  it('removes old stories using the LRU limit', async () => {
    const adapter = new WebStoryPersistenceAdapter();
    await adapter.saveStoryManifest(manifest('user-1', 'old', '2026-01-01T00:00:00.000Z'));
    await adapter.saveStoryManifest(manifest('user-1', 'new', '2026-06-15T00:00:00.000Z'));
    await adapter.cleanup({ userId: 'user-1', maxStories: 1, maxAgeDays: 365 });

    expect(await adapter.getStoryManifest({ readerKind: 'story', userId: 'user-1', storyId: 'old' })).toBeNull();
    expect(await adapter.getStoryManifest({ readerKind: 'story', userId: 'user-1', storyId: 'new' })).not.toBeNull();
  });

  it('clears manifests and progress when a user signs out or switches accounts', async () => {
    const adapter = new WebStoryPersistenceAdapter();
    await adapter.saveStoryManifest(manifest('user-1', 'story-1'));
    await adapter.saveProgress({
      readerKind: 'story',
      userId: 'user-1',
      storyId: 'story-1',
      currentNodeId: 'beat-2',
      audioTimeMs: 1200,
      completed: false,
      updatedAt: new Date().toISOString(),
    });

    await adapter.clearUser('user-1');

    expect(await adapter.getStoryManifest({ readerKind: 'story', userId: 'user-1', storyId: 'story-1' })).toBeNull();
    expect(await adapter.getProgress({ readerKind: 'story', userId: 'user-1', storyId: 'story-1' })).toBeNull();
  });

  it('falls back to the authenticated remote URL when media caching fails', async () => {
    const adapter = new WebStoryPersistenceAdapter();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    const resolved = await adapter.resolveMedia(asset());

    expect(resolved.source).toBe('remote');
    expect(resolved.cacheHit).toBe(false);
    expect(resolved.url).toBe(asset().remoteUrl);
  });

  it('removes stories older than the configured retention period', async () => {
    const adapter = new WebStoryPersistenceAdapter();
    await adapter.saveStoryManifest(manifest('user-1', 'expired', '2025-01-01T00:00:00.000Z'));
    await adapter.saveStoryManifest(manifest('user-1', 'current', new Date().toISOString()));

    await adapter.cleanup({ userId: 'user-1', maxStories: 10, maxAgeDays: 30 });

    expect(await adapter.getStoryManifest({ readerKind: 'story', userId: 'user-1', storyId: 'expired' })).toBeNull();
    expect(await adapter.getStoryManifest({ readerKind: 'story', userId: 'user-1', storyId: 'current' })).not.toBeNull();
  });
});
