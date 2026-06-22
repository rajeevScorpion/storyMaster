import { describe, expect, it } from 'vitest';

import { normalizeStoryTransitionSettings } from './settings';

describe('story transition settings', () => {
  it('defaults existing stories to fast cut', () => {
    expect(normalizeStoryTransitionSettings(null)).toEqual({ type: 'fast-cut', durationMs: 0 });
  });

  it('clamps non-cut durations and forces cut to zero', () => {
    expect(normalizeStoryTransitionSettings({ type: 'soft-fade', durationMs: 10 })).toEqual({
      type: 'soft-fade',
      durationMs: 100,
    });
    expect(normalizeStoryTransitionSettings({ type: 'opacity-blend', durationMs: 5000 })).toEqual({
      type: 'opacity-blend',
      durationMs: 2000,
    });
    expect(normalizeStoryTransitionSettings({ type: 'fast-cut', durationMs: 900 })).toEqual({
      type: 'fast-cut',
      durationMs: 0,
    });
  });
});
