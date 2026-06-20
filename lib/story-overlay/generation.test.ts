import { describe, expect, it } from 'vitest';

import {
  getStoryTextOverlayGenerationEligibility,
  hasStoryTextOverlayTimedAlignment,
} from './generation';

describe('story overlay generation', () => {
  it('requires a storyboard beat with image, audio, and text', () => {
    expect(getStoryTextOverlayGenerationEligibility({
      isStoryboard: false,
      imageUrl: 'image.png',
      audioUrl: 'audio.mp3',
      storyText: 'Once upon a time',
    })).toMatchObject({ eligible: false, reason: 'not_storyboard' });

    expect(getStoryTextOverlayGenerationEligibility({
      isStoryboard: true,
      audioUrl: 'audio.mp3',
      storyText: 'Once upon a time',
    })).toMatchObject({ eligible: false, reason: 'missing_image' });

    expect(getStoryTextOverlayGenerationEligibility({
      isStoryboard: true,
      imageUrl: 'image.png',
      storyText: 'Once upon a time',
    })).toMatchObject({ eligible: false, reason: 'missing_audio' });

    expect(getStoryTextOverlayGenerationEligibility({
      isStoryboard: true,
      imageUrl: 'image.png',
      audioUrl: 'audio.mp3',
      storyText: '   ',
    })).toMatchObject({ eligible: false, reason: 'missing_text' });

    expect(getStoryTextOverlayGenerationEligibility({
      isStoryboard: true,
      imageUrl: 'image.png',
      audioUrl: 'audio.mp3',
      storyText: 'Once upon a time',
    })).toEqual({ eligible: true });
  });

  it('detects beats that already have timed word alignment', () => {
    expect(hasStoryTextOverlayTimedAlignment({
      storyTextOverlayAlignment: {
        version: 1,
        provider: 'elevenlabs',
        source: 'elevenlabs_forced_alignment',
        textHighlightSupported: true,
        alignedWordCount: 1,
        createdAt: '2026-06-19T00:00:00.000Z',
      },
      storyTextOverlayCaptions: [
        {
          panelIndex: 0,
          text: 'Hello',
          wordTimings: [{ word: 'Hello', startMs: 0, endMs: 250 }],
        },
      ],
    })).toBe(true);

    expect(hasStoryTextOverlayTimedAlignment({
      storyTextOverlayAlignment: {
        version: 1,
        provider: 'elevenlabs',
        source: 'none',
        textHighlightSupported: false,
        alignedWordCount: 0,
        createdAt: '2026-06-19T00:00:00.000Z',
      },
      storyTextOverlayCaptions: [{ panelIndex: 0, text: 'Hello' }],
    })).toBe(false);
  });
});
