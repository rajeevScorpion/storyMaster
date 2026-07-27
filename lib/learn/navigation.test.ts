import { describe, expect, it } from 'vitest';

import { LEARN_CHAPTERS, LEARN_SLIDES } from './content';
import {
  clampLearnSlideIndex,
  findLearnSlideIndex,
  getLearnSlideHash,
} from './navigation';

describe('learn navigation', () => {
  it('resolves numbered, named, and chapter hashes', () => {
    expect(findLearnSlideIndex('#slide-08', LEARN_SLIDES, LEARN_CHAPTERS)).toBe(7);
    expect(findLearnSlideIndex('#meaning-needs-direction', LEARN_SLIDES, LEARN_CHAPTERS)).toBe(3);
    expect(findLearnSlideIndex('#platform', LEARN_SLIDES, LEARN_CHAPTERS)).toBe(12);
    expect(findLearnSlideIndex('#partner', LEARN_SLIDES, LEARN_CHAPTERS)).toBe(17);
  });

  it('falls back safely for invalid hashes', () => {
    expect(findLearnSlideIndex('#slide-99', LEARN_SLIDES, LEARN_CHAPTERS)).toBe(0);
    expect(findLearnSlideIndex('#not-a-slide', LEARN_SLIDES, LEARN_CHAPTERS)).toBe(0);
  });

  it('uses stable zero-padded hashes and clamps indexes', () => {
    expect(getLearnSlideHash(LEARN_SLIDES[0])).toBe('#slide-01');
    expect(getLearnSlideHash(LEARN_SLIDES[19])).toBe('#slide-20');
    expect(clampLearnSlideIndex(-2, LEARN_SLIDES.length)).toBe(0);
    expect(clampLearnSlideIndex(28, LEARN_SLIDES.length)).toBe(19);
  });
});
