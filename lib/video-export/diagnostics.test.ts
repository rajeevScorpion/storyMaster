import { describe, expect, it } from 'vitest';

import { summarizeExportFrameSamples } from './diagnostics';

describe('summarizeExportFrameSamples', () => {
  it('reports clean stats for a constant-rate sample list', () => {
    const frameMs = 1000 / 30;
    const samples = Array.from({ length: 90 }, (_, index) => ({
      timeMs: index * frameMs,
      durationMs: frameMs,
    }));
    const summary = summarizeExportFrameSamples(samples);

    expect(summary.frameCount).toBe(90);
    expect(summary.firstTimestampMs).toBe(0);
    expect(summary.lastTimestampMs).toBeCloseTo(89 * frameMs, 6);
    expect(summary.encodedDurationMs).toBeCloseTo(3000, 6);
    expect(summary.minFrameDurationMs).toBeCloseTo(frameMs, 6);
    expect(summary.maxFrameDurationMs).toBeCloseTo(frameMs, 6);
    expect(summary.duplicateTimestampCount).toBe(0);
    expect(summary.nonMonotonicTimestampCount).toBe(0);
  });

  it('flags duplicate and non-monotonic timestamps', () => {
    const summary = summarizeExportFrameSamples([
      { timeMs: 0, durationMs: 100 },
      { timeMs: 100, durationMs: 100 },
      { timeMs: 100, durationMs: 100 },
      { timeMs: 50, durationMs: 100 },
    ]);

    expect(summary.duplicateTimestampCount).toBe(1);
    expect(summary.nonMonotonicTimestampCount).toBe(1);
  });

  it('handles empty sample lists', () => {
    const summary = summarizeExportFrameSamples([]);
    expect(summary.frameCount).toBe(0);
    expect(summary.firstTimestampMs).toBeNull();
    expect(summary.lastTimestampMs).toBeNull();
    expect(summary.encodedDurationMs).toBe(0);
  });
});
