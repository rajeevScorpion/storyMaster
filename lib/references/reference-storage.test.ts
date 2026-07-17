import { describe, it, expect } from 'vitest';
import {
  ACCEPTED_REFERENCE_MIME_TYPES,
  REFERENCE_STORAGE_PREFIX,
  buildCanonicalReferenceKey,
  buildReferenceSourceKey,
  checksumSha256,
  decodeReferenceUpload,
  isReferenceKind,
  referenceMimeExtension,
} from './reference-storage';

// 1x1 transparent PNG
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('reference-storage key builders', () => {
  it('builds a private source key under the references prefix with a mime extension', () => {
    const key = buildReferenceSourceKey({
      userId: 'u1',
      setupId: 's1',
      sourceId: 'src1',
      mimeType: 'image/png',
    });
    expect(key).toBe(`${REFERENCE_STORAGE_PREFIX}/u1/s1/src_src1.png`);
  });

  it('defaults unknown mime to webp', () => {
    expect(referenceMimeExtension('image/gif')).toBe('webp');
  });

  it('builds a canonical key under a stories/ prefix (so signed URLs round-trip) always as webp', () => {
    const key = buildCanonicalReferenceKey({ userId: 'u1', setupId: 's1', adoptionId: 'a1' });
    expect(key).toBe(`stories/${REFERENCE_STORAGE_PREFIX}/u1/s1/adopt_a1_canonical.webp`);
  });

  it('exposes the accepted mime allowlist', () => {
    expect(ACCEPTED_REFERENCE_MIME_TYPES).toContain('image/webp');
    expect(ACCEPTED_REFERENCE_MIME_TYPES).toContain('image/jpeg');
    expect(ACCEPTED_REFERENCE_MIME_TYPES).toContain('image/png');
  });
});

describe('checksumSha256', () => {
  it('is stable and content-addressed', () => {
    const a = checksumSha256(Buffer.from('hello'));
    const b = checksumSha256(Buffer.from('hello'));
    const c = checksumSha256(Buffer.from('world'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });
});

describe('decodeReferenceUpload', () => {
  it('decodes a valid png and reports bytes + checksum', () => {
    const result = decodeReferenceUpload({ dataUrl: PNG_1x1, maxBytes: 1_000_000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mimeType).toBe('image/png');
      expect(result.value.bytes).toBeGreaterThan(0);
      expect(result.value.checksum).toHaveLength(64);
    }
  });

  it('rejects a non-data-url', () => {
    const result = decodeReferenceUpload({ dataUrl: 'not-a-data-url', maxBytes: 1_000_000 });
    expect(result).toEqual({ ok: false, error: 'invalid_data_url' });
  });

  it('rejects an unsupported mime type', () => {
    const result = decodeReferenceUpload({
      dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=',
      maxBytes: 1_000_000,
    });
    expect(result).toEqual({ ok: false, error: 'unsupported_mime' });
  });

  it('rejects an oversized payload', () => {
    const result = decodeReferenceUpload({ dataUrl: PNG_1x1, maxBytes: 4 });
    expect(result).toEqual({ ok: false, error: 'too_large' });
  });
});

describe('isReferenceKind', () => {
  it('accepts character and world only', () => {
    expect(isReferenceKind('character')).toBe(true);
    expect(isReferenceKind('world')).toBe(true);
    expect(isReferenceKind('scene')).toBe(false);
    expect(isReferenceKind(null)).toBe(false);
  });
});
