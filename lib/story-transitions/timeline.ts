import {
  normalizeStoryTransitionSettings,
  type StoryTransitionSettings,
} from './settings';

export interface StoryTransitionWindow {
  boundaryIndex: number;
  fromIndex: number;
  toIndex: number;
  narrationTimeMs: number;
  startMs: number;
  endMs: number;
}

export interface StoryTransitionTimeline {
  narrationBoundariesMs: number[];
  visualBoundariesMs: number[];
  narrationDurationMs: number;
  totalDurationMs: number;
  transitionSettings: StoryTransitionSettings;
  transitions: StoryTransitionWindow[];
}

export interface StoryTransitionClockState {
  visualTimeMs: number;
  narrationTimeMs: number;
  activeIndex: number;
  transition: (StoryTransitionWindow & { progress: number }) | null;
}

function normalizeBoundaries(values: readonly number[]): number[] {
  const normalized = values
    .map(Number)
    .filter(Number.isFinite)
    .map((value) => Math.max(0, Math.round(value)))
    .sort((left, right) => left - right);
  const unique = normalized.filter((value, index) => index === 0 || value > normalized[index - 1]);
  if (unique.length === 0 || unique[0] !== 0) unique.unshift(0);
  return unique.length >= 2 ? unique : [0, Math.max(1, unique[0] ?? 0) + 1];
}

export function buildStoryTransitionTimeline(
  narrationBoundariesMs: readonly number[],
  settingsInput: unknown
): StoryTransitionTimeline {
  const boundaries = normalizeBoundaries(narrationBoundariesMs);
  const transitionSettings = normalizeStoryTransitionSettings(settingsInput);
  const transitionDurationMs = transitionSettings.durationMs;
  const transitions: StoryTransitionWindow[] = [];
  const visualBoundariesMs = [0];
  let insertedMs = 0;

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const narrationEndMs = boundaries[index + 1];
    const visualEndMs = narrationEndMs + insertedMs;
    visualBoundariesMs.push(visualEndMs);
    if (index >= boundaries.length - 2 || transitionDurationMs <= 0) continue;
    transitions.push({
      boundaryIndex: index,
      fromIndex: index,
      toIndex: index + 1,
      narrationTimeMs: narrationEndMs,
      startMs: visualEndMs,
      endMs: visualEndMs + transitionDurationMs,
    });
    insertedMs += transitionDurationMs;
  }

  const narrationDurationMs = boundaries[boundaries.length - 1];
  return {
    narrationBoundariesMs: boundaries,
    visualBoundariesMs,
    narrationDurationMs,
    totalDurationMs: narrationDurationMs + insertedMs,
    transitionSettings,
    transitions,
  };
}

export function getStoryTransitionClockState(
  timeline: StoryTransitionTimeline,
  visualTimeMs: number
): StoryTransitionClockState {
  const visualTime = Math.max(0, Math.min(visualTimeMs, timeline.totalDurationMs));
  const transition = timeline.transitions.find((window) => (
    visualTime >= window.startMs && visualTime < window.endMs
  ));
  if (transition) {
    return {
      visualTimeMs: visualTime,
      narrationTimeMs: transition.narrationTimeMs,
      activeIndex: transition.fromIndex,
      transition: {
        ...transition,
        progress: (visualTime - transition.startMs) / Math.max(1, transition.endMs - transition.startMs),
      },
    };
  }

  let insertedMs = 0;
  let activeIndex = 0;
  for (const window of timeline.transitions) {
    if (visualTime >= window.endMs) {
      insertedMs += window.endMs - window.startMs;
      activeIndex = window.toIndex;
    }
  }
  const narrationTimeMs = Math.max(
    0,
    Math.min(timeline.narrationDurationMs, visualTime - insertedMs)
  );
  for (let index = 0; index < timeline.narrationBoundariesMs.length - 1; index += 1) {
    if (narrationTimeMs < timeline.narrationBoundariesMs[index + 1]) {
      activeIndex = index;
      break;
    }
  }

  return {
    visualTimeMs: visualTime,
    narrationTimeMs,
    activeIndex,
    transition: null,
  };
}

export function narrationTimeToStoryVisualTime(
  timeline: StoryTransitionTimeline,
  narrationTimeMs: number
): number {
  const narrationTime = Math.max(0, Math.min(narrationTimeMs, timeline.narrationDurationMs));
  const insertedMs = timeline.transitions.reduce((sum, window) => (
    narrationTime >= window.narrationTimeMs
      ? sum + window.endMs - window.startMs
      : sum
  ), 0);
  return Math.min(timeline.totalDurationMs, narrationTime + insertedMs);
}
