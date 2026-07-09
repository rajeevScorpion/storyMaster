import { v4 as uuidv4 } from 'uuid';
import { Character, StoryBeat, StoryMap, StoryNode } from '../types/story';

export function createStoryMap(rootBeat: StoryBeat, preGeneratedId?: string): StoryMap {
  const id = preGeneratedId || uuidv4();
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

export function getNodesByBeatNumber(map: StoryMap): StoryNode[] {
  return Object.values(map.nodes).sort((left, right) => {
    const beatDiff = left.beatNumber - right.beatNumber;
    if (beatDiff !== 0) return beatDiff;
    return left.id.localeCompare(right.id);
  });
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

/**
 * All descendant node ids of a node (children, grandchildren, ...), breadth
 * first. The node itself is not included.
 */
export function getDescendantNodeIds(map: StoryMap, nodeId: string): string[] {
  const start = map.nodes[nodeId];
  if (!start) return [];
  const result: string[] = [];
  const queue = [...start.children];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = map.nodes[id];
    if (!node) continue;
    result.push(id);
    queue.push(...node.children);
  }
  return result;
}

export function hasActiveDescendants(map: StoryMap, nodeId: string): boolean {
  return getDescendantNodeIds(map, nodeId).length > 0;
}

/**
 * Timeline lock: a beat is locked for story-changing edits (text, options)
 * while later beats exist anywhere below it. Visual regeneration is never
 * blocked by this lock.
 */
export function isBeatLockedForStoryEdit(map: StoryMap, nodeId: string): boolean {
  return hasActiveDescendants(map, nodeId);
}

/**
 * Remove the whole subtree below a node (the node itself stays). Returns a
 * new map with the surviving nodes, the source node's children cleared, and
 * currentNodeId repointed to the source node.
 */
export function removeSubtree(map: StoryMap, nodeId: string): StoryMap {
  const source = map.nodes[nodeId];
  if (!source) return map;
  const removed = new Set(getDescendantNodeIds(map, nodeId));
  if (removed.size === 0 && map.currentNodeId === nodeId) return map;
  const nodes: StoryMap['nodes'] = {};
  for (const [id, node] of Object.entries(map.nodes)) {
    if (removed.has(id)) continue;
    nodes[id] = id === nodeId ? { ...node, children: [] } : node;
  }
  return {
    ...map,
    nodes,
    currentNodeId: nodeId,
  };
}

/**
 * Named characters available at a node: the union of the characters that
 * appear on the path from the root to the node, deduplicated by lowercased
 * name (later beats win so the freshest appearance data is kept).
 */
export function collectNamedCharactersForNode(map: StoryMap, nodeId: string): Character[] {
  const byName = new Map<string, Character>();
  for (const node of getPathToNode(map, nodeId)) {
    for (const character of node.data.characters ?? []) {
      const name = character?.name?.trim();
      if (!name) continue;
      byName.set(name.toLowerCase(), character);
    }
  }
  return Array.from(byName.values());
}
