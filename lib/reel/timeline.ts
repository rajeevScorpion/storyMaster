import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import type { ReelPanelCaption, StoryBeat } from '@/lib/types/story';
import { normalizeReelTransitionSettings, type ReelTransitionSettings } from '@/lib/reel/transitions';

export const REEL_FINAL_HOLD_MS = 3000;

export interface ReelTimelineBeatInput {
  beat: StoryBeat;
  imageUrl: string;
  durationMs: number;
}

export interface ReelTimelineScene {
  beatIndex: number;
  panelIndex: number;
  imageUrl: string;
  beatStartMs: number;
  startMs: number;
  endMs: number;
  caption?: ReelPanelCaption;
}

export interface ReelTimeline {
  scenes: ReelTimelineScene[];
  beatDurationsMs: number[];
  narrationDurationMs: number;
  totalDurationMs: number;
  finalHoldMs: number;
  transitionSettings: ReelTransitionSettings;
}

export interface ReelTransitionWindow {
  from: ReelTimelineScene;
  to: ReelTimelineScene;
  startMs: number;
  endMs: number;
  progress: number;
}

export interface ReelFrameSample {
  timeMs: number;
  durationMs: number;
}

function getEffectiveTransitionDurationMs(settings: ReelTransitionSettings): number {
  return Math.max(0, settings.durationMs - settings.pauseMs);
}

function validCaptionStart(caption: ReelPanelCaption | undefined): number | null {
  return caption && typeof caption.startMs === 'number' && Number.isFinite(caption.startMs)
    ? Math.max(0, caption.startMs)
    : null;
}

function buildPanelStarts(beat: StoryBeat, durationMs: number): number[] {
  const usableDurationMs = Math.max(1, durationMs || STORYBOARD_ADVANCE_MS * 4);
  const captions = beat.reelCaptions ?? [];

  // Priority 1: use each panel's last word end time for tight word-driven transitions
  const prevPanelsHaveWordTimings = [0, 1, 2].every((panelIndex) => {
    const caption = captions.find((c) => c.panelIndex === panelIndex);
    return caption?.wordTimings && caption.wordTimings.length > 0;
  });

  if (prevPanelsHaveWordTimings) {
    return [0, 1, 2, 3].map((panelIndex) => {
      if (panelIndex === 0) return 0;
      const prevCaption = captions.find((c) => c.panelIndex === panelIndex - 1)!;
      const lastWord = prevCaption.wordTimings![prevCaption.wordTimings!.length - 1];
      return Math.min(usableDurationMs, Math.max(0, lastWord.endMs));
    });
  }

  // Priority 2: use caption start times
  const allTimed = [1, 2, 3].every((panelIndex) => validCaptionStart(
    captions.find((caption) => caption.panelIndex === panelIndex)
  ) !== null);

  if (allTimed) {
    return [0, 1, 2, 3].map((panelIndex) => {
      if (panelIndex === 0) return 0;
      return Math.min(
        usableDurationMs,
        validCaptionStart(captions.find((caption) => caption.panelIndex === panelIndex)) ?? 0
      );
    });
  }

  return [0, 1, 2, 3].map((panelIndex) => (usableDurationMs * panelIndex) / 4);
}

export function buildReelTimeline(
  beats: ReelTimelineBeatInput[],
  transitionSettingsInput: unknown,
  finalHoldMs = REEL_FINAL_HOLD_MS
): ReelTimeline {
  const transitionSettings = normalizeReelTransitionSettings(transitionSettingsInput);
  const scenes: ReelTimelineScene[] = [];
  const beatDurationsMs: number[] = [];
  let beatStartMs = 0;

  beats.forEach((input, beatIndex) => {
    const durationMs = Math.max(1, input.durationMs || STORYBOARD_ADVANCE_MS * 4);
    const starts = buildPanelStarts(input.beat, durationMs);
    beatDurationsMs.push(durationMs);

    starts.forEach((panelStartMs, panelIndex) => {
      const panelEndMs = panelIndex < 3 ? starts[panelIndex + 1] : durationMs;
      scenes.push({
        beatIndex,
        panelIndex,
        imageUrl: input.imageUrl,
        beatStartMs,
        startMs: beatStartMs + Math.min(panelStartMs, panelEndMs),
        endMs: beatStartMs + Math.max(panelStartMs + 1, panelEndMs),
        caption: input.beat.reelCaptions?.find((caption) => caption.panelIndex === panelIndex),
      });
    });

    beatStartMs += durationMs;
  });

  return {
    scenes,
    beatDurationsMs,
    narrationDurationMs: beatStartMs,
    totalDurationMs: beatStartMs + Math.max(0, finalHoldMs),
    finalHoldMs: Math.max(0, finalHoldMs),
    transitionSettings,
  };
}

