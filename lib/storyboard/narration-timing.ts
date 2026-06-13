import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { STORYBOARD_PANEL_COUNT } from '@/lib/storyboard/layout';
import type { StoryboardNarrationTiming } from '@/lib/types/story';

export const STORYBOARD_TIMING_MIN_PANEL_MS = 100;
export const STORYBOARD_TIMING_DURATION_TOLERANCE_MS = 100;

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function buildEqualStoryboardNarrationTiming(
  audioDurationMs: number
): StoryboardNarrationTiming | null {
  if (!positiveFinite(audioDurationMs) || audioDurationMs < STORYBOARD_TIMING_MIN_PANEL_MS * STORYBOARD_PANEL_COUNT) {
    return null;
  }

  const durationMs = Math.round(audioDurationMs);
  return {
    version: 1,
    panelEndTimesMs: [
      Math.round(durationMs / STORYBOARD_PANEL_COUNT),
      Math.round((durationMs * 2) / STORYBOARD_PANEL_COUNT),
      Math.round((durationMs * 3) / STORYBOARD_PANEL_COUNT),
    ],
    audioDurationMs: durationMs,
  };
}

export function normalizeStoryboardNarrationTiming(
  value: unknown,
  currentAudioDurationMs?: number
): StoryboardNarrationTiming | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<StoryboardNarrationTiming>;
  if (candidate.version !== 1 || !Array.isArray(candidate.panelEndTimesMs)) return null;
  if (candidate.panelEndTimesMs.length !== STORYBOARD_PANEL_COUNT - 1) return null;

  const audioDurationMs = Number(candidate.audioDurationMs);
  const boundaries = candidate.panelEndTimesMs.map(Number);
  if (!positiveFinite(audioDurationMs) || boundaries.some((boundary) => !positiveFinite(boundary))) {
    return null;
  }

  const roundedDurationMs = Math.round(audioDurationMs);
  const roundedBoundaries = boundaries.map(Math.round) as [number, number, number];
  const allBoundaries = [0, ...roundedBoundaries, roundedDurationMs];
  for (let index = 1; index < allBoundaries.length; index += 1) {
    if (allBoundaries[index] - allBoundaries[index - 1] < STORYBOARD_TIMING_MIN_PANEL_MS) {
      return null;
    }
  }

  if (
    positiveFinite(currentAudioDurationMs ?? 0)
    && Math.abs(roundedDurationMs - Math.round(currentAudioDurationMs!)) > STORYBOARD_TIMING_DURATION_TOLERANCE_MS
  ) {
    return null;
  }

  return {
    version: 1,
    panelEndTimesMs: roundedBoundaries,
    audioDurationMs: roundedDurationMs,
  };
}

export function getStoryboardPanelBoundariesMs(
  audioDurationMs: number,
  timing?: StoryboardNarrationTiming | null
): [number, number, number, number, number] {
  const normalized = normalizeStoryboardNarrationTiming(timing, audioDurationMs)
    ?? buildEqualStoryboardNarrationTiming(audioDurationMs);
  const durationMs = positiveFinite(audioDurationMs)
    ? Math.round(audioDurationMs)
    : STORYBOARD_ADVANCE_MS * STORYBOARD_PANEL_COUNT;

  if (normalized) return [0, ...normalized.panelEndTimesMs, durationMs];

  return [
    0,
    STORYBOARD_ADVANCE_MS,
    STORYBOARD_ADVANCE_MS * 2,
    STORYBOARD_ADVANCE_MS * 3,
    STORYBOARD_ADVANCE_MS * STORYBOARD_PANEL_COUNT,
  ];
}

export function getStoryboardPanelFromNarrationTiming(
  elapsedMs: number,
  audioDurationMs: number,
  timing?: StoryboardNarrationTiming | null
): number {
  const boundaries = getStoryboardPanelBoundariesMs(audioDurationMs, timing);
  const clampedElapsedMs = Math.max(0, Math.min(elapsedMs, boundaries[4]));
  for (let panelIndex = 0; panelIndex < STORYBOARD_PANEL_COUNT - 1; panelIndex += 1) {
    if (clampedElapsedMs < boundaries[panelIndex + 1]) return panelIndex;
  }
  return STORYBOARD_PANEL_COUNT - 1;
}

export function formatStoryboardTimestamp(valueMs: number): string {
  const totalMs = Math.max(0, Math.round(Number.isFinite(valueMs) ? valueMs : 0));
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

export function parseStoryboardTimestamp(value: string): number | null {
  const trimmed = value.trim();
  const match = /^(\d+):([0-5]?\d)(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const milliseconds = Number((match[3] ?? '').padEnd(3, '0'));
  const result = minutes * 60_000 + seconds * 1000 + milliseconds;
  return Number.isFinite(result) ? result : null;
}
