import type { StoryBeat } from '@/lib/types/story';

export function isStoryboardBeat(
  beat: Pick<StoryBeat, 'isStoryboard' | 'storyboardPlan' | 'reelCaptions' | 'storyTextOverlayCaptions'>,
  options: { assumeGeneratedStoryboard?: boolean } = {}
): boolean {
  if (beat.isStoryboard === true || Boolean(beat.storyboardPlan)) return true;

  const captionPanels = new Set(
    ([...(beat.storyTextOverlayCaptions ?? []), ...(beat.reelCaptions ?? [])])
      .map((caption) => caption.panelIndex)
      .filter((panelIndex) => panelIndex >= 0 && panelIndex < 4)
  );
  if (captionPanels.size === 4) return true;

  return options.assumeGeneratedStoryboard === true && beat.isStoryboard !== false;
}
