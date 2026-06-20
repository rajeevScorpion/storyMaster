import type { StoryBeat } from '@/lib/types/story';

export type StoryTextOverlayGenerationBlockReason =
  | 'not_storyboard'
  | 'missing_image'
  | 'missing_audio'
  | 'missing_text';

export interface StoryTextOverlayGenerationEligibility {
  eligible: boolean;
  reason?: StoryTextOverlayGenerationBlockReason;
  message?: string;
}

export function hasStoryTextOverlayTimedAlignment(
  beat: Pick<StoryBeat, 'storyTextOverlayAlignment' | 'storyTextOverlayCaptions'>
): boolean {
  return Boolean(
    beat.storyTextOverlayAlignment?.source === 'elevenlabs_forced_alignment'
      && beat.storyTextOverlayAlignment.textHighlightSupported !== false
      && beat.storyTextOverlayCaptions?.some((caption) => caption.wordTimings?.length)
  );
}

export function getStoryTextOverlayGenerationEligibility(
  beat: Pick<StoryBeat, 'isStoryboard' | 'imageUrl' | 'audioUrl' | 'storyText'>
): StoryTextOverlayGenerationEligibility {
  if (!beat.isStoryboard) {
    return {
      eligible: false,
      reason: 'not_storyboard',
      message: 'Text overlay timing is available for storyboard beats only.',
    };
  }
  if (!beat.imageUrl) {
    return {
      eligible: false,
      reason: 'missing_image',
      message: 'Create the storyboard image before generating text overlay timing.',
    };
  }
  if (!beat.audioUrl) {
    return {
      eligible: false,
      reason: 'missing_audio',
      message: 'Generate narration before generating text overlay timing.',
    };
  }
  if (!beat.storyText?.trim()) {
    return {
      eligible: false,
      reason: 'missing_text',
      message: 'Story text is required before generating text overlay timing.',
    };
  }
  return { eligible: true };
}
