import { describe, expect, it } from 'vitest';

import { normalizeStoryTextOverlayStyle } from './styles';

describe('story overlay styles', () => {
  it('normalizes user-configurable line length and highlight pop scale', () => {
    expect(normalizeStoryTextOverlayStyle({
      wordsPerLine: 1,
      wordHighlightScale: 0.5,
    })).toMatchObject({
      wordsPerLine: 2,
      wordHighlightScale: 1,
    });

    expect(normalizeStoryTextOverlayStyle({
      wordsPerLine: 99,
      wordHighlightScale: 2,
    })).toMatchObject({
      wordsPerLine: 12,
      wordHighlightScale: 1.35,
    });
  });
});
