import type { PlanKey } from '@/lib/types/pricing';

export const REEL_LENGTH_KEYS = ['short', 'medium', 'long'] as const;
export type ReelLengthKey = (typeof REEL_LENGTH_KEYS)[number];
export const REEL_TEXT_LENGTH_KEYS = ['short', 'medium', 'long'] as const;
export type ReelTextLengthKey = (typeof REEL_TEXT_LENGTH_KEYS)[number];

export const REEL_LENGTH_BEAT_COUNTS: Record<ReelLengthKey, number> = {
  short: 1,
  medium: 2,
  long: 3,
};

export interface ReelDefiner {
  key: string;
  label: string;
  prompt: string;
}

export interface ReelRetentionDays {
  free: number;
  plus: number;
  studio: number;
}

export interface ReelTextLengthWordRange {
  min: number;
  max: number;
}

export interface ReelTextLengthWordRanges {
  short: ReelTextLengthWordRange;
  medium: ReelTextLengthWordRange;
  long: ReelTextLengthWordRange;
}

export interface ReelElevenLabsSettings {
  enabled: boolean;
  voiceId: string;
  modelId: string;
}

export interface ReelStorySettings {
  /**
   * Legacy user-facing length key. Existing saved reels keep reading this.
   * New reels use defaultBeatCount + defaultTextLength.
   */
  defaultLength: ReelLengthKey;
  defaultBeatCount: 1 | 2 | 3;
  defaultTextLength: ReelTextLengthKey;
  textOverlayDefault: boolean;
  defaultMood: string;
  defaultVisualStyle: string;
  defaultNarrationStyle: string;
  panelCount: 4;
  retentionDays: ReelRetentionDays;
  textLengthWordRanges: ReelTextLengthWordRanges;
  elevenLabs: ReelElevenLabsSettings;
  moods: ReelDefiner[];
  visualStyles: ReelDefiner[];
  narrationStyles: ReelDefiner[];
}

export interface ReelStorySetupSettings {
  enabled: boolean;
  publishEnabled: boolean;
  settings: ReelStorySettings;
}

export const DEFAULT_REEL_STORY_SETTINGS: ReelStorySettings = {
  defaultLength: 'medium',
  defaultBeatCount: 2,
  defaultTextLength: 'medium',
  textOverlayDefault: true,
  defaultMood: 'playful',
  defaultVisualStyle: 'cinematic',
  defaultNarrationStyle: 'expressive',
  panelCount: 4,
  retentionDays: {
    free: 30,
    plus: 90,
    studio: 180,
  },
  textLengthWordRanges: {
    short: { min: 4, max: 8 },
    medium: { min: 8, max: 12 },
    long: { min: 12, max: 16 },
  },
  elevenLabs: {
    enabled: true,
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
    modelId: 'eleven_multilingual_v2',
  },
  moods: [
    { key: 'playful', label: 'Playful', prompt: 'bright, curious, quick emotional turns' },
    { key: 'cozy', label: 'Cozy', prompt: 'warm, intimate, gentle emotional rhythm' },
    { key: 'epic', label: 'Epic', prompt: 'bold, cinematic, adventurous stakes' },
  ],
  visualStyles: [
    { key: 'cinematic', label: 'Cinematic', prompt: 'cinematic storybook frames with expressive lighting' },
    { key: 'anime', label: 'Anime', prompt: 'clean anime cel framing with expressive characters' },
    { key: 'storybook', label: 'Storybook', prompt: 'painterly storybook frames with warm character appeal' },
  ],
  narrationStyles: [
    { key: 'expressive', label: 'Expressive', prompt: 'expressive narrator with natural pauses and energy' },
    { key: 'gentle', label: 'Gentle', prompt: 'soft, warm, reassuring narration' },
    { key: 'dramatic', label: 'Dramatic', prompt: 'dramatic narration with suspense and momentum' },
  ],
};

function cleanKey(value: unknown, fallback: string): string {
  const next = typeof value === 'string' ? value.trim() : '';
  return next || fallback;
}

function normalizeDefiners(value: unknown, fallback: ReelDefiner[]): ReelDefiner[] {
  if (!Array.isArray(value)) return fallback;
  const definers = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Record<string, unknown>;
      const key = cleanKey(raw.key, '');
      const label = cleanKey(raw.label, key);
      const prompt = cleanKey(raw.prompt, '');
      if (!key || !label || !prompt) return null;
      return { key, label, prompt };
    })
    .filter((entry): entry is ReelDefiner => Boolean(entry));
  return definers.length > 0 ? definers : fallback;
}

function normalizeRetentionDays(value: unknown): ReelRetentionDays {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    free: normalizeRetentionNumber(raw.free, DEFAULT_REEL_STORY_SETTINGS.retentionDays.free),
    plus: normalizeRetentionNumber(raw.plus, DEFAULT_REEL_STORY_SETTINGS.retentionDays.plus),
    studio: normalizeRetentionNumber(raw.studio, DEFAULT_REEL_STORY_SETTINGS.retentionDays.studio),
  };
}

function normalizeRetentionNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(3650, Math.round(parsed)));
}

