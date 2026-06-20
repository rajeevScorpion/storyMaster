import type {
  StoryTextOverlayAlign,
  StoryTextOverlayPosition,
  StoryTextOverlayStyle,
} from './types';

export const STORY_TEXT_FONT_PRESETS = [
  { label: 'Inter', value: 'var(--font-sans), Inter, system-ui, sans-serif', languages: ['english'] },
  { label: 'Playfair', value: 'var(--font-serif), Georgia, Cambria, serif', languages: ['english'] },
  { label: 'Montserrat', value: 'var(--font-reel-montserrat), Arial, sans-serif', languages: ['english'] },
  { label: 'Poppins', value: 'var(--font-reel-poppins), Arial, sans-serif', languages: ['english'] },
  { label: 'Noto Sans Devanagari', value: 'var(--font-reel-noto-sans-devanagari), Noto Sans Devanagari, sans-serif', languages: ['hindi'] },
  { label: 'Noto Serif Devanagari', value: 'var(--font-reel-noto-serif-devanagari), Noto Serif Devanagari, serif', languages: ['hindi'] },
  { label: 'Noto Sans Bengali', value: 'var(--font-reel-noto-sans-bengali), Noto Sans Bengali, sans-serif', languages: ['bangla'] },
  { label: 'Noto Serif Bengali', value: 'var(--font-reel-noto-serif-bengali), Noto Serif Bengali, serif', languages: ['bangla'] },
  { label: 'Noto Nastaliq Urdu', value: 'var(--font-reel-noto-nastaliq-urdu), Noto Nastaliq Urdu, serif', languages: ['urdu'] },
  { label: 'Noto Sans Gujarati', value: 'var(--font-reel-noto-sans-gujarati), Noto Sans Gujarati, sans-serif', languages: ['gujarati'] },
] as const;

export const DEFAULT_STORY_TEXT_OVERLAY_STYLE: Required<StoryTextOverlayStyle> = {
  fontFamily: STORY_TEXT_FONT_PRESETS[0].value,
  fontSize: 18,
  fontWeight: 700,
  color: '#ffffff',
  textOpacity: 1,
  outlineColor: '#000000',
  outlineWidth: 2,
  shadowColor: 'rgba(0,0,0,0.78)',
  shadowBlur: 14,
  backgroundColor: '#000000',
  backgroundOpacity: 0.18,
  backgroundBlur: 2,
  position: 'lower',
  verticalOffset: 0,
  align: 'center',
  wordHighlightColor: '#00D49B',
  wordHighlightOpacity: 0.72,
  wordHighlightPaddingX: 4,
  wordHighlightPaddingY: 2,
  wordHighlightBorderRadius: 5,
  wordHighlightWordSpacing: 5,
};

export const STORY_TEXT_OVERLAY_VERTICAL_OFFSET_MIN = -30;
export const STORY_TEXT_OVERLAY_VERTICAL_OFFSET_MAX = 30;
export const STORY_TEXT_OVERLAY_OUTLINE_WIDTH_MIN = 0;
export const STORY_TEXT_OVERLAY_OUTLINE_WIDTH_MAX = 10;
export const STORY_TEXT_OVERLAY_BACKGROUND_BLUR_MIN = 0;
export const STORY_TEXT_OVERLAY_BACKGROUND_BLUR_MAX = 24;
export const STORY_TEXT_OVERLAY_HIGHLIGHT_PADDING_X_MIN = 0;
export const STORY_TEXT_OVERLAY_HIGHLIGHT_PADDING_X_MAX = 18;
export const STORY_TEXT_OVERLAY_HIGHLIGHT_PADDING_Y_MIN = 0;
export const STORY_TEXT_OVERLAY_HIGHLIGHT_PADDING_Y_MAX = 12;
export const STORY_TEXT_OVERLAY_HIGHLIGHT_RADIUS_MIN = 0;
export const STORY_TEXT_OVERLAY_HIGHLIGHT_RADIUS_MAX = 24;
export const STORY_TEXT_OVERLAY_HIGHLIGHT_WORD_SPACING_MIN = 0;
export const STORY_TEXT_OVERLAY_HIGHLIGHT_WORD_SPACING_MAX = 28;
export const STORY_TEXT_OVERLAY_TOP_SAFE_MIN = 12;
export const STORY_TEXT_OVERLAY_TOP_SAFE_MAX = 88;

