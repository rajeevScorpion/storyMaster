import { describe, it, expect } from 'vitest';
import {
  synthesizeDirectPortraitTasks,
  collectDirectCharacterRefs,
  selectDirectWorldReference,
} from './direct-routing';
import type { Character, PortraitTask } from '@/lib/types/story';
import type {
  StoryConfigCharacterReference,
  StoryConfigWorldReference,
} from '@/lib/types/references';

function char(id: string, name: string, overrides: Partial<Character> = {}): Character {
  return { id, name, type: 'main', appearanceSummary: '', personalitySummary: '', ...overrides };
}

const CONFIG_A: StoryConfigCharacterReference = {
  sourceId: 'a',
  characterId: 'ref_a',
  name: 'Malik',
  description: 'a young inventor',
  storageKey: 'r2://bucket/src_a.webp',
};

describe('synthesizeDirectPortraitTasks', () => {
  it('adds a new_character task for a direct ref present in the beat cast', () => {
    const tasks = synthesizeDirectPortraitTasks([], [CONFIG_A], [char('ref_a', 'Malik')]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].characterId).toBe('ref_a');
    expect(tasks[0].reason).toBe('new_character');
    expect(tasks[0].prompt).toContain('Malik');
    expect(tasks[0].prompt).toContain('young inventor');
  });

  it('keys the task on the beat character id when the LLM re-minted the id', () => {
    // Seeded id ref_a, but the beat character carries id 'c1' with the same name.
    const tasks = synthesizeDirectPortraitTasks([], [CONFIG_A], [char('c1', 'Malik')]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].characterId).toBe('c1');
  });

  it('does not duplicate a task the composer already emitted (by id)', () => {
    const existing: PortraitTask[] = [
      { characterId: 'ref_a', characterName: 'Malik', reason: 'new_character', prompt: 'x' },
    ];
    const tasks = synthesizeDirectPortraitTasks(existing, [CONFIG_A], [char('ref_a', 'Malik')]);
    expect(tasks).toHaveLength(1);
  });

  it('does not duplicate by name', () => {
    const existing: PortraitTask[] = [
      { characterId: 'other', characterName: 'Malik', reason: 'new_character', prompt: 'x' },
    ];
    const tasks = synthesizeDirectPortraitTasks(existing, [CONFIG_A], [char('ref_a', 'Malik')]);
    expect(tasks).toHaveLength(1);
  });

  it('skips a ref that is not in the beat cast', () => {
    const tasks = synthesizeDirectPortraitTasks([], [CONFIG_A], [char('someone', 'Priya')]);
    expect(tasks).toHaveLength(0);
  });

  it('returns the same array reference when nothing is added', () => {
    const existing: PortraitTask[] = [];
    expect(synthesizeDirectPortraitTasks(existing, undefined, [])).toBe(existing);
  });
});

describe('collectDirectCharacterRefs', () => {
  it('maps beat character id to its raw reference image', () => {
    const map = collectDirectCharacterRefs([CONFIG_A], [char('ref_a', 'Malik')]);
    const ref = map.get('ref_a');
    expect(ref).toBeDefined();
    expect(ref?.type).toBe('character');
    expect(ref?.storageKey).toBe('r2://bucket/src_a.webp');
    expect(ref?.name).toBe('Malik');
  });

  it('keys by beat id even when it differs from the seeded id', () => {
    const map = collectDirectCharacterRefs([CONFIG_A], [char('c1', 'Malik')]);
    expect(map.has('c1')).toBe(true);
    expect(map.has('ref_a')).toBe(false);
  });

  it('is empty when there are no config characters', () => {
    expect(collectDirectCharacterRefs(undefined, [char('x', 'Y')]).size).toBe(0);
  });
});

describe('selectDirectWorldReference', () => {
  const world = (overrides: Partial<StoryConfigWorldReference>): StoryConfigWorldReference => ({
    sourceId: 'w',
    worldId: 'w',
    label: 'Alley',
    anchor: '',
    keywords: [],
    adoptionMode: 'description_only',
    ...overrides,
  });

  it('returns null with no worlds', () => {
    expect(selectDirectWorldReference([], 'text', null)).toBeNull();
    expect(selectDirectWorldReference(undefined, 'text', null)).toBeNull();
  });

  it('returns a scene ref from the source key', () => {
    const ref = selectDirectWorldReference(
      [world({ sourceStorageKey: 'r2://bucket/src_w.webp' })],
      'a scene in the alley',
      null
    );
    expect(ref?.type).toBe('scene');
    expect(ref?.storageKey).toBe('r2://bucket/src_w.webp');
    expect(ref?.name).toBe('Alley');
  });

  it('returns null when the selected world has no image key', () => {
    expect(selectDirectWorldReference([world({})], 'text', null)).toBeNull();
  });

  it('prefers the source key over a canonical key', () => {
    const ref = selectDirectWorldReference(
      [world({ sourceStorageKey: 'r2://bucket/src_w.webp', canonicalStorageKey: 'r2://bucket/canon.webp' })],
      'text',
      null
    );
    expect(ref?.storageKey).toBe('r2://bucket/src_w.webp');
  });
});