export function getReelSceneAtTime(timeline: ReelTimeline, timeMs: number): ReelTimelineScene | undefined {
  if (timeline.scenes.length === 0) return undefined;
  const clampedTimeMs = Math.max(0, Math.min(timeMs, timeline.totalDurationMs));
  if (clampedTimeMs >= timeline.narrationDurationMs) {
    return timeline.scenes[timeline.scenes.length - 1];
  }

  return [...timeline.scenes].reverse().find((scene) => clampedTimeMs >= scene.startMs)
    ?? timeline.scenes[0];
}

export function getReelTransitionAtTime(timeline: ReelTimeline, timeMs: number): ReelTransitionWindow | null {
  if (timeline.transitionSettings.type === 'fast-cut') return null;
  const transitionDurationMs = getEffectiveTransitionDurationMs(timeline.transitionSettings);
  if (transitionDurationMs <= 0) return null;

  for (let index = 0; index < timeline.scenes.length - 1; index += 1) {
    const from = timeline.scenes[index];
    const to = timeline.scenes[index + 1];
    const endMs = to.startMs;
    const startMs = Math.max(from.startMs, endMs - transitionDurationMs);
    if (endMs > startMs && timeMs >= startMs && timeMs < endMs) {
      return {
        from,
        to,
        startMs,
        endMs,
        progress: Math.max(0, Math.min(1, (timeMs - startMs) / (endMs - startMs))),
      };
    }
  }

  return null;
}

export function getActiveReelWordIndex(scene: ReelTimelineScene | undefined, timeMs: number): number | undefined {
  if (!scene?.caption?.wordTimings?.length) return undefined;
  const localBeatTimeMs = timeMs - scene.beatStartMs;
  const index = scene.caption.wordTimings.findIndex((word) => (
    localBeatTimeMs >= word.startMs && localBeatTimeMs < word.endMs
  ));
  return index >= 0 ? index : undefined;
}

export function buildReelFrameSamples(timeline: ReelTimeline, fps: number): ReelFrameSample[] {
  const frameDurationMs = 1000 / Math.max(1, fps);
  const pointSet = new Set<number>([0, timeline.narrationDurationMs, timeline.totalDurationMs]);
  const addPoint = (timeMs: number) => {
    pointSet.add(Math.max(0, Math.min(timeline.totalDurationMs, Math.round(timeMs * 1000) / 1000)));
  };

  timeline.scenes.forEach((scene, index) => {
    addPoint(scene.startMs);
    addPoint(scene.endMs);
    scene.caption?.wordTimings?.forEach((word) => {
      addPoint(scene.beatStartMs + word.startMs);
      addPoint(scene.beatStartMs + word.endMs);
    });

    const transitionDurationMs = getEffectiveTransitionDurationMs(timeline.transitionSettings);
    if (timeline.transitionSettings.type !== 'fast-cut' && transitionDurationMs > 0 && index < timeline.scenes.length - 1) {
      const nextScene = timeline.scenes[index + 1];
      const endMs = nextScene.startMs;
      const startMs = Math.max(scene.startMs, endMs - transitionDurationMs);
      for (let timeMs = startMs; timeMs < endMs; timeMs += frameDurationMs) {
        addPoint(timeMs);
      }
      addPoint(endMs);
    }
  });

  const points = [...pointSet].sort((left, right) => left - right);
  return points.slice(0, -1).map((timeMs, index) => ({
    timeMs,
    durationMs: points[index + 1] - timeMs,
  })).filter((sample) => sample.durationMs > 0);
}
