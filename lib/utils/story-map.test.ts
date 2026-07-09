import { describe, expect, it } from 'vitest';
import {
  addChildNode,
  collectNamedCharactersForNode,
  createStoryMap,
  getDescendantNodeIds,
  hasActiveDescendants,
  isBeatLockedForStoryEdit,
  removeSubtree,
} from './story-map';
import type { Character, StoryBeat, StoryMap } from '../types/story';

function makeBeat(beatNumber: number, characters: Character[] = []): StoryBeat {
  return {
    title: `Beat ${beatNumber}`,
    beatNumber,
    isEnding: false,
    storyText: `Story text ${beatNumber}`,
    sceneSummary: `Scene ${beatNumber}`,
    options: [
      { id: `opt-${beatNumber}-a`, label: 'Go left', intent: 'explore' },
      { id: `opt-${beatNumber}-b`, label: 'Go right', intent: 'risk' },
    ],
    characters,
    continuityNotes: [],
    imagePrompt: '',
    clues: [],
    nextBeatGoal: '',
    endingForecast: [],
  };
}

function makeCharacter(name: string): Character {
  return {
    id: `char-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    type: 'protagonist',
    appearanceSummary: `${name} appearance`,
    personalitySummary: `${name} personality`,
  };
}

/**
 * Builds: root -> a -> b -> c (linear chain) plus a sibling branch root -> d.
 */
function buildBranchedMap(): { map: StoryMap; ids: Record<string, string> } {
  let map = createStoryMap(makeBeat(1, [makeCharacter('Milo')]), 'root');
  map = addChildNode(map, 'root', 'opt-1-a', makeBeat(2, [makeCharacter('Tara')]), 'a');
  map = addChildNode(map, 'a', 'opt-2-a', makeBeat(3), 'b');
  map = addChildNode(map, 'b', 'opt-3-a', makeBeat(4), 'c');
  map = addChildNode(map, 'root', 'opt-1-b', makeBeat(2, [makeCharacter('Captain Barnaby')]), 'd');
  return { map, ids: { root: 'root', a: 'a', b: 'b', c: 'c', d: 'd' } };
}

describe('getDescendantNodeIds', () => {
  it('returns every node below the root across branches', () => {
    const { map } = buildBranchedMap();
    expect(new Set(getDescendantNodeIds(map, 'root'))).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('returns the chain below a mid node without siblings', () => {
    const { map } = buildBranchedMap();
    expect(getDescendantNodeIds(map, 'a')).toEqual(['b', 'c']);
  });

  it('returns empty for a leaf', () => {
    const { map } = buildBranchedMap();
    expect(getDescendantNodeIds(map, 'c')).toEqual([]);
  });

  it('returns empty for an unknown node', () => {
    const { map } = buildBranchedMap();
    expect(getDescendantNodeIds(map, 'nope')).toEqual([]);
  });
});

describe('timeline lock', () => {
  it('locks nodes with descendants and not leaves', () => {
    const { map } = buildBranchedMap();
    expect(isBeatLockedForStoryEdit(map, 'root')).toBe(true);
    expect(hasActiveDescendants(map, 'b')).toBe(true);
    expect(isBeatLockedForStoryEdit(map, 'c')).toBe(false);
    expect(isBeatLockedForStoryEdit(map, 'd')).toBe(false);
  });
});

describe('removeSubtree', () => {
  it('removes descendants, clears children, repoints currentNodeId', () => {
    const { map } = buildBranchedMap();
    const pruned = removeSubtree(map, 'a');
    expect(Object.keys(pruned.nodes).sort()).toEqual(['a', 'd', 'root']);
    expect(pruned.nodes['a'].children).toEqual([]);
    expect(pruned.currentNodeId).toBe('a');
    // The sibling branch under root is untouched.
    expect(pruned.nodes['root'].children).toContain('d');
  });

  it('does not mutate the input map', () => {
    const { map } = buildBranchedMap();
    const before = JSON.stringify(map);
    removeSubtree(map, 'root');
    expect(JSON.stringify(map)).toBe(before);
  });

  it('returns the map unchanged shape for a leaf (only current pointer moves)', () => {
    const { map } = buildBranchedMap();
    const pruned = removeSubtree(map, 'c');
    expect(Object.keys(pruned.nodes).sort()).toEqual(['a', 'b', 'c', 'd', 'root']);
    expect(pruned.currentNodeId).toBe('c');
  });
});

describe('collectNamedCharactersForNode', () => {
  it('unions characters along the path, deduplicated by name', () => {
    const { map } = buildBranchedMap();
    const names = collectNamedCharactersForNode(map, 'c').map((c) => c.name);
    expect(names).toEqual(['Milo', 'Tara']);
  });

  it('does not include characters from sibling branches', () => {
    const { map } = buildBranchedMap();
    const names = collectNamedCharactersForNode(map, 'd').map((c) => c.name);
    expect(names).toEqual(['Milo', 'Captain Barnaby']);
  });

  it('later appearances win the dedupe', () => {
    let map = createStoryMap(makeBeat(1, [makeCharacter('Milo')]), 'root');
    const updatedMilo = { ...makeCharacter('milo'), appearanceSummary: 'older Milo' };
    map = addChildNode(map, 'root', 'opt-1-a', makeBeat(2, [updatedMilo]), 'a');
    const characters = collectNamedCharactersForNode(map, 'a');
    expect(characters).toHaveLength(1);
    expect(characters[0].appearanceSummary).toBe('older Milo');
  });
});
