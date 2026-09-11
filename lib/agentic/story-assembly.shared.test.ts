import { describe, expect, it } from 'vitest';
import type { StoryBeat, StoryNode, SeedPlan } from '@/lib/types/story';
import {
  NOVELTY_AVOID_LIST_MAX_ENTRIES,
  SeededStoryMapError,
  buildSeededStoryMap,
  getSeedBeatByIndex,
  mergeNoveltyAvoidTitles,
  nextBeatIndexToGenerate,
} from './story-assembly.shared';

function beat(beatNumber: number, overrides: Partial<StoryBeat> = {}): StoryBeat {
  return {
    title: `Beat ${beatNumber}`,
    beatNumber,
    isEnding: false,
    storyText: 'text',
    sceneSummary: 'summary',
    options: [
      { id: `b${beatNumber}-opt-a`, label: 'A', intent: 'a' },
      { id: `b${beatNumber}-opt-b`, label: 'B', intent: 'b' },
    ],
    characters: [],
    continuityNotes: [],
    imagePrompt: 'prompt',
    clues: [],
    nextBeatGoal: 'goal',
    endingForecast: [],
    canonicalOptionId: `b${beatNumber}-opt-a`,
    ...overrides,
  };
}

describe('buildSeededStoryMap', () => {
  it('links a three-beat canonical chain parent to child', () => {
    const map = buildSeededStoryMap([beat(1), beat(2), beat(3)]);

    const root = map.nodes[map.rootNodeId];
    expect(root.parentId).toBeNull();
    expect(root.selectedOptionId).toBeNull();
    expect(root.beatNumber).toBe(1);
    expect(root.children).toHaveLength(1);

    const second = map.nodes[root.children[0]];
    expect(second.beatNumber).toBe(2);
    expect(second.parentId).toBe(root.id);
    // The link records the PARENT's canonical option, not the child's.
    expect(second.selectedOptionId).toBe('b1-opt-a');

    const third = map.nodes[second.children[0]];
    expect(third.beatNumber).toBe(3);
    expect(third.parentId).toBe(second.id);
    expect(third.selectedOptionId).toBe('b2-opt-a');
    expect(third.children).toEqual([]);
  });

  it('points currentNodeId at the last beat and rootNodeId at the first', () => {
    const map = buildSeededStoryMap([beat(1), beat(2), beat(3)]);

    expect(map.nodes[map.rootNodeId].beatNumber).toBe(1);
    expect(map.nodes[map.currentNodeId].beatNumber).toBe(3);
    expect(Object.keys(map.nodes)).toHaveLength(3);
  });

  it('produces a single unbroken path walkable root to tip', () => {
    const map = buildSeededStoryMap([beat(1), beat(2), beat(3), beat(4)]);

    const walked: number[] = [];
    let cursor: string | null = map.rootNodeId;
    while (cursor) {
      const node: StoryNode = map.nodes[cursor];
      walked.push(node.beatNumber);
      cursor = node.children[0] ?? null;
    }

    expect(walked).toEqual([1, 2, 3, 4]);
  });

  it('builds a single-beat map with no children', () => {
    const map = buildSeededStoryMap([beat(1, { isEnding: true, canonicalOptionId: undefined })]);

    expect(map.rootNodeId).toBe(map.currentNodeId);
    expect(map.nodes[map.rootNodeId].children).toEqual([]);
  });

  it('throws rather than guessing when a non-ending parent has no canonical option', () => {
    expect(() => buildSeededStoryMap([beat(1, { canonicalOptionId: undefined }), beat(2)]))
      .toThrow(SeededStoryMapError);
    expect(() => buildSeededStoryMap([beat(1, { canonicalOptionId: undefined }), beat(2)]))
      .toThrow(/no canonical option/i);
  });

  it('names the inconsistency when an ending beat is followed by more beats', () => {
    const beats = [beat(1, { isEnding: true, canonicalOptionId: undefined }), beat(2), beat(3)];
    expect(() => buildSeededStoryMap(beats)).toThrow(/marked as an ending but 2 beat\(s\) follow/i);
  });

  it('rejects an empty beat list', () => {
    expect(() => buildSeededStoryMap([])).toThrow(SeededStoryMapError);
  });
});