export function clampStoryOverlayNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampUnit(value: number): number {
  return clampStoryOverlayNumber(value, 0, 1);
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizePosition(value: unknown): StoryTextOverlayPosition {
  return value === 'upper' || value === 'middle' || value === 'lower'
    ? value
    : DEFAULT_STORY_TEXT_OVERLAY_STYLE.position;
}

function normalizeAlign(value: unknown): StoryTextOverlayAlign {
  return value === 'left' || value === 'right' || value === 'center'
    ? value
    : DEFAULT_STORY_TEXT_OVERLAY_STYLE.align;
}

function compactFontFamily(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function normalizeFontFamily(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_STORY_TEXT_OVERLAY_STYLE.fontFamily;
  }
  const fontFamily = value.trim();
  if (STORY_TEXT_FONT_PRESETS.some((font) => font.value === fontFamily)) {
    return fontFamily;
  }
  const legacyAliases = [
    { legacy: 'Inter, system-ui, sans-serif', preset: STORY_TEXT_FONT_PRESETS[0].value },
    { legacy: 'Georgia, Cambria, serif', preset: STORY_TEXT_FONT_PRESETS[1].value },
    { legacy: 'Arial, Helvetica, sans-serif', preset: STORY_TEXT_FONT_PRESETS[2].value },
  ];
  const compact = compactFontFamily(fontFamily);
  return legacyAliases.find((alias) => compactFontFamily(alias.legacy) === compact)?.preset ?? fontFamily;
}

export function storyOverlayColorToRgb(color: string | undefined): [number, number, number] | null {
  if (!color) return null;
  const trimmed = color.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1];
    const full = value.length === 3
      ? value.split('').map((ch) => `${ch}${ch}`).join('')
      : value;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }

  const rgb = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) {
    return [
      clampStoryOverlayNumber(Math.round(Number(rgb[1])), 0, 255),
      clampStoryOverlayNumber(Math.round(Number(rgb[2])), 0, 255),
      clampStoryOverlayNumber(Math.round(Number(rgb[3])), 0, 255),
    ];
  }
  return null;
}

