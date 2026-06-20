export const STORYBOARD_IMAGE_SIZES = ['1K', '2K'] as const;
export type StoryboardImageSize = (typeof STORYBOARD_IMAGE_SIZES)[number];

export const STORYBOARD_LAYOUT_MODES = ['2x2'] as const;
export type StoryboardLayoutMode = (typeof STORYBOARD_LAYOUT_MODES)[number];
export const DEFAULT_STORYBOARD_VIGNETTE_AMOUNT_PERCENT = 100;
export const DEFAULT_STORY_UI_TEXT_LINE_COUNT = 7;
export const MIN_STORY_UI_TEXT_LINE_COUNT = 3;
export const MAX_STORY_UI_TEXT_LINE_COUNT = 14;
export const DEFAULT_STORY_TEXT_OVERLAY_WORDS_PER_LINE = 7;
export const MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE = 2;
export const MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE = 12;

export interface StoryboardImageQualitySettings {
  imageSize: StoryboardImageSize;
  webpCompressionEnabled: boolean;
  webpQualityPercent: number;
  clientProcessingEnabled: boolean;
  layoutMode: StoryboardLayoutMode;
}

export const DEFAULT_STORYBOARD_IMAGE_QUALITY_SETTINGS: StoryboardImageQualitySettings = {
  imageSize: '1K',
  webpCompressionEnabled: false,
  webpQualityPercent: 85,
  clientProcessingEnabled: false,
  layoutMode: '2x2',
};

export function normalizeStoryboardImageSize(value: unknown): StoryboardImageSize {
  return value === '2K' ? '2K' : DEFAULT_STORYBOARD_IMAGE_QUALITY_SETTINGS.imageSize;
}

export function normalizeStoryboardLayoutMode(value: unknown): StoryboardLayoutMode {
  return value === '2x2' ? '2x2' : DEFAULT_STORYBOARD_IMAGE_QUALITY_SETTINGS.layoutMode;
}

export function normalizeStoryboardWebpQualityPercent(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? parseInt(value, 10)
      : NaN;

  if (!Number.isFinite(numeric)) {
    return DEFAULT_STORYBOARD_IMAGE_QUALITY_SETTINGS.webpQualityPercent;
  }

  return Math.min(100, Math.max(1, Math.round(numeric)));
}

export function normalizeStoryboardVignetteAmountPercent(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? parseInt(value, 10)
      : NaN;

  if (!Number.isFinite(numeric)) {
    return DEFAULT_STORYBOARD_VIGNETTE_AMOUNT_PERCENT;
  }

  return Math.min(100, Math.max(0, Math.round(numeric)));
}

export function normalizeStoryUiTextLineCount(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? parseInt(value, 10)
      : NaN;

  if (!Number.isFinite(numeric)) {
    return DEFAULT_STORY_UI_TEXT_LINE_COUNT;
  }

  return Math.min(
    MAX_STORY_UI_TEXT_LINE_COUNT,
    Math.max(MIN_STORY_UI_TEXT_LINE_COUNT, Math.round(numeric))
  );
}

export function normalizeStoryTextOverlayWordsPerLine(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? parseInt(value, 10)
      : NaN;

  if (!Number.isFinite(numeric)) {
    return DEFAULT_STORY_TEXT_OVERLAY_WORDS_PER_LINE;
  }

  return Math.min(
    MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
    Math.max(MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE, Math.round(numeric))
  );
}

export function normalizeStoryboardImageQualitySettings(
  input?: Partial<StoryboardImageQualitySettings> | null
): StoryboardImageQualitySettings {
  return {
    imageSize: normalizeStoryboardImageSize(input?.imageSize),
    webpCompressionEnabled: Boolean(input?.webpCompressionEnabled),
    webpQualityPercent: normalizeStoryboardWebpQualityPercent(input?.webpQualityPercent),
    clientProcessingEnabled: Boolean(input?.clientProcessingEnabled),
    layoutMode: normalizeStoryboardLayoutMode(input?.layoutMode),
  };
}
