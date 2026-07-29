import { describe, expect, it } from 'vitest';
import type { StoryBeat } from '@/lib/types/story';
import { getStorylineMediaUrls } from './storyline-preload';

function beat(overrides: Partial<StoryBeat>): StoryBeat {
  return {
    title: 'Beat',
    beatNumber: 1,
    isEnding: false,
    storyText: 'Story',
    sceneSummary: 'Scene',
    options: [],
    characters: [],
    continuityNotes: [],
    imagePrompt: 'Prompt',
    clues: [],
    nextBeatGoal: 'Continue',
    endingForecast: [],
    ...overrides,
  };
}

describe('getStorylineMediaUrls', () => {
  it('collects every playable visual and narration asset once', () => {
    const result = getStorylineMediaUrls([
      beat({
        portraitImageUrl: ' portrait.jpg ',
        imageUrl: 'storyboard.jpg',
        persistedImageUrl: 'persisted.jpg',
        audioUrl: 'one.mp3',
      }),
      beat({
        imageUrl: 'storyboard.jpg',
        audioUrl: 'two.mp3',
      }),
    ]);

    expect(result).toEqual({
      imageUrls: ['portrait.jpg', 'storyboard.jpg', 'persisted.jpg'],
      audioUrls: ['one.mp3', 'two.mp3'],
    });
  });

  it('skips missing and whitespace-only media URLs', () => {
    const result = getStorylineMediaUrls([
      beat({
        portraitImageUrl: ' ',
        imageUrl: undefined,
        persistedImageUrl: '',
        audioUrl: '  ',
      }),
    ]);

    expect(result).toEqual({ imageUrls: [], audioUrls: [] });
  });
});
