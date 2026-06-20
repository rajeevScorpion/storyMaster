import { STORYBOARD_ADVANCE_MS } from '@/lib/constants/media';
import { isStoryboardBeat } from '@/lib/storyboard/beat';
import { getStoryboardPanelBoundariesMs } from '@/lib/storyboard/narration-timing';
import type { StoryTextOverlayCaption } from '@/lib/story-overlay/types';
import type { StoryBeat } from '@/lib/types/story';

export const STORY_EXPORT_FADE_MS = 600;

export interface StoryExportBeatInput {
  beat: StoryBeat;
  imageUrl: string;
  durationMs: number;
  hasAudio: boolean;
}

export interface StoryExportScene {
  beatIndex: number;
  beatStartMs: number;
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
}

export interface StoryExportTimeline {
  scenes: StoryExportScene[];
  beatDurationsMs: number[];
  totalDurationMs: number;
}

export interface StoryExportFrameSample {
  timeMs: number;
  durationMs: number;
}

export function buildStoryExportTimeline(
  beats: StoryExportBeatInput[],
  cycleOverride: boolean,
  cycleMs: number
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
        startMs: beatStartMs + boundaries[panelIndex],
        endMs: beatStartMs + boundaries[panelIndex + 1],
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
      });
    }

    const resolvedDurationMs = boundaries[boundaries.length - 1];
    beatDurationsMs.push(resolvedDurationMs);
    beatStartMs += resolvedDurationMs;
  });

  return { scenes, beatDurationsMs, totalDurationMs: beatStartMs };
}

export function getStoryExportSceneAtTime(timeline: StoryExportTimeline, timeMs: number) {
  if (timeline.scenes.length === 0) return undefined;
  const clamped = Math.max(0, Math.min(timeMs, timeline.totalDurationMs));
  return [...timeline.scenes].reverse().find((scene) => clamped >= scene.startMs)
    ?? timeline.scenes[0];
}

export function buildStoryExportFrameSamples(
  timeline: StoryExportTimeline,
  fps: number
): StoryExportFrameSample[] {
  const frameMs = 1000 / Math.max(1, fps);
  const points = new Set<number>([0, timeline.totalDurationMs]);
  const add = (value: number) => points.add(Math.max(0, Math.min(timeline.totalDurationMs, Math.round(value * 1000) / 1000)));

  timeline.scenes.forEach((scene) => {
    add(scene.startMs);
    add(scene.endMs);
    const fadeMs = Math.min(STORY_EXPORT_FADE_MS, Math.max(0, (scene.endMs - scene.startMs) / 2));
    for (let timeMs = scene.startMs; timeMs < scene.startMs + fadeMs; timeMs += frameMs) add(timeMs);
    for (let timeMs = Math.max(scene.startMs, scene.endMs - fadeMs); timeMs < scene.endMs; timeMs += frameMs) add(timeMs);
    scene.storyTextOverlayCaption?.wordTimings?.forEach((word) => {
      add(scene.beatStartMs + word.startMs);
      add(scene.beatStartMs + word.endMs);
    });
  });

  const sorted = [...points].sort((left, right) => left - right);
  return sorted.slice(0, -1).map((timeMs, index) => ({
    timeMs,
    durationMs: sorted[index + 1] - timeMs,
  })).filter((sample) => sample.durationMs > 0);
}
