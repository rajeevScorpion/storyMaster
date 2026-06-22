import type { StoryMap } from '@/lib/types/story';
import { copyStoryEffectConfig, type StoryEffectConfig } from './settings';

export function applyStoryEffectsToMap(storyMap: StoryMap, config: StoryEffectConfig): StoryMap {
  return {
    ...storyMap,
    nodes: Object.fromEntries(Object.entries(storyMap.nodes).map(([nodeId, node]) => [
      nodeId,
      {
        ...node,
        data: {
          ...node.data,
          storyEffects: copyStoryEffectConfig(config, config.sourcePresetId),
        },
      },
    ])),
  };
}

