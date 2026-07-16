import { describe, it, expect } from 'vitest';
import { buildDirectSeed, deriveWorldKeywords, type DirectSeedInput } from './direct-seed';

const RAW_KEY_A = 'r2://private-bucket/references/u1/s1/src_a.webp';
const RAW_KEY_B = 'r2://private-bucket/references/u1/s1/src_b.webp';
const RAW_WORLD = 'r2://private-bucket/references/u1/s1/src_w.webp';

describe('buildDirectSeed', () => {
  const inputs: DirectSeedInput[] = [
    { sourceId: 'a', kind: 'character', displayName: 'Leo', description: 'a curious boy', storageKey: RAW_KEY_A },
    { sourceId: 'b', kind: 'character', displayName: null, description: null, storageKey: RAW_KEY_B },
    { sourceId: 'w', kind: 'world', displayName: 'Rainy Alley', description: 'neon-lit puddles', storageKey: RAW_WORLD },
  ];

  it('seeds characters with stable ids and resolved names', () => {
    const { seedCharacters } = buildDirectSeed(inputs);
    expect(seedCharacters).toHaveLength(2);
    expect(seedCharacters[0].id).toBe('ref_a');
    expect(seedCharacters[0].name).toBe('Leo');
    expect(seedCharacters[0].appearanceSummary).toBe('a curious boy');
    // Unnamed -> placeholder name + flag so the LLM may rename on beat 1.
    expect(seedCharacters[1].name).toBe('Character 1');
    expect(seedCharacters[1].nameIsPlaceholder).toBe(true);
    expect(seedCharacters[0].nameIsPlaceholder).toBeUndefined();
  });

  it('NEVER puts the raw source key on a seeded Character (privacy contract)', () => {
    const { seedCharacters } = buildDirectSeed(inputs);
    for (const character of seedCharacters) {
      const json = JSON.stringify(character);
      expect(json).not.toContain('src_');
      expect(json).not.toContain('r2://');
      expect(character.referenceSheetUrl).toBeUndefined();
      expect(character.referenceSheetStorageKey).toBeUndefined();
      expect(character.portraitUrl).toBeUndefined();
    }
  });

  it('carries the raw key in config references, matching the seeded character id/name', () => {
    const { seedCharacters, references } = buildDirectSeed(inputs);
    // Two character inputs -> two config refs; the world input is separate.
    expect(references.characters).toHaveLength(2);
    const ref = references.characters[0];
    expect(ref.characterId).toBe(seedCharacters[0].id);
    expect(ref.name).toBe(seedCharacters[0].name);
    expect(ref.storageKey).toBe(RAW_KEY_A);
  });

  it('emits a config ref for every character including unnamed ones', () => {
    const { references } = buildDirectSeed(inputs);
    // Both character inputs produce a config character reference.
    expect(references.characters.map((c) => c.characterId).sort()).toEqual(['ref_a', 'ref_b']);
  });

  it('builds world references with sticky keys and derived keywords', () => {
    const { references } = buildDirectSeed(inputs);
    expect(references.worlds).toHaveLength(1);
    const world = references.worlds[0];
    expect(world.worldId).toBe('w');
    expect(world.sourceId).toBe('w');
    expect(world.label).toBe('Rainy Alley');
    expect(world.anchor).toBe('neon-lit puddles');
    expect(world.sourceStorageKey).toBe(RAW_WORLD);
    expect(world.adoptionMode).toBe('description_only');
    expect(world.keywords).toContain('rainy');
    expect(world.keywords).toContain('alley');
    expect(world.keywords).toContain('neon');
  });

  it('dedupes colliding character names', () => {
    const { seedCharacters } = buildDirectSeed([
      { sourceId: 'a', kind: 'character', displayName: 'Kai', description: null, storageKey: RAW_KEY_A },
      { sourceId: 'b', kind: 'character', displayName: 'Kai', description: null, storageKey: RAW_KEY_B },
    ]);
    expect(seedCharacters[0].name).toBe('Kai');
    expect(seedCharacters[1].name).toBe('Kai 2');
  });

  it('labels unnamed worlds by ordinal', () => {
    const { references } = buildDirectSeed([
      { sourceId: 'w1', kind: 'world', displayName: null, description: null, storageKey: RAW_WORLD },
    ]);
    expect(references.worlds[0].label).toBe('World 1');
  });
});

describe('deriveWorldKeywords', () => {
  it('keeps words of 3+ chars, lowercased and deduped', () => {
    expect(deriveWorldKeywords('The Old Keep', 'a Keep of ICE and of stone')).toEqual([
      'the',
      'old',
      'keep',
      'ice',
      'and',
      'stone',
    ]);
  });

  it('returns empty for short/empty input', () => {
    expect(deriveWorldKeywords('', '')).toEqual([]);
    expect(deriveWorldKeywords('a b', 'to of')).toEqual([]);
  });
});