function normalizeBeatCount(value: unknown, fallback: 1 | 2 | 3): 1 | 2 | 3 {
  const parsed = Number(value);
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  return fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function normalizeTextLengthRange(value: unknown, fallback: ReelTextLengthWordRange): ReelTextLengthWordRange {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const min = Number(raw.min);
  const max = Number(raw.max);
  const normalizedMin = Number.isFinite(min) ? Math.max(1, Math.min(200, Math.round(min))) : fallback.min;
  const normalizedMax = Number.isFinite(max) ? Math.max(normalizedMin, Math.min(240, Math.round(max))) : fallback.max;
  return {
    min: normalizedMin,
    max: normalizedMax,
  };
}

function normalizeTextLengthWordRanges(value: unknown): ReelTextLengthWordRanges {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    short: normalizeTextLengthRange(raw.short, DEFAULT_REEL_STORY_SETTINGS.textLengthWordRanges.short),
    medium: normalizeTextLengthRange(raw.medium, DEFAULT_REEL_STORY_SETTINGS.textLengthWordRanges.medium),
    long: normalizeTextLengthRange(raw.long, DEFAULT_REEL_STORY_SETTINGS.textLengthWordRanges.long),
  };
}

function normalizeElevenLabsSettings(value: unknown): ReelElevenLabsSettings {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: normalizeBoolean(raw.enabled, DEFAULT_REEL_STORY_SETTINGS.elevenLabs.enabled),
    voiceId: cleanKey(raw.voiceId, DEFAULT_REEL_STORY_SETTINGS.elevenLabs.voiceId),
    modelId: cleanKey(raw.modelId, DEFAULT_REEL_STORY_SETTINGS.elevenLabs.modelId),
  };
}

export function normalizeReelLength(value: unknown): ReelLengthKey {
  return REEL_LENGTH_KEYS.includes(value as ReelLengthKey)
    ? value as ReelLengthKey
    : DEFAULT_REEL_STORY_SETTINGS.defaultLength;
}

export function normalizeReelTextLength(value: unknown): ReelTextLengthKey {
  return REEL_TEXT_LENGTH_KEYS.includes(value as ReelTextLengthKey)
    ? value as ReelTextLengthKey
    : DEFAULT_REEL_STORY_SETTINGS.defaultTextLength;
}

export function normalizeReelStorySettings(input: unknown): ReelStorySettings {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const moods = normalizeDefiners(raw.moods, DEFAULT_REEL_STORY_SETTINGS.moods);
  const visualStyles = normalizeDefiners(raw.visualStyles, DEFAULT_REEL_STORY_SETTINGS.visualStyles);
  const narrationStyles = normalizeDefiners(raw.narrationStyles, DEFAULT_REEL_STORY_SETTINGS.narrationStyles);
  const defaultLength = normalizeReelLength(raw.defaultLength);
  const defaultBeatCount = normalizeBeatCount(
    raw.defaultBeatCount,
    getReelLengthBeatCount(defaultLength) as 1 | 2 | 3
  );
  const defaultMood = moods.some((item) => item.key === raw.defaultMood)
    ? raw.defaultMood as string
    : moods[0]?.key || DEFAULT_REEL_STORY_SETTINGS.defaultMood;
  const defaultVisualStyle = visualStyles.some((item) => item.key === raw.defaultVisualStyle)
    ? raw.defaultVisualStyle as string
    : visualStyles[0]?.key || DEFAULT_REEL_STORY_SETTINGS.defaultVisualStyle;
  const defaultNarrationStyle = narrationStyles.some((item) => item.key === raw.defaultNarrationStyle)
    ? raw.defaultNarrationStyle as string
    : narrationStyles[0]?.key || DEFAULT_REEL_STORY_SETTINGS.defaultNarrationStyle;

  return {
    defaultLength,
    defaultBeatCount,
    defaultTextLength: normalizeReelTextLength(raw.defaultTextLength ?? defaultLength),
    textOverlayDefault: normalizeBoolean(raw.textOverlayDefault, DEFAULT_REEL_STORY_SETTINGS.textOverlayDefault),
    defaultMood,
    defaultVisualStyle,
    defaultNarrationStyle,
    panelCount: 4,
    retentionDays: normalizeRetentionDays(raw.retentionDays),
    textLengthWordRanges: normalizeTextLengthWordRanges(raw.textLengthWordRanges),
    elevenLabs: normalizeElevenLabsSettings(raw.elevenLabs),
    moods,
    visualStyles,
    narrationStyles,
  };
}

export function parseReelStorySettingsValue(value: string | null | undefined): ReelStorySettings {
  if (!value?.trim()) return DEFAULT_REEL_STORY_SETTINGS;
  try {
    return normalizeReelStorySettings(JSON.parse(value));
  } catch {
    return DEFAULT_REEL_STORY_SETTINGS;
  }
}

export function serializeReelStorySettings(settings: ReelStorySettings): string {
  return JSON.stringify(normalizeReelStorySettings(settings), null, 2);
}

export function getReelLengthBeatCount(length: ReelLengthKey): number {
  return REEL_LENGTH_BEAT_COUNTS[length] ?? REEL_LENGTH_BEAT_COUNTS.short;
}

export function getReelLegacyLengthForBeatCount(beatCount: number): ReelLengthKey {
  if (beatCount >= 3) return 'long';
  if (beatCount === 2) return 'medium';
  return 'short';
}

export function getReelTextLengthRange(settings: ReelStorySettings, textLength: ReelTextLengthKey): ReelTextLengthWordRange {
  return settings.textLengthWordRanges[textLength] ?? DEFAULT_REEL_STORY_SETTINGS.textLengthWordRanges[textLength];
}

export function getReelRetentionDaysForPlan(settings: ReelStorySettings, planKey: PlanKey | string | null | undefined): number {
  if (planKey === 'studio') return settings.retentionDays.studio;
  if (planKey === 'plus') return settings.retentionDays.plus;
  return settings.retentionDays.free;
}

export function findReelDefiner(definers: ReelDefiner[], key: string | null | undefined): ReelDefiner {
  return definers.find((item) => item.key === key) ?? definers[0] ?? { key: 'default', label: 'Default', prompt: 'clear reel-friendly pacing' };
}

