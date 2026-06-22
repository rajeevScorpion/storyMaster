import { describe, expect, it } from 'vitest';

import { normalizeStoryTransitionSettings } from './settings';

describe('story transition settings', () => {
  it('defaults existing stories to fast cut with backward-compatible controls', () => {
    expect(normalizeStoryTransitionSettings(null)).toMatchObject({
      type: 'fast-cut', durationMs: 0, direction: 'left', intensity: 50, easing: 'ease-in-out',
    });
  });

  it('clamps non-cut durations and forces cut to zero', () => {
    expect(normalizeStoryTransitionSettings({ type: 'soft-fade', durationMs: 10 })).toMatchObject({ type: 'soft-fade', durationMs: 100 });
    expect(normalizeStoryTransitionSettings({ type: 'opacity-blend', durationMs: 5000 })).toMatchObject({ type: 'opacity-blend', durationMs: 3000 });
    expect(normalizeStoryTransitionSettings({ type: 'fast-cut', durationMs: 900 })).toMatchObject({ type: 'fast-cut', durationMs: 0 });
  });

  it('normalizes advanced transition controls', () => {
    expect(normalizeStoryTransitionSettings({ type: 'directional-wipe', durationMs: 900, direction: 'up', intensity: 140, easing: 'ease-out' })).toMatchObject({
      type: 'directional-wipe', durationMs: 900, direction: 'up', intensity: 100, easing: 'ease-out',
    });
  });
});
