import { describe, it, expect } from 'vitest';
import { selectRelevantWorld, buildWorldAnchorSummaries } from './reference-routing';
import type { StoryConfigWorldReference } from '@/lib/types/references';

function world(id: string, label: string, keywords: string[], anchor = 'anchor'): StoryConfigWorldReference {
  return { adoptionId: id, worldId: id, label, anchor, keywords, adoptionMode: 'description_only' };
}

describe('selectRelevantWorld', () => {
  it('returns null when there are no worlds', () => {
    expect(selectRelevantWorld([], 'anything', null)).toBeNull();
  });

  it('always returns the single world', () => {
    const w = world('w1', 'Ancient Library', ['library']);
    expect(selectRelevantWorld([w], 'a beach at sunset', null)).toBe(w);
  });

  it('keyword-matches the beat among multiple worlds', () => {
    const library = world('w1', 'Ancient Library', ['library', 'archway']);
    const harbor = world('w2', 'Stormy Harbor', ['harbor', 'docks']);
    const selected = selectRelevantWorld([library, harbor], 'They ran along the docks in the rain', null);
    expect(selected?.worldId).toBe('w2');
  });

  it('is sticky to the last world when nothing matches', () => {
    const library = world('w1', 'Ancient Library', ['library']);
    const harbor = world('w2', 'Stormy Harbor', ['harbor']);
    const selected = selectRelevantWorld([library, harbor], 'a quiet neutral scene', 'w2');
    expect(selected?.worldId).toBe('w2');
  });

  it('defaults to the first world when nothing matches and no sticky', () => {
    const library = world('w1', 'Ancient Library', ['library']);
    const harbor = world('w2', 'Stormy Harbor', ['harbor']);
    const selected = selectRelevantWorld([library, harbor], 'a quiet neutral scene', null);
    expect(selected?.worldId).toBe('w1');
  });

  it('ignores very short match terms', () => {
    const a = world('w1', 'AB', ['xy']); // both < 3 chars, never match
    const b = world('w2', 'Meadow', ['meadow']);
    const selected = selectRelevantWorld([a, b], 'a walk in the meadow', null);
    expect(selected?.worldId).toBe('w2');
  });
});

describe('buildWorldAnchorSummaries', () => {
  it('maps worlds to label/anchor pairs and skips empty anchors', () => {
    const worlds = [world('w1', 'Library', ['library'], 'a dusty library'), world('w2', 'Void', ['void'], '   ')];
    expect(buildWorldAnchorSummaries(worlds)).toEqual([{ label: 'Library', anchor: 'a dusty library' }]);
  });

  it('handles null/empty', () => {
    expect(buildWorldAnchorSummaries(null)).toEqual([]);
    expect(buildWorldAnchorSummaries([])).toEqual([]);
  });
});
