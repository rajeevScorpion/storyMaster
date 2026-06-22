import { describe, expect, it } from 'vitest';
import { getStoryTransitionFlashOpacity, getStoryTransitionLayerStyle } from './render';

describe('story transition render helpers', () => {
  it('reveals directional and organic transitions deterministically', () => {
    expect(getStoryTransitionLayerStyle({ type: 'directional-wipe', durationMs: 600, direction: 'right' }, 0.5, 'to').clipPath).toContain('inset');
    expect(getStoryTransitionLayerStyle({ type: 'ink-reveal', durationMs: 900 }, 0.5, 'to').clipPath).toContain('polygon');
    expect(getStoryTransitionLayerStyle({ type: 'smoke-reveal', durationMs: 900 }, 0.5, 'to').clipPath).toContain('circle');
  });

  it('peaks flash opacity at the midpoint', () => {
    const settings = { type: 'soft-light-flash', durationMs: 500, intensity: 80 };
    expect(getStoryTransitionFlashOpacity(settings, 0.5)).toBeGreaterThan(getStoryTransitionFlashOpacity(settings, 0.1));
  });
});

