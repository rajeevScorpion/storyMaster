import type { StoryMap, StoryNode, StoryBeat } from '@/lib/types/story';
import { getPathToNode } from './story-map';

export interface StorylineChoice {
  fromBeat: number;
  optionLabel: string;
}

export interface ExtractedStoryline {
  path: StoryNode[];
  beats: StoryBeat[];
  choices: StorylineChoice[];
}

/**
 * Find all ending nodes in a StoryMap.
 * An ending node is one where data.isEnding === true.
 */
export function findAllEndingNodes(storyMap: StoryMap): StoryNode[] {
  return Object.values(storyMap.nodes).filter((node) => node.data.isEnding);
}

/**
 * Extract a complete storyline from root to a specific ending node.
 * Returns the ordered path of nodes, beats, and the choices made at each branch.
 */
export function extractStoryline(storyMap: StoryMap, endingNodeId: string): ExtractedStoryline {
  const node = storyMap.nodes[endingNodeId];
  if (!node || !node.data.isEnding) {
    throw new Error('Node is not a valid ending');
  }

  const path = getPathToNode(storyMap, endingNodeId);
  const beats = path.map((n) => n.data);

  // Extract the choice labels at each branch point
  const choices: StorylineChoice[] = [];
  for (let i = 1; i < path.length; i++) {
    const currentNode = path[i];
    const parentNode = path[i - 1];
    if (currentNode.selectedOptionId) {
      const option = parentNode.data.options.find(
        (o) => o.id === currentNode.selectedOptionId
      );
      if (option) {
        choices.push({
          fromBeat: parentNode.data.beatNumber,
          optionLabel: option.label,
        });
      }
    }
  }

  return { path, beats, choices };
}

