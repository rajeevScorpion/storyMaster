import type { StoryBeat, StorySession } from '@/lib/types/story';

type BeatVisualSource = Pick<StoryBeat, 'portraitImageUrl' | 'imageUrl' | 'persistedImageUrl'>;

function cleanVisualUrl(url?: string | null): string | undefined {
  const trimmed = url?.trim();
  return trimmed ? trimmed : undefined;
}

export function getBeatFirstVisualUrl(beat?: BeatVisualSource | null): string | undefined {
  return cleanVisualUrl(beat?.portraitImageUrl)
    ?? cleanVisualUrl(beat?.imageUrl)
    ?? cleanVisualUrl(beat?.persistedImageUrl);
}

export function getSessionCurrentVisualUrl(session?: Pick<StorySession, 'storyMap'> | null): string | undefined {
  const storyMap = session?.storyMap;
  if (!storyMap) return undefined;

  const currentNode = storyMap.nodes[storyMap.currentNodeId] ?? storyMap.nodes[storyMap.rootNodeId];
  return getBeatFirstVisualUrl(currentNode?.data);
}
