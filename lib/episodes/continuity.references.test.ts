import { describe, it, expect } from 'vitest';
import { buildEpisodeConfig } from './continuity';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import type { StoryConfigReferences } from '@/lib/types/references';

const references: StoryConfigReferences = {
  setupId: 'setup-123',
  worlds: [
    {
      adoptionId: 'a1',
      worldId: 'world_a1',
      label: 'Ancient Library',
      anchor: 'a dusty library with a carved archway',
      keywords: ['library', 'archway'],
      adoptionMode: 'description_plus_canonical_visual',
      canonicalStorageKey: 'r2://private-bucket/references/u1/setup-123/adopt_a1_canonical.webp',
    },
  ],
};

describe('buildEpisodeConfig — reference personalization carry', () => {
  it('carries world references into the episode config', () => {
    const parent = normalizeStoryConfig({ references });
    const episode = buildEpisodeConfig(parent);
    expect(episode.references?.worlds).toHaveLength(1);
    expect(episode.references?.worlds[0].worldId).toBe('world_a1');
    expect(episode.references?.worlds[0].adoptionMode).toBe('description_plus_canonical_visual');
  });

  it('carries only canonical (adopted) keys — never a raw source key', () => {
    const parent = normalizeStoryConfig({ references });
    const episode = buildEpisodeConfig(parent);
    const serialized = JSON.stringify(episode.references);
    expect(serialized).not.toContain('src_');
    expect(episode.references?.worlds[0].canonicalStorageKey).toContain('adopt_');
  });

  it('resets authoring to a fresh prompt while keeping references', () => {
    const parent = normalizeStoryConfig({ references, authoring: { mode: 'seeded', sourceText: 'x' } as never });
    const episode = buildEpisodeConfig(parent);
    expect(episode.authoring.mode).toBe('prompt');
    expect(episode.references?.setupId).toBe('setup-123');
  });
});
