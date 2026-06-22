import { describe, expect, it } from 'vitest';

import {
  buildStoryTransitionTimeline,
  getStoryTransitionClockState,
  narrationTimeToStoryVisualTime,
} from './timeline';

describe('story transition timeline', () => {
  it('inserts transition windows while freezing narration time', () => {
    const timeline = buildStoryTransitionTimeline([0, 1000, 2000, 3000], {
      type: 'opacity-blend',
      durationMs: 500,
    });

    expect(timeline.totalDurationMs).toBe(4000);
    expect(timeline.transitions).toHaveLength(2);
    expect(getStoryTransitionClockState(timeline, 1250)).toMatchObject({
      narrationTimeMs: 1000,
      activeIndex: 0,
      transition: { progress: 0.5 },
    });
    expect(getStoryTransitionClockState(timeline, 1750)).toMatchObject({
      narrationTimeMs: 1250,
      activeIndex: 1,
      transition: null,
    });
  });

  it('maps narration seeks after inserted transitions', () => {
    const timeline = buildStoryTransitionTimeline([0, 1000, 2000], {
      type: 'fade-black',
      durationMs: 600,
    });

    expect(narrationTimeToStoryVisualTime(timeline, 500)).toBe(500);
    expect(narrationTimeToStoryVisualTime(timeline, 1500)).toBe(2100);
  });

  it('keeps fast-cut duration equal to narration duration', () => {
    const timeline = buildStoryTransitionTimeline([0, 1000, 2000], null);
    expect(timeline.transitions).toHaveLength(0);
    expect(timeline.totalDurationMs).toBe(2000);
  });
});