export function storyOverlayRgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => clampStoryOverlayNumber(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

export function storyOverlayColorWithOpacity(color: string | undefined, opacity: number | undefined): string {
  const alpha = clampUnit(Number.isFinite(Number(opacity)) ? Number(opacity) : 1);
  if (alpha <= 0) return 'transparent';
  const source = color?.trim() || '#000000';
  const rgb = storyOverlayColorToRgb(source);
  if (rgb) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${roundToTwo(alpha)})`;
  }
  return alpha >= 1 ? source : `color-mix(in srgb, ${source} ${Math.round(alpha * 100)}%, transparent)`;
}

export function storyOverlayColorInputValue(color: string | undefined, fallback = '#000000'): string {
  const rgb = storyOverlayColorToRgb(color);
  return rgb ? storyOverlayRgbToHex(rgb) : fallback;
}

export function getStoryOverlayAnchorPercent(position: StoryTextOverlayStyle['position']): number {
  if (position === 'upper') return 20;
  if (position === 'middle') return 50;
  return 80;
}

export function getStoryOverlayTopPercent(style: StoryTextOverlayStyle): number {
  const normalized = normalizeStoryTextOverlayStyle(style);
  return clampStoryOverlayNumber(
    getStoryOverlayAnchorPercent(normalized.position) + (normalized.verticalOffset ?? 0),
    STORY_TEXT_OVERLAY_TOP_SAFE_MIN,
    STORY_TEXT_OVERLAY_TOP_SAFE_MAX
  );
}

export function getStoryTextFontPresetsForLanguage(language: string | null | undefined) {
  const normalizedLanguage = STORY_TEXT_FONT_PRESETS.some((font) => font.languages.includes(language as never))
    ? String(language)
    : 'english';
  const fonts = STORY_TEXT_FONT_PRESETS.filter((font) => font.languages.includes(normalizedLanguage as never));
  return fonts.length > 0 ? fonts : STORY_TEXT_FONT_PRESETS.filter((font) => font.languages.includes('english' as never));
}

export function getDefaultStoryTextFontFamilyForLanguage(language: string | null | undefined): string {
  return getStoryTextFontPresetsForLanguage(language)[0]?.value ?? DEFAULT_STORY_TEXT_OVERLAY_STYLE.fontFamily;
}

export function isStoryTextFontFamilyCompatibleWithLanguage(
  fontFamily: string | null | undefined,
  language: string | null | undefined
): boolean {
  if (!fontFamily) return false;
  return getStoryTextFontPresetsForLanguage(language).some((font) => font.value === fontFamily);
}

export function normalizeStoryTextOverlayStyle(value: unknown): StoryTextOverlayStyle {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fontSize = Number(raw.fontSize);
  const textOpacity = Number(raw.textOpacity);
  const outlineWidth = Number(raw.outlineWidth);
  const shadowBlur = Number(raw.shadowBlur);
  const backgroundOpacity = Number(raw.backgroundOpacity);
  const backgroundBlur = Number(raw.backgroundBlur);
  const verticalOffset = Number(raw.verticalOffset);
  const wordHighlightOpacity = Number(raw.wordHighlightOpacity);
  const wordHighlightPaddingX = Number(raw.wordHighlightPaddingX);
  const wordHighlightPaddingY = Number(raw.wordHighlightPaddingY);
  const wordHighlightBorderRadius = Number(raw.wordHighlightBorderRadius);
  const wordHighlightWordSpacing = Number(raw.wordHighlightWordSpacing);

  return {
    fontFamily: normalizeFontFamily(raw.fontFamily),
    fontSize: Number.isFinite(fontSize)
      ? Math.max(8, Math.min(80, Math.round(fontSize)))
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.fontSize,
    fontWeight: typeof raw.fontWeight === 'string' || typeof raw.fontWeight === 'number'
      ? raw.fontWeight
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.fontWeight,
    color: typeof raw.color === 'string' && raw.color.trim()
      ? raw.color.trim()
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.color,
    textOpacity: Number.isFinite(textOpacity)
      ? clampUnit(textOpacity)
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.textOpacity,
    outlineColor: typeof raw.outlineColor === 'string' && raw.outlineColor.trim()
      ? raw.outlineColor.trim()
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.outlineColor,
    outlineWidth: Number.isFinite(outlineWidth)
      ? Math.round(clampStoryOverlayNumber(outlineWidth, STORY_TEXT_OVERLAY_OUTLINE_WIDTH_MIN, STORY_TEXT_OVERLAY_OUTLINE_WIDTH_MAX))
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.outlineWidth,
    shadowColor: typeof raw.shadowColor === 'string' && raw.shadowColor.trim()
      ? raw.shadowColor.trim()
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.shadowColor,
    shadowBlur: Number.isFinite(shadowBlur)
      ? Math.max(0, Math.min(40, Math.round(shadowBlur)))
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.shadowBlur,
    backgroundColor: typeof raw.backgroundColor === 'string' && raw.backgroundColor.trim()
      ? raw.backgroundColor.trim()
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.backgroundColor,
    backgroundOpacity: Number.isFinite(backgroundOpacity)
      ? clampUnit(backgroundOpacity)
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.backgroundOpacity,
    backgroundBlur: Number.isFinite(backgroundBlur)
      ? Math.round(clampStoryOverlayNumber(backgroundBlur, STORY_TEXT_OVERLAY_BACKGROUND_BLUR_MIN, STORY_TEXT_OVERLAY_BACKGROUND_BLUR_MAX))
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.backgroundBlur,
    position: normalizePosition(raw.position),
    verticalOffset: Number.isFinite(verticalOffset)
      ? Math.round(clampStoryOverlayNumber(verticalOffset, STORY_TEXT_OVERLAY_VERTICAL_OFFSET_MIN, STORY_TEXT_OVERLAY_VERTICAL_OFFSET_MAX))
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.verticalOffset,
    align: normalizeAlign(raw.align),
    wordHighlightColor: typeof raw.wordHighlightColor === 'string' && raw.wordHighlightColor.trim()
      ? raw.wordHighlightColor.trim()
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.wordHighlightColor,
    wordHighlightOpacity: Number.isFinite(wordHighlightOpacity)
      ? clampUnit(wordHighlightOpacity)
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.wordHighlightOpacity,
    wordHighlightPaddingX: Number.isFinite(wordHighlightPaddingX)
      ? Math.round(clampStoryOverlayNumber(wordHighlightPaddingX, STORY_TEXT_OVERLAY_HIGHLIGHT_PADDING_X_MIN, STORY_TEXT_OVERLAY_HIGHLIGHT_PADDING_X_MAX))
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.wordHighlightPaddingX,
    wordHighlightPaddingY: Number.isFinite(wordHighlightPaddingY)
      ? Math.round(clampStoryOverlayNumber(wordHighlightPaddingY, STORY_TEXT_OVERLAY_HIGHLIGHT_PADDING_Y_MIN, STORY_TEXT_OVERLAY_HIGHLIGHT_PADDING_Y_MAX))
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.wordHighlightPaddingY,
    wordHighlightBorderRadius: Number.isFinite(wordHighlightBorderRadius)
      ? Math.round(clampStoryOverlayNumber(wordHighlightBorderRadius, STORY_TEXT_OVERLAY_HIGHLIGHT_RADIUS_MIN, STORY_TEXT_OVERLAY_HIGHLIGHT_RADIUS_MAX))
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.wordHighlightBorderRadius,
    wordHighlightWordSpacing: Number.isFinite(wordHighlightWordSpacing)
      ? Math.round(clampStoryOverlayNumber(wordHighlightWordSpacing, STORY_TEXT_OVERLAY_HIGHLIGHT_WORD_SPACING_MIN, STORY_TEXT_OVERLAY_HIGHLIGHT_WORD_SPACING_MAX))
      : DEFAULT_STORY_TEXT_OVERLAY_STYLE.wordHighlightWordSpacing,
  };
}
