import { describe, it, expect } from 'vitest';
import { buildSeedCharacters, resolveSeedCharacterName, type SeedCharacterInput } from './seed';

describe('resolveSeedCharacterName', () => {
  it('uses a provided name', () => {
    const taken = new Set<string>();
    expect(resolveSeedCharacterName('Leo', taken)).toBe('Leo');
  });

  it('dedupes colliding provided names', () => {
    const taken = new Set<string>();
    expect(resolveSeedCharacterName('Leo', taken)).toBe('Leo');
    expect(resolveSeedCharacterName('Leo', taken)).toBe('Leo 2');
    expect(resolveSeedCharacterName('leo', taken)).toBe('leo 3'); // case-insensitive collision
  });

  it('auto-names unnamed entries with the lowest free index', () => {
    const taken = new Set<string>();
    expect(resolveSeedCharacterName(null, taken)).toBe('Character 1');
    expect(resolveSeedCharacterName('', taken)).toBe('Character 2');
  });
});

describe('buildSeedCharacters', () => {
  const inputs: SeedCharacterInput[] = [
    {
      adoptionId: 'a1',
      displayName: 'Leo',
      anchor: 'A curious boy. hair: messy brown',
      canonicalSignedUrl: 'https://acct.r2.cloudflarestorage.com/private-bucket/stories/references/u1/s1/adopt_a1_canonical.webp?sig=1',
      canonicalReference: 'r2://private-bucket/stories/references/u1/s1/adopt_a1_canonical.webp',
      completedAt: '2026-07-14T00:00:00Z',
    },
    {
      adoptionId: 'a2',
      displayName: null,
      anchor: 'A small dragon',
      canonicalSignedUrl: 'https://acct.r2.cloudflarestorage.com/private-bucket/stories/references/u1/s1/adopt_a2_canonical.webp?sig=2',
      canonicalReference: 'r2://private-bucket/stories/references/u1/s1/adopt_a2_canonical.webp',
    },
  ];

  it('maps adoptions to roster characters with stable ids and anchors', () => {
    const characters = buildSeedCharacters(inputs);
    expect(characters[0].id).toBe('ref_a1');
    expect(characters[0].name).toBe('Leo');
    expect(characters[0].appearanceSummary).toContain('curious boy');
    expect(characters[1].name).toBe('Character 1');
  });

  it('emits a signed canonical URL + durable r2 key, never a source key', () => {
    const characters = buildSeedCharacters(inputs);
    for (const character of characters) {
      // referenceSheetUrl is a client-fetchable signed URL for the canonical asset.
      expect(character.referenceSheetUrl).toMatch(/^https:\/\/.+adopt_.+_canonical\.webp/);
      // referenceSheetStorageKey is the durable r2:// reference to the same asset.
      expect(character.referenceSheetStorageKey).toMatch(/^r2:\/\/.+adopt_.+_canonical\.webp$/);
      // No source-style key ("src_") must ever leak into a seeded character.
      expect(JSON.stringify(character)).not.toContain('src_');
    }
  });

  it('leaves personality for the story LLM to develop', () => {
    const characters = buildSeedCharacters(inputs);
    expect(characters[0].personalitySummary).toBe('');
  });
});
