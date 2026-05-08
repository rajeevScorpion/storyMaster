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

export interface BeatImageGalleryEntryShape {
  url: string;
  storageKey: string;
  uploadedAt: string;
  optimizationMetadata?: import('@/lib/media/imageUploadOptimization').ImageCompressionMetadata;
}

export function normalizeBeatMediaFields<T extends {
  imageUrl?: string;
  persistedImageUrl?: string;
  imageStatus?: BeatMediaStatus;
  imageError?: string;
  imageGallery?: BeatImageGalleryEntryShape[];
  isStoryboard?: boolean;
  audioUrl?: string;
  audioStatus?: BeatMediaStatus;
  audioError?: string;
}>(beat: T): T & {
  persistedImageUrl?: string;
  imageStatus: BeatMediaStatus;
  imageError?: string;
  imageGallery: BeatImageGalleryEntryShape[];
  audioStatus: BeatMediaStatus;
  audioError?: string;
} {
  return {
    ...beat,
    persistedImageUrl: getBeatPersistedImageUrl(beat),
    imageStatus: normalizeImageMediaStatus(beat.imageStatus, beat.imageUrl, beat.persistedImageUrl, beat.isStoryboard),
    imageError: beat.imageError || undefined,
    imageGallery: Array.isArray(beat.imageGallery) ? beat.imageGallery : [],
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

/**
 * Pull the storage key out of a Supabase Storage URL (works for both public and
 * signed URLs).
 */
export function extractStoryAssetStorageKey(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('r2://')) {
    const withoutPrefix = url.slice('r2://'.length);
    const separator = withoutPrefix.indexOf('/');
    return separator > 0 ? withoutPrefix.slice(separator + 1) : null;
  }
  const publicMarker = '/storage/v1/object/public/story-assets/';
  const publicIdx = url.indexOf(publicMarker);
  if (publicIdx !== -1) return url.substring(publicIdx + publicMarker.length);
  const signedMarker = '/storage/v1/object/sign/story-assets/';
  const signedIdx = url.indexOf(signedMarker);
  if (signedIdx !== -1) {
    const tail = url.substring(signedIdx + signedMarker.length);
    const qIdx = tail.indexOf('?');
    return qIdx !== -1 ? tail.substring(0, qIdx) : tail;
  }
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    const storiesIdx = path.indexOf('stories/');
    if (storiesIdx >= 0) return path.slice(storiesIdx);
  } catch {
    // Not a URL we know how to inspect.
  }
  return null;
}

/**
 * Resolve which storage key from a beat's gallery is currently the active image.
 * Handles three cases:
 *   - beat.imageUrl is a data URL → match the gallery entry whose url equals it
 *   - beat.imageUrl is a public/signed URL → extract the storage key
 *   - beat has no active image → null
 */
export function getActiveGalleryStorageKey<T extends {
  imageUrl?: string;
  imageGallery?: Array<{ url: string; storageKey: string }>;
}>(beat: T): string | null {
  if (!beat.imageUrl) return null;
  const fromUrl = extractStoryAssetStorageKey(beat.imageUrl);
  if (fromUrl) return fromUrl;
  // Data URL or unrecognized format — fall back to direct URL match against the gallery.
  return beat.imageGallery?.find((entry) => entry.url === beat.imageUrl)?.storageKey ?? null;
}
