export interface ExportFrameSampleLike {
  timeMs: number;
  durationMs: number;
}

export interface ExportFrameSampleSummary {
  frameCount: number;
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
  encodedDurationMs: number;
  minFrameDurationMs: number | null;
  maxFrameDurationMs: number | null;
  averageFrameDurationMs: number | null;
  duplicateTimestampCount: number;
  nonMonotonicTimestampCount: number;
}

export interface VideoExportReport extends ExportFrameSampleSummary {
  exportKind: 'story' | 'reel';
  engine: 'fast' | 'compatibility';
  presetId: string;
  presetLabel: string;
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  expectedDurationMs: number;
  videoCodec: string;
  audioCodec: string;
  videoBitrate: number | string;
  audioBitrate: number | string;
  audioSampleRate: number;
  audioChannels: number;
  keyFrameIntervalSeconds: number;
  container: 'mp4';
  fastStart: string;
  fragmented: boolean;
  outputBytes: number | null;
  stageDurationsMs: Record<string, number>;
  exportWallTimeMs: number;
  userAgent: string;
  startedAtIso: string;
}

export function summarizeExportFrameSamples(samples: ExportFrameSampleLike[]): ExportFrameSampleSummary {
  let duplicateTimestampCount = 0;
  let nonMonotonicTimestampCount = 0;
  let minFrameDurationMs: number | null = null;
  let maxFrameDurationMs: number | null = null;
  let encodedDurationMs = 0;

  samples.forEach((sample, index) => {
    encodedDurationMs += sample.durationMs;
    if (minFrameDurationMs === null || sample.durationMs < minFrameDurationMs) minFrameDurationMs = sample.durationMs;
    if (maxFrameDurationMs === null || sample.durationMs > maxFrameDurationMs) maxFrameDurationMs = sample.durationMs;
    if (index > 0) {
      const previous = samples[index - 1];
      if (sample.timeMs === previous.timeMs) duplicateTimestampCount += 1;
      else if (sample.timeMs < previous.timeMs) nonMonotonicTimestampCount += 1;
    }
  });

  return {
    frameCount: samples.length,
    firstTimestampMs: samples.length > 0 ? samples[0].timeMs : null,
    lastTimestampMs: samples.length > 0 ? samples[samples.length - 1].timeMs : null,
    encodedDurationMs,
    minFrameDurationMs,
    maxFrameDurationMs,
    averageFrameDurationMs: samples.length > 0 ? encodedDurationMs / samples.length : null,
    duplicateTimestampCount,
    nonMonotonicTimestampCount,
  };
}

export interface VideoExportReportInput {
  exportKind: 'story' | 'reel';
  engine: 'fast' | 'compatibility';
  presetId?: string;
  presetLabel?: string;
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  expectedDurationMs: number;
  samples: ExportFrameSampleLike[];
  videoCodec: string;
  audioCodec: string;
  videoBitrate: number | string;
  audioBitrate: number | string;
  audioSampleRate: number;
  audioChannels: number;
  keyFrameIntervalSeconds: number;
  fastStart: string;
  fragmented?: boolean;
  outputBytes: number | null;
  stageDurationsMs: Record<string, number>;
  exportWallTimeMs: number;
  startedAtIso: string;
}

export function buildVideoExportReport(input: VideoExportReportInput): VideoExportReport {
  const { samples, ...rest } = input;
  return {
    ...rest,
    ...summarizeExportFrameSamples(samples),
    presetId: input.presetId ?? 'default',
    presetLabel: input.presetLabel ?? 'Default',
    container: 'mp4',
    fragmented: input.fragmented === true,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  };
}

export function logVideoExportReport(report: VideoExportReport): void {
  if (process.env.NODE_ENV === 'production') return;
  const expectedFrameCount = Math.ceil((report.expectedDurationMs / 1000) * report.fps);
  console.info(`[video-export:${report.exportKind}] export report`, {
    ...report,
    expectedFrameCount,
    frameCountMatchesFps: Math.abs(report.frameCount - expectedFrameCount) <= 1,
    durationDriftMs: Math.round(report.encodedDurationMs - report.expectedDurationMs),
  });
  if (report.duplicateTimestampCount > 0 || report.nonMonotonicTimestampCount > 0) {
    console.warn(
      `[video-export:${report.exportKind}] timestamp problems detected`,
      {
        duplicateTimestampCount: report.duplicateTimestampCount,
        nonMonotonicTimestampCount: report.nonMonotonicTimestampCount,
      }
    );
  }
}

export function createStageTimer() {
  const stageDurationsMs: Record<string, number> = {};
  const startedAt = performance.now();
  let stageStartedAt = startedAt;
  return {
    startedAtIso: new Date().toISOString(),
    mark(stage: string) {
      const now = performance.now();
      stageDurationsMs[stage] = Math.round(now - stageStartedAt);
      stageStartedAt = now;
    },
    finish() {
      return {
        stageDurationsMs,
        exportWallTimeMs: Math.round(performance.now() - startedAt),
      };
    },
  };
}
