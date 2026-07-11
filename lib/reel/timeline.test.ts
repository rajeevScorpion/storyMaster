import { describe, expect, it } from 'vitest';

import { normalizeReelTransitionSettings } from '@/lib/reel/transitions';
import {
  buildReelCompatibilityFrameSamples,
  buildReelFrameSamples,
  type ReelTimeline,
} from './timeline';

function makeTimeline(): ReelTimeline {
  return {
    scenes: [
      {
        beatIndex: 0,
        panelIndex: 0,
        imageUrl: 'one.jpg',
        beatStartMs: 0,
        startMs: 0,
        endMs: 2000,
        caption: {
          panelIndex: 0,
          text: 'Hello world',
          wordTimings: [
            { word: 'Hello', startMs: 100, endMs: 600 },
            { word: 'world', startMs: 600, endMs: 1100 },
          ],
        },
      },
      {
        beatIndex: 0,
        panelIndex: 1,
        imageUrl: 'one.jpg',
        beatStartMs: 0,
        startMs: 2000,
        endMs: 4000,
      },
    ],
    beatDurationsMs: [4000],
    narrationDurationMs: 4000,
    totalDurationMs: 7000,
    finalHoldMs: 3000,
    transitionSettings: normalizeReelTransitionSettings({ type: 'blend', durationMs: 400, pauseMs: 0 }),
  };
}

describe('buildReelFrameSamples', () => {
  it('emits a strictly monotonic constant 30fps grid across the whole timeline', () => {
    const samples = buildReelFrameSamples(makeTimeline(), 30);

    expect(samples).toHaveLength(210);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].timeMs).toBeGreaterThan(samples[index - 1].timeMs);
      expect(samples[index].timeMs - samples[index - 1].timeMs).toBeCloseTo(1000 / 30, 6);
    }
    const encodedMs = samples.reduce((sum, sample) => sum + sample.durationMs, 0);
    expect(encodedMs).toBeCloseTo(7000, 6);
  });
});

describe('buildReelCompatibilityFrameSamples', () => {
  it('keeps sparse event-boundary sampling for the ffmpeg fallback', () => {
    const timeline = makeTimeline();
    const eventSamples = buildReelCompatibilityFrameSamples(timeline, 30);
    const constantSamples = buildReelFrameSamples(timeline, 30);

    // Far fewer frames than the constant grid — this is what bounds the
    // fallback's wasm memory footprint.
    expect(eventSamples.length).toBeLessThan(constantSamples.length / 2);
    for (let index = 1; index < eventSamples.length; index += 1) {
      expect(eventSamples[index].timeMs).toBeGreaterThan(eventSamples[index - 1].timeMs);
      expect(eventSamples[index - 1].durationMs).toBeGreaterThan(0);
    }
    // Word boundaries must still be represented so captions stay in sync.
    expect(eventSamples.some((sample) => sample.timeMs === 100)).toBe(true);
    expect(eventSamples.some((sample) => sample.timeMs === 600)).toBe(true);
  });
});
