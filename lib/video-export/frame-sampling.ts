export interface ConstantRateFrameSample {
  timeMs: number;
  durationMs: number;
}

/**
 * Deterministic constant-frame-rate sampling: frame k sits exactly at
 * k * (1000 / fps) ms, so encoded timestamps are strictly monotonic, free of
 * duplicates, and match the frame-rate metadata declared on the video track.
 * The final frame's duration is clamped so the encoded duration equals the
 * timeline duration.
 */
export function buildConstantRateFrameSamples(
  totalDurationMs: number,
  fps: number
): ConstantRateFrameSample[] {
  const safeFps = Math.max(1, fps);
  const frameMs = 1000 / safeFps;
  const totalMs = Math.max(frameMs, totalDurationMs);
  const frameCount = Math.max(1, Math.ceil((totalMs / 1000) * safeFps));
  const samples: ConstantRateFrameSample[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const timeMs = index * frameMs;
    const durationMs = Math.min(frameMs, totalMs - timeMs);
    if (durationMs <= 0) break;
    samples.push({ timeMs, durationMs });
  }
  return samples;
}
