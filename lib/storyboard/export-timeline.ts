import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { buildConstantRateFrameSamples } from '@/lib/video-export/frame-sampling';
import { isStoryboardBeat } from '@/lib/storyboard/beat';
import { getStoryboardPanelBoundariesMs } from '@/lib/storyboard/narration-timing';
import {
  buildStoryTransitionTimeline,
  getStoryTransitionClockState,
  narrationTimeToStoryVisualTime,
  type StoryTransitionTimeline,
} from '@/lib/story-transitions/timeline';
import type { StoryTransitionSettings } from '@/lib/story-transitions/settings';
import type { StoryTextOverlayCaption } from '@/lib/story-overlay/types';
import type { StoryBeat } from '@/lib/types/story';
import type { StoryEffectConfig } from '@/lib/story-effects/settings';

export interface StoryExportBeatInput {
  beat: StoryBeat;
  imageUrl: string;
  durationMs: number;
  hasAudio: boolean;
}

export interface StoryExportScene {
  beatIndex: number;
  beatStartMs: number;
  narrationStartMs: number;
  narrationEndMs: number;
  startMs: number;
  endMs: number;
  imageUrl: string;
  isStoryboard: boolean;
  panelIndex: number;
  storyTextOverlayCaption?: StoryTextOverlayCaption;
  storyTextOverlayEnabled: boolean;
  storyTextOverlayMode?: StoryBeat['storyTextOverlayMode'];
  storyTextOverlayStyle?: StoryBeat['storyTextOverlayStyle'];
  storyTextOverlayTextHighlightSupported: boolean;
  storyEffects?: StoryEffectConfig;
  effectSeed: string;
}

export interface StoryExportTimeline {
  scenes: StoryExportScene[];
  beatDurationsMs: number[];
  totalNarrationDurationMs: number;
  totalDurationMs: number;
  transitionTimeline: StoryTransitionTimeline;
}

export interface StoryExportFrameSample {
  timeMs: number;
  durationMs: number;
}

export function buildStoryExportTimeline(
  beats: StoryExportBeatInput[],
  cycleOverride: boolean,
  cycleMs: number,
  storyTransition?: StoryTransitionSettings
): StoryExportTimeline {
  const scenes: StoryExportScene[] = [];
  const beatDurationsMs: number[] = [];
  let beatStartMs = 0;
  const fallbackPanelMs = cycleOverride ? Math.max(100, cycleMs) : STORYBOARD_ADVANCE_MS;

  beats.forEach((input, beatIndex) => {
    const isStoryboard = isStoryboardBeat(input.beat);
    const durationMs = Math.max(1, input.durationMs || (isStoryboard ? fallbackPanelMs * 4 : fallbackPanelMs));
    const boundaries = isStoryboard
      ? input.hasAudio
        ? getStoryboardPanelBoundariesMs(durationMs, input.beat.storyboardNarrationTiming)
        : [0, fallbackPanelMs, fallbackPanelMs * 2, fallbackPanelMs * 3, fallbackPanelMs * 4]
      : [0, durationMs];
    const panelCount = isStoryboard ? 4 : 1;

    for (let panelIndex = 0; panelIndex < panelCount; panelIndex += 1) {
      scenes.push({
        beatIndex,
        beatStartMs,
        narrationStartMs: beatStartMs + boundaries[panelIndex],
        narrationEndMs: beatStartMs + boundaries[panelIndex + 1],
        startMs: 0,
        endMs: 0,
        imageUrl: input.imageUrl,
        isStoryboard,
        panelIndex,
        storyTextOverlayCaption: isStoryboard
          ? input.beat.storyTextOverlayCaptions?.find((caption) => caption.panelIndex === panelIndex)
          : undefined,
        storyTextOverlayEnabled: input.beat.storyTextOverlayEnabled !== false,
        storyTextOverlayMode: input.beat.storyTextOverlayMode,
        storyTextOverlayStyle: input.beat.storyTextOverlayStyle,
        storyTextOverlayTextHighlightSupported: input.beat.storyTextOverlayAlignment?.textHighlightSupported !== false,
        storyEffects: input.beat.storyEffects,
        effectSeed: `${beatIndex}:${panelIndex}`,
      });
    }

    const resolvedDurationMs = boundaries[boundaries.length - 1];
    beatDurationsMs.push(resolvedDurationMs);
    beatStartMs += resolvedDurationMs;
  });

  const transitionTimeline = buildStoryTransitionTimeline(
    [0, ...scenes.map((scene) => scene.narrationEndMs)],
    storyTransition
  );
  scenes.forEach((scene) => {
    scene.startMs = narrationTimeToStoryVisualTime(transitionTimeline, scene.narrationStartMs);
    scene.endMs = scene.startMs + scene.narrationEndMs - scene.narrationStartMs;
  });

  return {
    scenes,
    beatDurationsMs,
    totalNarrationDurationMs: beatStartMs,
    totalDurationMs: transitionTimeline.totalDurationMs,
    transitionTimeline,
  };
}

export function getStoryExportFrameState(timeline: StoryExportTimeline, timeMs: number) {
  return getStoryTransitionClockState(timeline.transitionTimeline, timeMs);
}

export function getStoryExportSceneAtTime(timeline: StoryExportTimeline, timeMs: number) {
  if (timeline.scenes.length === 0) return undefined;
  const state = getStoryExportFrameState(timeline, timeMs);
  return timeline.scenes[Math.min(state.activeIndex, timeline.scenes.length - 1)];
}

// Constant-frame-rate grid across the whole timeline. Event-boundary sampling
// (scene starts/ends + word timings only) undersampled continuous pan/zoom and
// particle motion, which encoded as long-held frames and made exports stutter.
export function buildStoryExportFrameSamples(
  timeline: StoryExportTimeline,
  fps: number
): StoryExportFrameSample[] {
  return buildConstantRateFrameSamples(timeline.totalDurationMs, fps);
}
