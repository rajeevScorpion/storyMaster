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

function isDurableMediaUrl(url: string | undefined): url is string {
  return Boolean(url && !url.startsWith('data:'));
}

export function getBeatDisplayImageUrl<T extends { imageUrl?: string }>(beat: T): string | undefined {
  return beat.imageUrl;
}

export function getBeatPersistedImageUrl<T extends {
  imageUrl?: string;
  persistedImageUrl?: string;
}>(beat: T): string | undefined {
  if (isDurableMediaUrl(beat.persistedImageUrl)) {
    return beat.persistedImageUrl;
  }
  if (isDurableMediaUrl(beat.imageUrl)) {
    return beat.imageUrl;
  }
  return undefined;
}

export function getBeatPersistedAudioUrl<T extends { audioUrl?: string }>(beat: T): string | undefined {
  return isDurableMediaUrl(beat.audioUrl) ? beat.audioUrl : undefined;
}

export function normalizeImageMediaStatus(
  status: BeatMediaStatus | undefined,
  imageUrl: string | undefined,
  persistedImageUrl: string | undefined,
  isStoryboard: boolean | undefined
): BeatMediaStatus {
  if (getBeatPersistedImageUrl({ imageUrl, persistedImageUrl })) {
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
  if (getBeatPersistedAudioUrl({ audioUrl })) {
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
  persistedImageUrl?: string;
  imageStatus?: BeatMediaStatus;
  imageError?: string;
  isStoryboard?: boolean;
  audioUrl?: string;
  audioStatus?: BeatMediaStatus;
  audioError?: string;
}>(beat: T): T & {
  persistedImageUrl?: string;
  imageStatus: BeatMediaStatus;
  imageError?: string;
  audioStatus: BeatMediaStatus;
  audioError?: string;
} {
  return {
    ...beat,
    persistedImageUrl: getBeatPersistedImageUrl(beat),
    imageStatus: normalizeImageMediaStatus(beat.imageStatus, beat.imageUrl, beat.persistedImageUrl, beat.isStoryboard),
    imageError: beat.imageError || undefined,
    audioStatus: normalizeAudioMediaStatus(beat.audioStatus, beat.audioUrl),
    audioError: beat.audioError || undefined,
  };
}

export function hasBeatImpossibleImageState<T extends {
  imageUrl?: string;
  persistedImageUrl?: string;
  imageStatus?: BeatMediaStatus;
  isStoryboard?: boolean;
}>(beat: T): boolean {
  return (
    normalizeImageMediaStatus(beat.imageStatus, beat.imageUrl, beat.persistedImageUrl, beat.isStoryboard) === 'ready'
    && !getBeatPersistedImageUrl(beat)
  );
}
