import { describe, expect, it } from 'vitest';

import {
  buildStoryExportTimeline,
  getStoryExportFrameState,
  getStoryExportSceneAtTime,
} from './export-timeline';
import type { StoryBeat } from '@/lib/types/story';
import { SYSTEM_STORY_EFFECT_PRESETS, applyStoryEffectPreset } from '@/lib/story-effects/presets';

function storyboardBeat(beatNumber: number): StoryBeat {
  return {
    beatNumber,
    title: `Beat ${beatNumber}`,
    storyText: 'One two three four.',
    sceneSummary: 'A scene',
    options: [],
    characters: [],
    continuityNotes: [],
    imagePrompt: '',
    clues: [],
    nextBeatGoal: '',
    endingForecast: [],
    isEnding: false,
    isStoryboard: true,
    imageUrl: `https://example.com/${beatNumber}.jpg`,
  };
}

describe('story export transition timeline', () => {
  it('inserts panel and beat transition windows into the exported duration', () => {
    const timeline = buildStoryExportTimeline([
      { beat: storyboardBeat(1), imageUrl: 'one.jpg', durationMs: 4000, hasAudio: true },
      { beat: storyboardBeat(2), imageUrl: 'two.jpg', durationMs: 4000, hasAudio: true },
    ], false, 2500, { type: 'opacity-blend', durationMs: 500 });

    expect(timeline.scenes).toHaveLength(8);
    expect(timeline.transitionTimeline.transitions).toHaveLength(7);
    expect(timeline.totalNarrationDurationMs).toBe(8000);
    expect(timeline.totalDurationMs).toBe(11500);
    expect(timeline.transitionTimeline.transitions[3]).toMatchObject({
      fromIndex: 3,
      toIndex: 4,
      narrationTimeMs: 4000,
    });
  });

  it('freezes narration and the outgoing scene during an inserted transition', () => {
    const timeline = buildStoryExportTimeline([
      { beat: storyboardBeat(1), imageUrl: 'one.jpg', durationMs: 4000, hasAudio: true },
    ], false, 2500, { type: 'fade-black', durationMs: 600 });
    const transition = timeline.transitionTimeline.transitions[0];
    const state = getStoryExportFrameState(timeline, transition.startMs + 300);

    expect(state.narrationTimeMs).toBe(1000);
    expect(state.transition?.progress).toBeCloseTo(0.5);
    expect(getStoryExportSceneAtTime(timeline, transition.startMs + 300)?.panelIndex).toBe(0);
  });

  it('keeps existing stories on a zero-duration Fast Cut timeline', () => {
    const timeline = buildStoryExportTimeline([
      { beat: storyboardBeat(1), imageUrl: 'one.jpg', durationMs: 4000, hasAudio: true },
    ], false, 2500);

    expect(timeline.transitionTimeline.transitionSettings.type).toBe('fast-cut');
    expect(timeline.transitionTimeline.transitions).toHaveLength(0);
    expect(timeline.totalDurationMs).toBe(4000);
  });

  it('carries the normalized beat effect assignment into every panel scene', () => {
    const beat = storyboardBeat(1);
    beat.storyEffects = applyStoryEffectPreset(SYSTEM_STORY_EFFECT_PRESETS[2]);
    const timeline = buildStoryExportTimeline([{ beat, imageUrl: 'one.jpg', durationMs: 4000, hasAudio: true }], false, 2500);
    expect(timeline.scenes.every((scene) => scene.storyEffects?.particles.type === 'snow')).toBe(true);
    expect(new Set(timeline.scenes.map((scene) => scene.effectSeed)).size).toBe(4);
  });
});
