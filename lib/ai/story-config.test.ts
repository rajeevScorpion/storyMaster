import { describe, expect, it } from 'vitest';
import { DEFAULT_STORY_CONFIG, normalizeStoryConfig } from './story-config';

describe('story config normalization', () => {
  it('uses Strictly Follow as the default source fidelity', () => {
    expect(DEFAULT_STORY_CONFIG.authoring.sourceFidelity).toBe('strictly_follow');
    expect(normalizeStoryConfig({
      authoring: {
        mode: 'seeded',
        sourceText: 'An authored story stays intact.',
      },
    }).authoring.sourceFidelity).toBe('strictly_follow');
  });

  it('preserves every supported source fidelity mode', () => {
    for (const sourceFidelity of [
      'strictly_follow',
      'preserve_closely',
      'balanced_adaptation',
      'creative_expansion',
    ] as const) {
      expect(normalizeStoryConfig({
        authoring: {
          mode: 'seeded',
          sourceText: 'Source text',
          sourceFidelity,
        },
      }).authoring.sourceFidelity).toBe(sourceFidelity);
    }
  });

  it('preserves generated image mode', () => {
    const config = normalizeStoryConfig({
      imageGenerationMode: 'generate',
    });

    expect(config.imageGenerationMode).toBe('generate');
  });

  it('preserves prompt-only image mode', () => {
    const config = normalizeStoryConfig({
      imageGenerationMode: 'prompt_only',
    });

    expect(config.imageGenerationMode).toBe('prompt_only');
  });

  it('falls back to the default image mode for unknown values', () => {
    const config = normalizeStoryConfig({
      imageGenerationMode: 'unknown',
    } as unknown as Parameters<typeof normalizeStoryConfig>[0]);

    expect(config.imageGenerationMode).toBe(DEFAULT_STORY_CONFIG.imageGenerationMode);
  });

  it('normalizes image continuity strategy', () => {
    const config = normalizeStoryConfig({
      imageContinuityStrategy: 'provider_stateful',
    });

    expect(config.imageContinuityStrategy).toBe('provider_stateful');
    expect(normalizeStoryConfig({
      imageContinuityStrategy: 'bad-value',
    } as unknown as Parameters<typeof normalizeStoryConfig>[0]).imageContinuityStrategy)
      .toBe(DEFAULT_STORY_CONFIG.imageContinuityStrategy);
  });
});

describe('story config references normalization', () => {
  type ConfigInput = Parameters<typeof normalizeStoryConfig>[0];

  it('drops references without a setupId', () => {
    const config = normalizeStoryConfig({
      references: { worlds: [] },
    } as unknown as ConfigInput);
    expect(config.references).toBeUndefined();
  });

  it('keeps a v1 adoption world (adoptionId-keyed)', () => {
    const config = normalizeStoryConfig({
      references: {
        setupId: 'setup-1',
        worlds: [
          {
            adoptionId: 'adopt-1',
            worldId: 'world-1',
            label: 'The Orchard',
            anchor: 'a glowing orchard',
            keywords: ['orchard', 'lanterns'],
            adoptionMode: 'description_plus_canonical_visual',
            canonicalStorageKey: 'r2://bucket/world.webp',
          },
        ],
      },
    } as unknown as ConfigInput);
    expect(config.references?.worlds).toHaveLength(1);
    expect(config.references?.worlds[0].adoptionId).toBe('adopt-1');
    expect(config.references?.worlds[0].sourceId).toBeUndefined();
    expect(config.references?.worlds[0].canonicalStorageKey).toBe('r2://bucket/world.webp');
  });

  it('keeps a v2 direct world (sourceId-keyed, no adoptionId)', () => {
    const config = normalizeStoryConfig({
      references: {
        setupId: 'setup-2',
        worlds: [
          {
            sourceId: 'src-1',
            worldId: 'src-1',
            label: 'Rainy Alley',
            anchor: 'a neon rainy alley',
            keywords: ['alley', 'neon'],
            adoptionMode: 'description_only',
            sourceStorageKey: 'r2://bucket/src_1.webp',
          },
        ],
      },
    } as unknown as ConfigInput);
    expect(config.references?.worlds).toHaveLength(1);
    expect(config.references?.worlds[0].sourceId).toBe('src-1');
    expect(config.references?.worlds[0].sourceStorageKey).toBe('r2://bucket/src_1.webp');
  });

  it('drops worlds missing both adoptionId and sourceId', () => {
    const config = normalizeStoryConfig({
      references: {
        setupId: 'setup-3',
        worlds: [{ worldId: 'world-x', label: 'X' }],
      },
    } as unknown as ConfigInput);
    expect(config.references?.worlds).toHaveLength(0);
  });

  it('keeps valid v2 direct characters and drops malformed ones', () => {
    const config = normalizeStoryConfig({
      references: {
        setupId: 'setup-4',
        worlds: [],
        characters: [
          {
            sourceId: 'src-a',
            characterId: 'ref_src-a',
            name: 'Malik',
            description: 'a young inventor',
            storageKey: 'r2://bucket/src_a.webp',
          },
          // malformed: no storageKey -> dropped
          { sourceId: 'src-b', characterId: 'ref_src-b', name: 'Nobody' },
        ],
      },
    } as unknown as ConfigInput);
    expect(config.references?.characters).toHaveLength(1);
    expect(config.references?.characters?.[0].characterId).toBe('ref_src-a');
    expect(config.references?.characters?.[0].storageKey).toBe('r2://bucket/src_a.webp');
  });

  it('omits the characters key entirely when none are valid', () => {
    const config = normalizeStoryConfig({
      references: { setupId: 'setup-5', worlds: [], characters: [] },
    } as unknown as ConfigInput);
    expect(config.references?.setupId).toBe('setup-5');
    expect(config.references?.characters).toBeUndefined();
  });
});