describe('getSeedBeatByIndex', () => {
  const plan: SeedPlan = {
    beatCount: 2,
    beats: [
      { beatIndex: 1, title: 'One', storyText: 't', sceneSummary: 's', isEnding: false, options: [] },
      { beatIndex: 2, title: 'Two', storyText: 't', sceneSummary: 's', isEnding: true, options: [] },
    ],
  };

  it('finds by beatIndex rather than array position', () => {
    expect(getSeedBeatByIndex(plan, 2)?.title).toBe('Two');
  });

  it('returns undefined for an uncovered index or an absent plan', () => {
    expect(getSeedBeatByIndex(plan, 3)).toBeUndefined();
    expect(getSeedBeatByIndex(undefined, 1)).toBeUndefined();
  });
});

describe('nextBeatIndexToGenerate', () => {
  it('starts at beat 1 with no saved progress', () => {
    expect(nextBeatIndexToGenerate(undefined, 6)).toBe(1);
    expect(nextBeatIndexToGenerate({}, 6)).toBe(1);
  });

  it('resumes after the beats already paid for', () => {
    const progress = { completedBeats: [beat(1), beat(2), beat(3), beat(4)] };
    expect(nextBeatIndexToGenerate(progress, 8)).toBe(5);
  });

  it('reports completion once every planned beat is done', () => {
    const progress = { completedBeats: [beat(1), beat(2)] };
    expect(nextBeatIndexToGenerate(progress, 2)).toBeUndefined();
  });
});

describe('mergeNoveltyAvoidTitles', () => {
  it('accumulates across attempts rather than replacing', () => {
    const afterAttemptOne = mergeNoveltyAvoidTitles([], ['Rejected Title One', 'Colliding Prior A']);
    const afterAttemptTwo = mergeNoveltyAvoidTitles(afterAttemptOne, ['Rejected Title Two', 'Colliding Prior B']);
    expect(afterAttemptTwo).toEqual(
      expect.arrayContaining(['Rejected Title One', 'Colliding Prior A', 'Rejected Title Two', 'Colliding Prior B'])
    );
  });

  it('dedupes case-insensitively', () => {
    const result = mergeNoveltyAvoidTitles(['The Clockwork Sparrow'], ['the clockwork sparrow', 'A New Title']);
    expect(result.filter((title) => title.toLowerCase() === 'the clockwork sparrow')).toHaveLength(1);
    expect(result).toContain('A New Title');
  });

  it('filters out blank/whitespace-only titles', () => {
    expect(mergeNoveltyAvoidTitles([], ['   ', '', 'Real Title'])).toEqual(['Real Title']);
  });

  it('caps the accumulated list, keeping the freshest additions over the oldest entries', () => {
    const existing = Array.from({ length: NOVELTY_AVOID_LIST_MAX_ENTRIES }, (_unused, i) => `Existing ${i}`);
    const result = mergeNoveltyAvoidTitles(existing, ['Freshest Addition']);
    expect(result).toHaveLength(NOVELTY_AVOID_LIST_MAX_ENTRIES);
    expect(result[0]).toBe('Freshest Addition');
    expect(result).not.toContain(`Existing ${NOVELTY_AVOID_LIST_MAX_ENTRIES - 1}`);
  });

  it('never grows past the cap regardless of how many additions arrive at once', () => {
    const additions = Array.from({ length: 20 }, (_unused, i) => `Title ${i}`);
    expect(mergeNoveltyAvoidTitles([], additions)).toHaveLength(NOVELTY_AVOID_LIST_MAX_ENTRIES);
  });
});
