import { describe, expect, it } from 'vitest';
import { scaleSizesForCrop } from './StoryboardThumbnail';

describe('scaleSizesForCrop', () => {
  it('scales a bare length by 2.12 so the optimizer sources the 2x crop box', () => {
    expect(scaleSizesForCrop('320px')).toBe('678.4px');
    expect(scaleSizesForCrop('100vw')).toBe('212vw');
  });

  it('rounds away binary-float noise', () => {
    // 640 * 2.12 is 1356.8000000000002 in IEEE 754, which used to be emitted
    // verbatim into the sizes attribute.
    expect(scaleSizesForCrop('640px')).toBe('1356.8px');
  });

  it('leaves media-condition breakpoints untouched', () => {
    // Scaling the breakpoint too made the wrong branch match on mid-size
    // screens and overshot the source into the next bucket.
    expect(scaleSizesForCrop('(max-width: 768px) 100vw, 960px'))
      .toBe('(max-width: 768px) 212vw, 2035.2px');
  });

  it('handles a multi-entry list', () => {
    expect(scaleSizesForCrop('(max-width: 640px) 260px, (max-width: 1280px) 300px, 340px'))
      .toBe('(max-width: 640px) 551.2px, (max-width: 1280px) 636px, 720.8px');
  });

  it('normalises spacing between entries', () => {
    expect(scaleSizesForCrop('(max-width: 640px) 100px,200px')).toBe('(max-width: 640px) 212px, 424px');
  });

  it('keeps the desktop hero request inside the 2048 source bucket', () => {
    const desktop = scaleSizesForCrop('(max-width: 768px) 100vw, 960px').split(', ').pop() ?? '';
    expect(parseFloat(desktop)).toBeLessThanOrEqual(2048);
  });

  it('passes through a value it cannot parse rather than mangling it', () => {
    expect(scaleSizesForCrop('auto')).toBe('auto');
  });
});
