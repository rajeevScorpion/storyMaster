import { describe, expect, it } from 'vitest';

import {
  buildStoryTextOverlayCaptions,
  getActiveStoryOverlayLineIndex,
  getActiveStoryOverlayWordIndex,
  groupStoryOverlayWords,
  normalizeStoryTextOverlayCaptions,
  normalizeStoryTextOverlayWordsPerLine,
} from './captions';

describe('story overlay captions', () => {
  it('clamps admin words-per-line setting', () => {
    expect(normalizeStoryTextOverlayWordsPerLine(1)).toBe(2);
    expect(normalizeStoryTextOverlayWordsPerLine(99)).toBe(12);
    expect(normalizeStoryTextOverlayWordsPerLine('8')).toBe(8);
    expect(normalizeStoryTextOverlayWordsPerLine('nope')).toBe(7);
  });

  it('groups words by the normalized line size', () => {
    expect(groupStoryOverlayWords(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
  });

  it('builds four panel captions from story text parts', () => {
    const captions = buildStoryTextOverlayCaptions({
      storyText: 'fallback story text',
      storyTextParts: ['one', 'two', 'three', 'four'],
    });

    expect(captions).toHaveLength(4);
    expect(captions.map((caption) => caption.text)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('finds active word and line from timings', () => {
    const timings = [
      { word: 'one', startMs: 0, endMs: 300 },
      { word: 'two', startMs: 300, endMs: 600 },
      { word: 'three', startMs: 600, endMs: 900 },
    ];

    expect(getActiveStoryOverlayWordIndex(timings, 650)).toBe(2);
    expect(getActiveStoryOverlayLineIndex(timings, 650, 2)).toBe(1);
  });

  it('normalizes persisted captions defensively', () => {
    const captions = normalizeStoryTextOverlayCaptions([
      {
        panel_index: 0,
        text: ' Hello   world ',
        word_timings: [
          { word: 'Hello', start_ms: 10.2, end_ms: 100.6 },
          { word: '', start_ms: 100, end_ms: 120 },
        ],
      },
      { panel_index: 8, text: 'ignored' },
    ]);

    expect(captions).toEqual([
      {
        panelIndex: 0,
        text: 'Hello world',
        wordTimings: [{ word: 'Hello', startMs: 10, endMs: 101 }],
      },
    ]);
  });
});
