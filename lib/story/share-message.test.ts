import { describe, expect, it } from 'vitest';

import { getFirstBeatShareExcerpt } from './share-message';

describe('getFirstBeatShareExcerpt', () => {
  it('uses the first beat storyTextParts as four share lines', () => {
    const excerpt = getFirstBeatShareExcerpt([
      {
        storyText: 'One two three four.',
        storyTextParts: ['Line one.', 'Line two.', 'Line three.', 'Line four.'],
      },
      {
        storyText: 'This beat should not be used.',
      },
    ]);

    expect(excerpt).toBe('Line one.\nLine two.\nLine three.\nLine four.\nread more...');
  });

  it('falls back to splitting storyText when storyTextParts are missing', () => {
    const excerpt = getFirstBeatShareExcerpt([
      {
        storyText: 'First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.',
      },
    ]);

    expect(excerpt).toBe('First sentence.\nSecond sentence.\nThird sentence.\nFourth sentence.\nread more...');
  });
});

