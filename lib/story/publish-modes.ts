import { normalizeStoryConfig } from '@/lib/ai/story-config';
import { getBeatPersistedImageUrl, normalizeBeatMediaFields } from '@/lib/types/beat-media';
import type { StoryBeat, StoryConfig } from '@/lib/types/story';
import type { StorylineFormat, StorylineOrientation, StorylineVisualMode } from '@/lib/types/database';

type StorylineBeatMediaShape = {
  imageUrl?: string | null;
  persistedImageUrl?: string | null;
  imageStatus?: StoryBeat['imageStatus'];
  isStoryboard?: boolean;
};

export type StorylineBeatImageCoverage = {
  totalBeats: number;
  beatsWithImages: number;
  hasAnyBeatImages: boolean;
  hasImagesForAllBeats: boolean;
};

function hasDurableBeatImage(beat: StorylineBeatMediaShape): boolean {
  return Boolean(getBeatPersistedImageUrl(normalizeBeatMediaFields({
    imageUrl: beat.imageUrl ?? undefined,
    persistedImageUrl: beat.persistedImageUrl ?? undefined,
    imageStatus: beat.imageStatus,
    isStoryboard: beat.isStoryboard,
  })));
}

export function classifyStorylineBeatImages(
  beats: StorylineBeatMediaShape[] | null | undefined
): StorylineBeatImageCoverage {
  const safeBeats = Array.isArray(beats) ? beats : [];
  const beatsWithImages = safeBeats.reduce(
    (count, beat) => count + (hasDurableBeatImage(beat) ? 1 : 0),
    0
  );

  return {
    totalBeats: safeBeats.length,
    beatsWithImages,
    hasAnyBeatImages: beatsWithImages > 0,
    hasImagesForAllBeats: safeBeats.length > 0 && beatsWithImages === safeBeats.length,
  };
}

export function getStorylinePublishModes(
  config: StoryConfig,
  publishMode: 'standard' | 'audio_story' = 'standard',
  beats?: StorylineBeatMediaShape[] | null
): {
  storyFormat: StorylineFormat;
  storyVisualMode: StorylineVisualMode;
  orientation: StorylineOrientation;
} {
  const normalizedConfig = normalizeStoryConfig(config);
  const coverage = classifyStorylineBeatImages(beats);

  return {
    storyFormat: publishMode === 'audio_story' && !coverage.hasImagesForAllBeats
      ? 'audio_story'
      : 'visual_story',
    storyVisualMode: coverage.hasImagesForAllBeats
      ? 'with_images'
      : normalizedConfig.imageGenerationMode === 'prompt_only'
        ? 'without_images'
        : 'with_images',
    orientation: normalizedConfig.isVerticalStory || normalizedConfig.aspectRatio === '9:16'
      ? 'portrait'
      : 'landscape',
  };
}

export function getStoredStorylineClassificationPatch(input: {
  storyFormat: StorylineFormat;
  storyVisualMode: StorylineVisualMode;
  beats?: StorylineBeatMediaShape[] | null;
}): Partial<{
  story_format: StorylineFormat;
  story_visual_mode: StorylineVisualMode;
}> {
  const coverage = classifyStorylineBeatImages(input.beats);
  const patch: Partial<{
    story_format: StorylineFormat;
    story_visual_mode: StorylineVisualMode;
  }> = {};

  if (coverage.hasImagesForAllBeats && input.storyFormat === 'audio_story') {
    patch.story_format = 'visual_story';
  }

  if (coverage.hasImagesForAllBeats && input.storyVisualMode === 'without_images') {
    patch.story_visual_mode = 'with_images';
  }

  return patch;
}
