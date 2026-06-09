import type { PlanKey } from '@/lib/types/pricing';

export const REEL_VISUAL_STYLE_STATUSES = ['draft', 'published', 'archived'] as const;
export type ReelVisualStyleStatus = (typeof REEL_VISUAL_STYLE_STATUSES)[number];

export interface ReelTextOverlayStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  color?: string;
  textOpacity?: number;
  shadowColor?: string;
  shadowBlur?: number;
  backgroundColor?: string;
  backgroundOpacity?: number;
  backgroundBlur?: number;
  position?: 'lower' | 'middle' | 'upper';
  verticalOffset?: number;
  align?: 'left' | 'center' | 'right';
  wordHighlightColor?: string;
  wordHighlightOpacity?: number;
  wordHighlightPaddingX?: number;
  wordHighlightPaddingY?: number;
  wordHighlightBorderRadius?: number;
  wordHighlightWordSpacing?: number;
}

export interface ReelVisualStyleRecord {
  id: string;
  name: string;
  slug: string;
  status: ReelVisualStyleStatus;
  minPlan: PlanKey;
  promptDefiner: string;
  sampleImageUrl: string | null;
  sampleR2ObjectKey: string | null;
  sampleR2Bucket: string | null;
  thumbnailUrl: string | null;
  thumbnailR2ObjectKey: string | null;
  thumbnailR2Bucket: string | null;
  textOverlayStyle: ReelTextOverlayStyle;
  noFaceDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ReelVisualStyleCard extends ReelVisualStyleRecord {
  isLocked: boolean;
}

export interface ReelVisualStyleRuntime {
  id: string;
  name: string;
  slug: string;
  minPlan: PlanKey;
  promptDefiner: string;
  textOverlayStyle: ReelTextOverlayStyle;
  noFaceDefault: boolean;
}

export const REEL_TEXT_FONT_PRESETS = [
  { label: 'Inter', value: 'var(--font-sans), Inter, system-ui, sans-serif', languages: ['english'] },
  { label: 'Playfair', value: 'var(--font-serif), Georgia, Cambria, serif', languages: ['english'] },
  { label: 'Bebas', value: 'var(--font-reel-bebas), Impact, sans-serif', languages: ['english'] },
  { label: 'Oswald', value: 'var(--font-reel-oswald), Arial Narrow, sans-serif', languages: ['english'] },
  { label: 'Montserrat', value: 'var(--font-reel-montserrat), Arial, sans-serif', languages: ['english'] },
  { label: 'Poppins', value: 'var(--font-reel-poppins), Arial, sans-serif', languages: ['english'] },
  { label: 'Lora', value: 'var(--font-reel-lora), Georgia, serif', languages: ['english'] },
  { label: 'Noto Sans Devanagari', value: 'var(--font-reel-noto-sans-devanagari), Noto Sans Devanagari, sans-serif', languages: ['hindi'] },
  { label: 'Noto Serif Devanagari', value: 'var(--font-reel-noto-serif-devanagari), Noto Serif Devanagari, serif', languages: ['hindi'] },
  { label: 'Noto Sans Bengali', value: 'var(--font-reel-noto-sans-bengali), Noto Sans Bengali, sans-serif', languages: ['bangla'] },
  { label: 'Noto Serif Bengali', value: 'var(--font-reel-noto-serif-bengali), Noto Serif Bengali, serif', languages: ['bangla'] },
  { label: 'Noto Nastaliq Urdu', value: 'var(--font-reel-noto-nastaliq-urdu), Noto Nastaliq Urdu, serif', languages: ['urdu'] },
  { label: 'Noto Sans Arabic', value: 'var(--font-reel-noto-sans-arabic), Noto Sans Arabic, sans-serif', languages: ['urdu'] },
  { label: 'Noto Sans Gujarati', value: 'var(--font-reel-noto-sans-gujarati), Noto Sans Gujarati, sans-serif', languages: ['gujarati'] },
  { label: 'Noto Serif Gujarati', value: 'var(--font-reel-noto-serif-gujarati), Noto Serif Gujarati, serif', languages: ['gujarati'] },
] as const;

export const DEFAULT_REEL_TEXT_OVERLAY_STYLE: Required<ReelTextOverlayStyle> = {
  fontFamily: REEL_TEXT_FONT_PRESETS[0].value,
  fontSize: 16,
  fontWeight: 600,
  color: '#ffffff',
  textOpacity: 1,
  shadowColor: 'rgba(0,0,0,0.72)',
  shadowBlur: 14,
  backgroundColor: '#000000',
  backgroundOpacity: 0.32,
  backgroundBlur: 4,
  position: 'lower',
  verticalOffset: 0,
  align: 'center',
  wordHighlightColor: '#C65A2E',
  wordHighlightOpacity: 0.72,
  wordHighlightPaddingX: 3,
  wordHighlightPaddingY: 1,
  wordHighlightBorderRadius: 4,
  wordHighlightWordSpacing: 4,
};

const REEL_TEXT_FONT_LANGUAGE_FALLBACK = 'english';

function normalizeReelTextFontLanguage(language: string | null | undefined): string {
  return REEL_TEXT_FONT_PRESETS.some((font) => font.languages.includes(language as never))
    ? String(language)
    : REEL_TEXT_FONT_LANGUAGE_FALLBACK;
}

export function getReelTextFontPresetsForLanguage(language: string | null | undefined) {
  const normalizedLanguage = normalizeReelTextFontLanguage(language);
  const fonts = REEL_TEXT_FONT_PRESETS.filter((font) => font.languages.includes(normalizedLanguage as never));
  return fonts.length > 0 ? fonts : REEL_TEXT_FONT_PRESETS.filter((font) => font.languages.includes(REEL_TEXT_FONT_LANGUAGE_FALLBACK as never));
}

export function getDefaultReelTextFontFamilyForLanguage(language: string | null | undefined): string {
  return getReelTextFontPresetsForLanguage(language)[0]?.value ?? DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontFamily;
}

export function isReelTextFontFamilyCompatibleWithLanguage(
  fontFamily: string | null | undefined,
  language: string | null | undefined
): boolean {
  if (!fontFamily) return false;
  return getReelTextFontPresetsForLanguage(language).some((font) => font.value === fontFamily);
}

export const REEL_CAPTION_VERTICAL_OFFSET_MIN = -30;
export const REEL_CAPTION_VERTICAL_OFFSET_MAX = 30;
export const REEL_CAPTION_BACKGROUND_BLUR_MIN = 0;
export const REEL_CAPTION_BACKGROUND_BLUR_MAX = 24;
export const REEL_WORD_HIGHLIGHT_PADDING_X_MIN = 0;
export const REEL_WORD_HIGHLIGHT_PADDING_X_MAX = 18;
export const REEL_WORD_HIGHLIGHT_PADDING_Y_MIN = 0;
export const REEL_WORD_HIGHLIGHT_PADDING_Y_MAX = 12;
export const REEL_WORD_HIGHLIGHT_RADIUS_MIN = 0;
export const REEL_WORD_HIGHLIGHT_RADIUS_MAX = 24;
export const REEL_WORD_HIGHLIGHT_WORD_SPACING_MIN = 0;
export const REEL_WORD_HIGHLIGHT_WORD_SPACING_MAX = 28;
export const REEL_CAPTION_TOP_SAFE_MIN = 12;
export const REEL_CAPTION_TOP_SAFE_MAX = 88;

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampUnit(value: number): number {
  return clampNumber(value, 0, 1);
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function compactFontFamily(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function normalizeReelTextFontFamily(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontFamily;
  }

  const fontFamily = value.trim();
  if (REEL_TEXT_FONT_PRESETS.some((font) => font.value === fontFamily)) {
    return fontFamily;
  }

  const legacyAliases = [
    { legacy: 'Inter, system-ui, sans-serif', preset: REEL_TEXT_FONT_PRESETS[0].value },
    { legacy: 'Georgia, Cambria, Times New Roman, serif', preset: REEL_TEXT_FONT_PRESETS[1].value },
    { legacy: 'Georgia, Cambria, serif', preset: REEL_TEXT_FONT_PRESETS[1].value },
    { legacy: 'Arial, Helvetica, sans-serif', preset: REEL_TEXT_FONT_PRESETS[4].value },
    { legacy: 'Verdana, Geneva, sans-serif', preset: REEL_TEXT_FONT_PRESETS[5].value },
  ];
  const compact = compactFontFamily(fontFamily);
  const match = legacyAliases.find((alias) => compactFontFamily(alias.legacy) === compact);
  return match?.preset ?? fontFamily;
}

export function reelColorToRgb(color: string | undefined): [number, number, number] | null {
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
      clampNumber(Math.round(Number(rgb[1])), 0, 255),
      clampNumber(Math.round(Number(rgb[2])), 0, 255),
      clampNumber(Math.round(Number(rgb[3])), 0, 255),
    ];
  }

