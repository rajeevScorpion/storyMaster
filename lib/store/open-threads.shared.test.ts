import { describe, expect, it } from 'vitest';
import { deriveOpenThreads } from './open-threads.shared';
import type { StoryBeat } from '@/lib/types/story';

function beat(overrides: Partial<StoryBeat> & Pick<StoryBeat, 'nextBeatGoal'>): StoryBeat {
  return {
    title: 'Beat',
    beatNumber: 1,
    isEnding: false,
    storyText: '',
    sceneSummary: '',
    options: [],
    characters: [],
    continuityNotes: [],
    imagePrompt: '',
    clues: [],
    endingForecast: [],
    ...overrides,
  };
}

describe('deriveOpenThreads (Unit 5 Q3)', () => {
  it('returns nextBeatGoal only -- continuityNotes are never re-injected', () => {
    const beats = [
      beat({ nextBeatGoal: 'Find the missing map.', continuityNotes: ['yellow hair clips', 'blue jacket'] }),
      beat({ nextBeatGoal: 'Cross the river before nightfall.', continuityNotes: ['red boots'] }),
    ];
    const threads = deriveOpenThreads(beats);
    expect(threads).toEqual(['Find the missing map.', 'Cross the river before nightfall.']);
    expect(threads.join(' ')).not.toContain('yellow hair clips');
    expect(threads.join(' ')).not.toContain('blue jacket');
    expect(threads.join(' ')).not.toContain('red boots');
  });

  it('excludes ending beats', () => {
    const beats = [
      beat({ nextBeatGoal: 'Open thread.' }),
      beat({ nextBeatGoal: 'The end.', isEnding: true }),
    ];
    expect(deriveOpenThreads(beats)).toEqual(['Open thread.']);
  });

  it('drops blank goals and dedupes, keeping only the last 6', () => {
    const beats = Array.from({ length: 8 }, (_, i) => beat({ nextBeatGoal: `Goal ${i}` }));
    beats.push(beat({ nextBeatGoal: '   ' }));
    beats.push(beat({ nextBeatGoal: 'Goal 7' })); // duplicate of an existing goal
    const threads = deriveOpenThreads(beats);
    expect(threads).toHaveLength(6);
    expect(threads).toEqual(['Goal 2', 'Goal 3', 'Goal 4', 'Goal 5', 'Goal 6', 'Goal 7']);
  });
});
