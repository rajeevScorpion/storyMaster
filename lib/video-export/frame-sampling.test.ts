import { describe, expect, it } from 'vitest';

import { buildConstantRateFrameSamples } from './frame-sampling';

describe('buildConstantRateFrameSamples', () => {
  it('generates monotonic 30fps timestamps covering the full duration', () => {
    const samples = buildConstantRateFrameSamples(10_000, 30);

    expect(samples).toHaveLength(300);
    expect(samples[0].timeMs).toBe(0);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].timeMs).toBeGreaterThan(samples[index - 1].timeMs);
      expect(samples[index].timeMs - samples[index - 1].timeMs).toBeCloseTo(1000 / 30, 6);
    }
    const encodedMs = samples.reduce((sum, sample) => sum + sample.durationMs, 0);
    expect(encodedMs).toBeCloseTo(10_000, 6);
  });

  it('clamps the final frame duration when the duration is not frame-aligned', () => {
    const samples = buildConstantRateFrameSamples(1_010, 30);

    expect(samples).toHaveLength(Math.ceil(1.01 * 30));
    const last = samples[samples.length - 1];
    expect(last.timeMs + last.durationMs).toBeCloseTo(1_010, 6);
    expect(last.durationMs).toBeGreaterThan(0);
    expect(last.durationMs).toBeLessThanOrEqual(1000 / 30);
  });

  it('produces frame counts proportional to fps', () => {
    expect(buildConstantRateFrameSamples(5_000, 24)).toHaveLength(120);
    expect(buildConstantRateFrameSamples(5_000, 30)).toHaveLength(150);
    expect(buildConstantRateFrameSamples(5_000, 60)).toHaveLength(300);
  });

  it('emits at least one frame for degenerate durations', () => {
    const samples = buildConstantRateFrameSamples(0, 30);
    expect(samples.length).toBeGreaterThanOrEqual(1);
    expect(samples[0].timeMs).toBe(0);
    expect(samples[0].durationMs).toBeGreaterThan(0);
  });
});
