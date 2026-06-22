import { describe, expect, it } from 'vitest';

import type { StoryMap } from '@/lib/types/story';
import { SYSTEM_STORY_EFFECT_PRESETS, applyStoryEffectPreset } from './presets';
import { applyStoryEffectsToMap } from './story-map';

describe('applyStoryEffectsToMap', () => {
  it('updates every generated branch without sharing config references', () => {
    const beat = (title: string) => ({
      title,
      beatNumber: 1,
      isEnding: false,
      storyText: title,
      sceneSummary: '',
      options: [],
      characters: [],
      continuityNotes: [],
      imagePrompt: '',
      clues: [],
      nextBeatGoal: '',
      endingForecast: [],
    });
    const map: StoryMap = {
      rootNodeId: 'root',
      currentNodeId: 'left',
      nodes: {
        root: { id: 'root', beatNumber: 1, parentId: null, selectedOptionId: null, children: ['left', 'right'], data: beat('root') },
        left: { id: 'left', beatNumber: 2, parentId: 'root', selectedOptionId: null, children: [], data: beat('left') },
        right: { id: 'right', beatNumber: 2, parentId: 'root', selectedOptionId: null, children: [], data: beat('right') },
      },
    };
    const next = applyStoryEffectsToMap(map, applyStoryEffectPreset(SYSTEM_STORY_EFFECT_PRESETS[0]));
    expect(Object.values(next.nodes).every((node) => node.data.storyEffects?.enabled)).toBe(true);
    next.nodes.left.data.storyEffects!.motion.panX = 19;
    expect(next.nodes.right.data.storyEffects!.motion.panX).not.toBe(19);
    expect(map.nodes.root.data.storyEffects).toBeUndefined();
  });
});

