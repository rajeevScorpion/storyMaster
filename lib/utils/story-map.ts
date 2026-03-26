import { v4 as uuidv4 } from 'uuid';
import { StoryBeat, StoryMap, StoryNode } from '../types/story';

export function createStoryMap(rootBeat: StoryBeat): StoryMap {
  const id = uuidv4();
  const rootNode: StoryNode = {
    id,
    beatNumber: rootBeat.beatNumber,
    parentId: null,
    selectedOptionId: null,
    data: rootBeat,
    children: [],
  };
  return {
    nodes: { [id]: rootNode },
    rootNodeId: id,
    currentNodeId: id,
  };
}

export function addChildNode(
  map: StoryMap,
  parentId: string,
  optionId: string,
  beat: StoryBeat,
  preGeneratedId?: string
): StoryMap {
  const id = preGeneratedId || uuidv4();
  const newNode: StoryNode = {
    id,
    beatNumber: beat.beatNumber,
    parentId,
    selectedOptionId: optionId,
    data: beat,
    children: [],
  };
  const parent = map.nodes[parentId];
  return {
    ...map,
    nodes: {
      ...map.nodes,
      [id]: newNode,
      [parentId]: { ...parent, children: [...parent.children, id] },
    },
    currentNodeId: id,
  };
}

export function findChildForOption(
  map: StoryMap,
  parentId: string,
  optionId: string
): string | null {
  const parent = map.nodes[parentId];
  if (!parent) return null;
  for (const childId of parent.children) {
    const child = map.nodes[childId];
    if (child && child.selectedOptionId === optionId) return childId;
  }
  return null;
}

export function getPathToNode(map: StoryMap, nodeId: string): StoryNode[] {
  const path: StoryNode[] = [];
  let currentId: string | null = nodeId;
  while (currentId) {
    const node: StoryNode | undefined = map.nodes[currentId];
    if (!node) break;
    path.unshift(node);
    currentId = node.parentId;
  }
  return path;
}

export function getBeatsToNode(map: StoryMap, nodeId: string): StoryBeat[] {
  return getPathToNode(map, nodeId).map((n) => n.data);
}

export function getChoiceHistoryToNode(map: StoryMap, nodeId: string): string[] {
  const path = getPathToNode(map, nodeId);
  const history: string[] = [];
  for (let i = 1; i < path.length; i++) {
    const node = path[i];
    const parent = path[i - 1];
    if (node.selectedOptionId) {
      const option = parent.data.options.find((o) => o.id === node.selectedOptionId);
      if (option) history.push(option.label);
    }
  }
  return history;
}

export function getCurrentNode(map: StoryMap): StoryNode {
  return map.nodes[map.currentNodeId];
}
