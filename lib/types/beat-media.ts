export type BeatMediaStatus = 'not_requested' | 'pending' | 'ready' | 'failed';

export const DEFAULT_IMAGE_MEDIA_STATUS: BeatMediaStatus = 'not_requested';
export const DEFAULT_AUDIO_MEDIA_STATUS: BeatMediaStatus = 'not_requested';

export const BEAT_ROW_NOT_FOUND_MESSAGE = 'BEAT_ROW_NOT_FOUND';

export function isBeatRowNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(BEAT_ROW_NOT_FOUND_MESSAGE);
}

export function isBeatMediaStatus(value: unknown): value is BeatMediaStatus {
  return value === 'not_requested' || value === 'pending' || value === 'ready' || value === 'failed';
}

export function normalizeImageMediaStatus(
  status: BeatMediaStatus | undefined,
  imageUrl: string | undefined,
  isStoryboard: boolean | undefined
): BeatMediaStatus {
  if (imageUrl && !imageUrl.startsWith('data:')) {
    return 'ready';
  }
  if (isBeatMediaStatus(status)) {
    return status;
  }
  if (imageUrl?.startsWith('data:')) {
    return 'pending';
  }
  if (isStoryboard) {
    return 'failed';
  }
  return DEFAULT_IMAGE_MEDIA_STATUS;
}

export function normalizeAudioMediaStatus(
  status: BeatMediaStatus | undefined,
  audioUrl: string | undefined
): BeatMediaStatus {
  if (audioUrl && !audioUrl.startsWith('data:')) {
    return 'ready';
  }
  if (isBeatMediaStatus(status)) {
    return status;
  }
  if (audioUrl?.startsWith('data:')) {
    return 'pending';
  }
  return DEFAULT_AUDIO_MEDIA_STATUS;
}

export function normalizeBeatMediaFields<T extends {
  imageUrl?: string;
  imageStatus?: BeatMediaStatus;
  imageError?: string;
  isStoryboard?: boolean;
  audioUrl?: string;
  audioStatus?: BeatMediaStatus;
  audioError?: string;
}>(beat: T): T & {
  imageStatus: BeatMediaStatus;
  imageError?: string;
  audioStatus: BeatMediaStatus;
  audioError?: string;
} {
  return {
    ...beat,
    imageStatus: normalizeImageMediaStatus(beat.imageStatus, beat.imageUrl, beat.isStoryboard),
    imageError: beat.imageError || undefined,
    audioStatus: normalizeAudioMediaStatus(beat.audioStatus, beat.audioUrl),
    audioError: beat.audioError || undefined,
  };
}
