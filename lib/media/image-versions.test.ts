import { describe, expect, it } from 'vitest';
import {
  appendImageVersion,
  ensureActiveImageInGallery,
  findGalleryEntry,
  nextVersionNumber,
  parseGalleryRows,
  serializeGalleryRows,
  truncatePromptSnapshot,
  BEAT_IMAGE_PROMPT_SNAPSHOT_MAX_CHARS,
} from './image-versions';
import type { BeatImageGalleryEntry } from '@/lib/types/story';

function entry(overrides: Partial<BeatImageGalleryEntry> = {}): BeatImageGalleryEntry {
  return {
    url: 'r2://bucket/key-1',
    storageKey: 'key-1',
    uploadedAt: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('nextVersionNumber', () => {
  it('starts at 1 for an empty gallery', () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber(undefined)).toBe(1);
  });

  it('increments past the max, ignoring legacy entries without numbers', () => {
    expect(
      nextVersionNumber([entry(), entry({ versionNumber: 2 }), entry({ versionNumber: 5 })])
    ).toBe(6);
  });
});

describe('ensureActiveImageInGallery', () => {
  it('backfills the active image as an initial version', () => {
    const result = ensureActiveImageInGallery([], 'r2://bucket/current', '2026-07-09T01:00:00.000Z');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: 'r2://bucket/current',
      mode: 'initial',
      source: 'system',
      versionNumber: 1,
    });
  });

  it('is a no-op when the active image is already present', () => {
    const gallery = [entry({ url: 'r2://bucket/current' })];
    expect(ensureActiveImageInGallery(gallery, 'r2://bucket/current', 'now')).toBe(gallery);
  });

  it('treats signed variants of the same object as the same image', () => {
    const gallery = [entry({ url: 'https://cdn.example.com/key-1?sig=abc' })];
    expect(
      ensureActiveImageInGallery(gallery, 'https://cdn.example.com/key-1?sig=other', 'now')
    ).toBe(gallery);
  });

  it('ignores data URLs and missing images', () => {
    expect(ensureActiveImageInGallery([], null, 'now')).toEqual([]);
    expect(ensureActiveImageInGallery([], 'data:image/png;base64,xyz', 'now')).toEqual([]);
  });
});

describe('appendImageVersion', () => {
  it('appends without eviction below the cap', () => {
    const gallery = [entry({ mode: 'initial', versionNumber: 1 })];
    const next = appendImageVersion(gallery, entry({ mode: 'refine', versionNumber: 2, storageKey: 'key-2' }), 5);
    expect(next).toHaveLength(2);
  });

  it('evicts the oldest version entries beyond the cap', () => {
    const gallery = [
      entry({ mode: 'initial', versionNumber: 1, storageKey: 'v1' }),
      entry({ mode: 'refine', versionNumber: 2, storageKey: 'v2' }),
      entry({ mode: 'refine', versionNumber: 3, storageKey: 'v3' }),
    ];
    const next = appendImageVersion(
      gallery,
      entry({ mode: 'reimagine', versionNumber: 4, storageKey: 'v4' }),
      3
    );
    expect(next.map((e) => e.storageKey)).toEqual(['v2', 'v3', 'v4']);
  });

  it('never evicts upload entries', () => {
    const gallery = [
      entry({ mode: 'upload', versionNumber: 1, storageKey: 'u1', uploadedAt: '2026-01-01T00:00:00Z' }),
      entry({ mode: 'refine', versionNumber: 2, storageKey: 'v2' }),
      entry({ mode: 'refine', versionNumber: 3, storageKey: 'v3' }),
    ];
    const next = appendImageVersion(
      gallery,
      entry({ mode: 'refine', versionNumber: 4, storageKey: 'v4' }),
      2
    );
    expect(next.map((e) => e.storageKey)).toContain('u1');
    expect(next.map((e) => e.storageKey)).not.toContain('v2');
  });

  it('never evicts the active entry', () => {
    const gallery = [
      entry({ mode: 'initial', versionNumber: 1, storageKey: 'v1', url: 'r2://bucket/v1' }),
      entry({ mode: 'refine', versionNumber: 2, storageKey: 'v2', url: 'r2://bucket/v2' }),
    ];
    const next = appendImageVersion(
      gallery,
      entry({ mode: 'refine', versionNumber: 3, storageKey: 'v3', url: 'r2://bucket/v3' }),
      2,
      'r2://bucket/v1'
    );
    expect(next.map((e) => e.storageKey)).toContain('v1');
    expect(next.map((e) => e.storageKey)).not.toContain('v2');
  });

  it('does not count legacy (no-mode) entries against the cap', () => {
    const gallery = [entry({ storageKey: 'legacy-1' }), entry({ storageKey: 'legacy-2' })];
    const next = appendImageVersion(
      gallery,
      entry({ mode: 'refine', versionNumber: 1, storageKey: 'v1' }),
      3
    );
    expect(next).toHaveLength(3);
  });
});

describe('serialize/parse round-trip', () => {
  it('preserves version metadata through snake_case and back', () => {
    const original: BeatImageGalleryEntry = {
      url: 'r2://bucket/key-9',
      storageKey: 'key-9',
      uploadedAt: '2026-07-09T02:00:00.000Z',
      mode: 'reimagine',
      overallSuggestion: 'Make the lighting warmer.',
      panelSuggestions: { topLeft: 'Show Tara surprised', bottomRight: 'Sunset smiles' },
      promptSnapshot: 'Full prompt text',
      source: 'user',
      versionNumber: 7,
    };
    const roundTripped = parseGalleryRows(serializeGalleryRows([original]));
    expect(roundTripped).toEqual([original]);
  });

  it('parses legacy entries without version fields', () => {
    const parsed = parseGalleryRows([
      { url: 'https://x/1.webp', storage_key: 'k', uploaded_at: '2026-01-01T00:00:00Z' },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].mode).toBeUndefined();
  });

  it('drops malformed rows', () => {
    expect(parseGalleryRows([null, {}, { url: '' }, 'nope'])).toEqual([]);
  });

  it('applies the url normalizer during serialization', () => {
    const rows = serializeGalleryRows([entry({ url: 'https://x/1.webp?token=s' })], (url) =>
      url.split('?')[0]
    );
    expect(rows[0].url).toBe('https://x/1.webp');
  });
});

describe('helpers', () => {
  it('findGalleryEntry matches by storage key', () => {
    const gallery = [entry({ storageKey: 'a' }), entry({ storageKey: 'b' })];
    expect(findGalleryEntry(gallery, 'b')?.storageKey).toBe('b');
    expect(findGalleryEntry(gallery, 'zzz')).toBeUndefined();
  });

  it('truncates oversized prompt snapshots', () => {
    const long = 'x'.repeat(BEAT_IMAGE_PROMPT_SNAPSHOT_MAX_CHARS + 100);
    const result = truncatePromptSnapshot(long)!;
    expect(result.length).toBe(BEAT_IMAGE_PROMPT_SNAPSHOT_MAX_CHARS + 1); // + ellipsis
    expect(truncatePromptSnapshot('  ')).toBeUndefined();
  });
});
