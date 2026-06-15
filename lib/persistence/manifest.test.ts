import { describe, expect, it } from 'vitest';
import { migrateCachedStoryManifest } from './manifest';
import { STORY_MANIFEST_SCHEMA_VERSION } from './types';

describe('migrateCachedStoryManifest', () => {
  const valid = {
    schemaVersion: STORY_MANIFEST_SCHEMA_VERSION,
    readerKind: 'story' as const,
    storyId: 'story-1',
    userId: 'user-1',
    title: 'Story',
    sourceUpdatedAt: '2026-06-15T00:00:00.000Z',
    cachedAt: '2026-06-15T00:00:00.000Z',
    lastOpenedAt: '2026-06-15T00:00:00.000Z',
    assets: [],
    payload: { storySessionId: 'story-1' },
  };

  it('accepts the current schema', () => {
    expect(migrateCachedStoryManifest(valid)?.storyId).toBe('story-1');
  });

  it('rejects unsupported future schemas', () => {
    expect(migrateCachedStoryManifest({ ...valid, schemaVersion: 99 })).toBeNull();
  });

  it('rejects base64 media in a manifest', () => {
    expect(migrateCachedStoryManifest({
      ...valid,
      assets: [{ assetId: 'a', remoteUrl: 'data:image/png;base64,abc' }],
    })).toBeNull();
  });
});