  return null;
}

export function reelRgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => clampNumber(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

export function reelColorWithOpacity(color: string | undefined, opacity: number | undefined): string {
  const alpha = clampUnit(Number.isFinite(Number(opacity)) ? Number(opacity) : 1);
  if (alpha <= 0) return 'transparent';
  const source = color?.trim() || '#000000';
  const rgb = reelColorToRgb(source);
  if (rgb) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${roundToTwo(alpha)})`;
  }
  return alpha >= 1 ? source : `color-mix(in srgb, ${source} ${Math.round(alpha * 100)}%, transparent)`;
}

export function reelColorInputValue(color: string | undefined, fallback = '#000000'): string {
  const rgb = reelColorToRgb(color);
  if (!rgb) return fallback;
  return reelRgbToHex(rgb);
}

export function getReelCaptionAnchorPercent(position: ReelTextOverlayStyle['position']): number {
  if (position === 'upper') return 20;
  if (position === 'middle') return 50;
  return 80;
}

export function getReelCaptionTopPercent(style: ReelTextOverlayStyle): number {
  const normalized = normalizeReelTextOverlayStyle(style);
  return clampNumber(
    getReelCaptionAnchorPercent(normalized.position) + (normalized.verticalOffset ?? 0),
    REEL_CAPTION_TOP_SAFE_MIN,
    REEL_CAPTION_TOP_SAFE_MAX
  );
}

const PLAN_RANK: Record<PlanKey, number> = {
  free: 0,
  plus: 1,
  studio: 2,
};

export function normalizePlanKey(value: unknown): PlanKey {
  return value === 'plus' || value === 'studio' ? value : 'free';
}

export function canUseReelVisualStyle(userPlan: PlanKey | string | null | undefined, minPlan: PlanKey | string | null | undefined): boolean {
  const current = normalizePlanKey(userPlan);
  const required = normalizePlanKey(minPlan);
  return PLAN_RANK[current] >= PLAN_RANK[required];
}

export function normalizeReelTextOverlayStyle(value: unknown): ReelTextOverlayStyle {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const position = raw.position === 'upper' || raw.position === 'middle' || raw.position === 'lower'
    ? raw.position
    : DEFAULT_REEL_TEXT_OVERLAY_STYLE.position;
  const align = raw.align === 'left' || raw.align === 'right' || raw.align === 'center'
    ? raw.align
    : DEFAULT_REEL_TEXT_OVERLAY_STYLE.align;
  const fontSize = Number(raw.fontSize);
  const textOpacity = Number(raw.textOpacity);
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
    fontFamily: normalizeReelTextFontFamily(raw.fontFamily),
    fontSize: Number.isFinite(fontSize)
      ? Math.max(8, Math.min(80, Math.round(fontSize)))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontSize,
    fontWeight: typeof raw.fontWeight === 'string' || typeof raw.fontWeight === 'number'
      ? raw.fontWeight
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.fontWeight,
    color: typeof raw.color === 'string' && raw.color.trim()
      ? raw.color.trim()
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.color,
    textOpacity: Number.isFinite(textOpacity)
      ? clampUnit(textOpacity)
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.textOpacity,
    shadowColor: typeof raw.shadowColor === 'string' && raw.shadowColor.trim()
      ? raw.shadowColor.trim()
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.shadowColor,
    shadowBlur: Number.isFinite(shadowBlur)
      ? Math.max(0, Math.min(40, Math.round(shadowBlur)))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.shadowBlur,
    backgroundColor: typeof raw.backgroundColor === 'string' && raw.backgroundColor.trim()
      ? raw.backgroundColor.trim()
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.backgroundColor,
    backgroundOpacity: Number.isFinite(backgroundOpacity)
      ? Math.max(0, Math.min(1, backgroundOpacity))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.backgroundOpacity,
    backgroundBlur: Number.isFinite(backgroundBlur)
      ? Math.round(clampNumber(backgroundBlur, REEL_CAPTION_BACKGROUND_BLUR_MIN, REEL_CAPTION_BACKGROUND_BLUR_MAX))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.backgroundBlur,
    position,
    verticalOffset: Number.isFinite(verticalOffset)
      ? Math.round(clampNumber(verticalOffset, REEL_CAPTION_VERTICAL_OFFSET_MIN, REEL_CAPTION_VERTICAL_OFFSET_MAX))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.verticalOffset,
    align,
    wordHighlightColor: typeof raw.wordHighlightColor === 'string' && raw.wordHighlightColor.trim()
      ? raw.wordHighlightColor.trim()
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightColor,
    wordHighlightOpacity: Number.isFinite(wordHighlightOpacity)
      ? Math.max(0, Math.min(1, wordHighlightOpacity))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightOpacity,
    wordHighlightPaddingX: Number.isFinite(wordHighlightPaddingX)
      ? Math.round(clampNumber(wordHighlightPaddingX, REEL_WORD_HIGHLIGHT_PADDING_X_MIN, REEL_WORD_HIGHLIGHT_PADDING_X_MAX))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightPaddingX,
    wordHighlightPaddingY: Number.isFinite(wordHighlightPaddingY)
      ? Math.round(clampNumber(wordHighlightPaddingY, REEL_WORD_HIGHLIGHT_PADDING_Y_MIN, REEL_WORD_HIGHLIGHT_PADDING_Y_MAX))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightPaddingY,
    wordHighlightBorderRadius: Number.isFinite(wordHighlightBorderRadius)
      ? Math.round(clampNumber(wordHighlightBorderRadius, REEL_WORD_HIGHLIGHT_RADIUS_MIN, REEL_WORD_HIGHLIGHT_RADIUS_MAX))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightBorderRadius,
    wordHighlightWordSpacing: Number.isFinite(wordHighlightWordSpacing)
      ? Math.round(clampNumber(wordHighlightWordSpacing, REEL_WORD_HIGHLIGHT_WORD_SPACING_MIN, REEL_WORD_HIGHLIGHT_WORD_SPACING_MAX))
      : DEFAULT_REEL_TEXT_OVERLAY_STYLE.wordHighlightWordSpacing,
  };
}

export function mapReelVisualStyleRow(row: Record<string, unknown>): ReelVisualStyleRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? 'Untitled style'),
    slug: String(row.slug ?? ''),
    status: row.status === 'published' || row.status === 'archived' ? row.status : 'draft',
    minPlan: normalizePlanKey(row.min_plan),
    promptDefiner: String(row.prompt_definer ?? ''),
    sampleImageUrl: typeof row.sample_image_url === 'string' ? row.sample_image_url : null,
    sampleR2ObjectKey: typeof row.sample_r2_object_key === 'string' ? row.sample_r2_object_key : null,
    sampleR2Bucket: typeof row.sample_r2_bucket === 'string' ? row.sample_r2_bucket : null,
    thumbnailUrl: typeof row.thumbnail_url === 'string' ? row.thumbnail_url : null,
    thumbnailR2ObjectKey: typeof row.thumbnail_r2_object_key === 'string' ? row.thumbnail_r2_object_key : null,
    thumbnailR2Bucket: typeof row.thumbnail_r2_bucket === 'string' ? row.thumbnail_r2_bucket : null,
    textOverlayStyle: normalizeReelTextOverlayStyle(row.text_overlay_style),
    noFaceDefault: row.no_face_default !== false,
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
  };
}
