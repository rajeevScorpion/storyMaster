import { describe, expect, it } from 'vitest';

import { applyForcedAlignmentToStoryCaptions, buildStoryTextOverlayAlignment } from './alignment';

describe('story overlay forced alignment', () => {
  it('maps forced-alignment words onto story panel captions', () => {
    const result = applyForcedAlignmentToStoryCaptions(
      [
        { panelIndex: 0, text: 'one two' },
        { panelIndex: 1, text: 'three' },
      ],
      {
        loss: 0.12,
        words: [
          { text: 'one', start: 0, end: 0.2 },
          { text: 'two', start: 0.2, end: 0.4 },
          { text: 'three', start: 0.4, end: 0.8 },
        ],
      }
    );

    expect(result.alignment.source).toBe('elevenlabs_forced_alignment');
    expect(result.alignment.textHighlightSupported).toBe(true);
    expect(result.alignment.alignedWordCount).toBe(3);
    expect(result.captions[0].wordTimings).toEqual([
      { word: 'one', startMs: 0, endMs: 200 },
      { word: 'two', startMs: 200, endMs: 400 },
    ]);
    expect(result.captions[1].startMs).toBe(400);
    expect(result.captions[1].endMs).toBe(800);
  });

  it('returns disabled highlight metadata when no words align', () => {
    const result = applyForcedAlignmentToStoryCaptions(
      [{ panelIndex: 0, text: 'one two' }],
      { words: [] }
    );

    expect(result.captions[0].wordTimings).toBeUndefined();
    expect(result.alignment.source).toBe('none');
    expect(result.alignment.textHighlightSupported).toBe(false);
  });

  it('clips alignment errors for persistence', () => {
    const alignment = buildStoryTextOverlayAlignment({
      source: 'none',
      textHighlightSupported: false,
      alignedWordCount: -5,
      error: 'x'.repeat(300),
    });

    expect(alignment.alignedWordCount).toBe(0);
    expect(alignment.error).toHaveLength(240);
  });
});
