import { describe, expect, it } from 'vitest';

import { buildStoryExportTimeline } from './export-timeline';
import { drawStoryExportFrame } from './export-renderer';
import type { StoryTransitionType } from '@/lib/story-transitions/settings';
import type { StoryBeat } from '@/lib/types/story';

function beat(): StoryBeat {
  return {
    beatNumber: 1,
    title: 'Beat',
    storyText: 'Text',
    sceneSummary: 'Scene',
    options: [],
    characters: [],
    continuityNotes: [],
    imagePrompt: '',
    clues: [],
    nextBeatGoal: '',
    endingForecast: [],
    isEnding: false,
    isStoryboard: true,
    imageUrl: 'grid.jpg',
  };
}

function renderAtTransition(type: StoryTransitionType) {
  const timeline = buildStoryExportTimeline([
    { beat: beat(), imageUrl: 'grid.jpg', durationMs: 4000, hasAudio: true },
  ], false, 2500, { type, durationMs: type === 'fast-cut' ? 0 : 500 });
  const draws: Array<{ alpha: number; filter: string }> = [];
  const mockContext = {
    canvas: { width: 1280, height: 720 },
    fillStyle: '',
    globalAlpha: 1,
    filter: 'none',
    fillRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    drawImage() {
      draws.push({ alpha: mockContext.globalAlpha, filter: mockContext.filter });
    },
  };
  const context = mockContext as unknown as CanvasRenderingContext2D;
  const image = { width: 2000, height: 2000 } as ImageBitmap;
  const timeMs = type === 'fast-cut'
    ? 1000
    : timeline.transitionTimeline.transitions[0].startMs + 125;
  drawStoryExportFrame(context, timeline, new Map([['grid.jpg', image]]), timeMs);
  return draws;
}

describe('story export transition renderer', () => {
  it('renders Fast Cut without a blend window', () => {
    expect(renderAtTransition('fast-cut')).toHaveLength(1);
  });

  it('renders direct opacity blend layers', () => {
    const draws = renderAtTransition('opacity-blend');
    expect(draws).toHaveLength(2);
    expect(draws.map((draw) => draw.alpha)).toEqual([0.75, 0.25]);
  });

  it('renders blur on both Soft Fade layers', () => {
    const draws = renderAtTransition('soft-fade');
    expect(draws).toHaveLength(2);
    expect(draws.every((draw) => draw.filter.startsWith('blur('))).toBe(true);
  });

  it('renders the outgoing half of Fade to Black', () => {
    const draws = renderAtTransition('fade-black');
    expect(draws).toHaveLength(1);
    expect(draws[0].alpha).toBe(0.5);
  });
});
