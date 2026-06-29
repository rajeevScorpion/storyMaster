import type {
  ImageModelSelection,
  ImageTaskKey,
} from '@/lib/ai/image-models.shared';
import type {
  PortraitReferenceConfig,
  PortraitReferenceQuality,
  PortraitReferenceMode,
  ReelStoryConfig,
  SeedBeatOutline,
  SeedPlan,
  StoryAuthoringConfig,
  StoryConfig,
  StoryLanguage,
  StoryDetailLevel,
  StoryPalette,
  SourceFidelity,
  StoryTheme,
  VisualSettings,
  VisualStylePreset,
} from '@/lib/types/story';
import {
  DEFAULT_REEL_STORY_SETTINGS,
  getReelLegacyLengthForBeatCount,
  getReelLengthBeatCount,
  normalizeReelLength,
  normalizeReelTextLength,
} from '@/lib/reel/settings';
import { normalizeReelNarrationSettings } from '@/lib/reel/narration';
import { normalizeReelTextOverlayStyle } from '@/lib/reel/styles';
import { DEFAULT_REEL_TRANSITION_SETTINGS, normalizeReelTransitionSettings } from '@/lib/reel/transitions';
import { normalizeStoryTextOverlayMode } from '@/lib/story-overlay/captions';
import {
  DEFAULT_STORY_TEXT_OVERLAY_STYLE,
  normalizeStoryTextOverlayStyle,
} from '@/lib/story-overlay/styles';
import {
  DEFAULT_STORY_TRANSITION_SETTINGS,
  normalizeStoryTransitionSettings,
} from '@/lib/story-transitions/settings';
import type {
  NarrationGenderBucket,
  NarrationLanguageCode,
  NarrationVoiceMode,
  StoryNarrationVoiceSelection,
} from '@/lib/ai/narration-voices';

export const VISUAL_PRESET_OPTIONS: Array<{ value: VisualStylePreset; label: string; description: string }> = [
  { value: 'storybook_illustration', label: 'Storybook Illustration', description: 'Painterly storybook frames with warm character appeal.' },
  { value: 'watercolor_fable', label: 'Watercolor Fable', description: 'Soft watercolor washes with dreamy edges and gentle textures.' },
  { value: 'anime_cel', label: 'Anime Cel', description: 'Clean linework, expressive faces, and bold cel-shaded lighting.' },
  { value: 'graphic_novel', label: 'Graphic Novel', description: 'Ink-forward panels with dramatic contrast and bold silhouettes.' },
  { value: 'three_d_animated', label: '3D Animated', description: 'Polished animated-film look with dimensional characters and staging.' },
  { value: 'cinematic_photo', label: 'Cinematic Photo', description: 'Stylized cinematic realism with controlled lighting and atmosphere.' },
];

export const STORY_THEME_OPTIONS: Array<{ value: StoryTheme; label: string }> = [
  { value: 'whimsical', label: 'Whimsical' },
  { value: 'cozy', label: 'Cozy' },
  { value: 'epic', label: 'Epic' },
  { value: 'mysterious', label: 'Mysterious' },
  { value: 'dark_fantasy', label: 'Dark Fantasy' },
  { value: 'futuristic', label: 'Futuristic' },
];

export const STORY_PALETTE_OPTIONS: Array<{ value: StoryPalette; label: string }> = [
  { value: 'warm', label: 'Warm' },
  { value: 'vibrant', label: 'Vibrant' },
  { value: 'pastel', label: 'Pastel' },
  { value: 'moody', label: 'Moody' },
  { value: 'earthy', label: 'Earthy' },
  { value: 'neon', label: 'Neon' },
];

export const STORY_DETAIL_OPTIONS: Array<{ value: StoryDetailLevel; label: string }> = [
  { value: 'simple', label: 'Simple' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'lush', label: 'Lush' },
];

export const STORY_LANGUAGE_OPTIONS: Array<{ value: Extract<StoryLanguage, 'english' | 'hindi'>; label: string }> = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi' },
];

export const REEL_LANGUAGE_OPTIONS: Array<{ value: StoryLanguage; label: string }> = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'bangla', label: 'Bangla' },
  { value: 'urdu', label: 'Urdu' },
  { value: 'gujarati', label: 'Gujarati' },
];

export const SOURCE_FIDELITY_OPTIONS: Array<{
  value: SourceFidelity;
  label: string;
  description: string;
}> = [
  {
    value: 'preserve_closely',
    label: 'Preserve Closely',
    description: 'Stay as close as possible to the source wording and scene intent while structuring it into beats.',
  },
  {
    value: 'balanced_adaptation',
    label: 'Balanced Adaptation',
    description: 'Smooth pacing and clarity while keeping the original story arc and character intent intact.',
  },
  {
    value: 'creative_expansion',
    label: 'Creative Expansion',
    description: 'Allow a little more dramatic shaping and scene expansion while staying faithful to the core story.',
  },
];

export const DEFAULT_VISUAL_SETTINGS: VisualSettings = {
  preset: 'storybook_illustration',
  theme: 'whimsical',
  palette: 'warm',
  detail: 'balanced',
};

export const DEFAULT_AUTHORING: StoryAuthoringConfig = {
  mode: 'prompt',
  preludeText: '',
  workingTitle: '',
  sourceText: '',
  guidanceText: '',
  sourceFidelity: 'balanced_adaptation',
  seedPlan: undefined,
};

export const DEFAULT_PORTRAIT_REFERENCE_CONFIG: PortraitReferenceConfig = {
  mode: 'single_portrait',
  quality: '0.5K',
};

export const DEFAULT_REEL_CONFIG: ReelStoryConfig = {
  length: DEFAULT_REEL_STORY_SETTINGS.defaultLength,
  beatCount: DEFAULT_REEL_STORY_SETTINGS.defaultBeatCount,
  textLength: DEFAULT_REEL_STORY_SETTINGS.defaultTextLength,
  textOverlayEnabled: DEFAULT_REEL_STORY_SETTINGS.textOverlayDefault,
  visualStyleId: null,
  textOverlayStyle: normalizeReelTextOverlayStyle(null),
  transitionSettings: DEFAULT_REEL_TRANSITION_SETTINGS,
  moodKey: DEFAULT_REEL_STORY_SETTINGS.defaultMood,
  visualStyleKey: DEFAULT_REEL_STORY_SETTINGS.defaultVisualStyle,
  narrationStyleKey: DEFAULT_REEL_STORY_SETTINGS.defaultNarrationStyle,
  narrationSettings: normalizeReelNarrationSettings(null, {
    storyLanguage: 'english',
    adminSettings: DEFAULT_REEL_STORY_SETTINGS.narration,
  }),
  brandingEnabled: true,
};

export const DEFAULT_STORY_TEXT_OVERLAY_CONFIG: StoryConfig['storyTextOverlay'] = {
  enabled: true,
  mode: 'word',
  style: normalizeStoryTextOverlayStyle(DEFAULT_STORY_TEXT_OVERLAY_STYLE),
};

export const DEFAULT_STORY_CONFIG: StoryConfig = {
  storyKind: 'story',
  language: 'english',
  ageGroup: 'all_ages',
  settingCountry: 'generic',
  maxBeats: 6,
  imageGenerationMode: 'prompt_only',
  isVerticalStory: false,
  aspectRatio: '16:9',
  visualSettings: DEFAULT_VISUAL_SETTINGS,
  authoring: DEFAULT_AUTHORING,
  reel: DEFAULT_REEL_CONFIG,
  storyTextOverlay: DEFAULT_STORY_TEXT_OVERLAY_CONFIG,
  storyTransition: DEFAULT_STORY_TRANSITION_SETTINGS,
  portraitReferences: DEFAULT_PORTRAIT_REFERENCE_CONFIG,
};

const PRESET_SUMMARIES: Record<VisualStylePreset, string> = {
  storybook_illustration: 'storybook illustration with painterly textures and expressive character acting',
  watercolor_fable: 'watercolor fable art with soft pigments, delicate edges, and airy paper texture',
  anime_cel: 'anime cel art with crisp linework, expressive faces, and confident shape language',
  graphic_novel: 'graphic novel art with bold inks, strong contrast, and cinematic framing',
  three_d_animated: '3D animated film art with dimensional characters and polished lighting',
  cinematic_photo: 'cinematic photo-real rendering with stylized realism and controlled depth',
};

const THEME_SUMMARIES: Record<StoryTheme, string> = {
  whimsical: 'whimsical and playful emotional tone',
  cozy: 'cozy and intimate emotional tone',
  epic: 'epic and adventurous emotional tone',
  mysterious: 'mysterious and discovery-driven emotional tone',
  dark_fantasy: 'dark fantasy emotional tone with elegant unease',
  futuristic: 'futuristic emotional tone with forward-looking imagination',
};

const PALETTE_SUMMARIES: Record<StoryPalette, string> = {
  warm: 'warm color palette with sunlit golds, ambers, and rich reds',
  vibrant: 'vibrant color palette with saturated color separation',
  pastel: 'pastel color palette with soft tonal transitions',
  moody: 'moody color palette with deep shadows and selective highlights',
  earthy: 'earthy color palette with natural greens, browns, and mineral tones',
  neon: 'neon color palette with luminous accents and graphic contrast',
};

const DETAIL_SUMMARIES: Record<StoryDetailLevel, string> = {
  simple: 'clean visual detail with readable shapes and restrained background complexity',
  balanced: 'balanced visual detail with readable characters and selective environment richness',
  lush: 'lush visual detail with layered environments, material texture, and cinematic atmosphere',
};

type RawStoryConfig = Partial<StoryConfig> & {
  storyKind?: string | null;
  story_kind?: string | null;
  is_vertical_story?: boolean | null;
  aspect_ratio?: string | null;
  visualSettings?: Partial<VisualSettings> | null;
  imageModelSelection?: Partial<ImageModelSelection> | null;
  image_model_selection?: Partial<ImageModelSelection> | null;
  authoring?: (Partial<StoryAuthoringConfig> & {
    mode?: string | null;
    preludeText?: string | null;
  }) | null;
  reel?: Partial<ReelStoryConfig> | null;
  storyTextOverlay?: Partial<StoryConfig['storyTextOverlay']> | null;
  storyTransition?: Partial<StoryConfig['storyTransition']> | null;
  portraitReferences?: Partial<PortraitReferenceConfig> | null;
  narrationVoice?: Partial<StoryNarrationVoiceSelection> | null;
};

export function normalizeStoryConfig(input?: RawStoryConfig | null): StoryConfig {
  const storyKind = normalizeStoryKind(input?.storyKind ?? input?.story_kind);
  const reel = normalizeReelConfig(input?.reel, input?.language);
  const visualSettings: VisualSettings = {
    preset: input?.visualSettings?.preset || DEFAULT_VISUAL_SETTINGS.preset,
    theme: input?.visualSettings?.theme || DEFAULT_VISUAL_SETTINGS.theme,
    palette: input?.visualSettings?.palette || DEFAULT_VISUAL_SETTINGS.palette,
    detail: input?.visualSettings?.detail || DEFAULT_VISUAL_SETTINGS.detail,
  };

  const rawAuthoring = input?.authoring;
  const legacyPreludeText = sanitizeText(rawAuthoring?.preludeText ?? DEFAULT_AUTHORING.preludeText);
  const authoringMode = normalizeAuthoringMode(rawAuthoring?.mode);
  const authoring: StoryAuthoringConfig = {
    mode: authoringMode,
    preludeText: legacyPreludeText,
    workingTitle: sanitizeText(rawAuthoring?.workingTitle),
    sourceText: authoringMode === 'seeded'
      ? sanitizeText(rawAuthoring?.sourceText ?? legacyPreludeText)
      : '',
    guidanceText: authoringMode === 'seeded'
      ? sanitizeText(rawAuthoring?.guidanceText)
      : '',
    sourceFidelity: normalizeSourceFidelity(rawAuthoring?.sourceFidelity),
    seedPlan: authoringMode === 'seeded'
      ? normalizeSeedPlan(rawAuthoring?.seedPlan)
      : undefined,
  };

  const portraitReferences = normalizePortraitReferenceConfig(input?.portraitReferences);
  const narrationVoice = normalizeNarrationVoiceSelection(input?.narrationVoice);
  const imageModelSelection = normalizeImageModelSelection(input?.imageModelSelection ?? input?.image_model_selection);
  const isVerticalStory = storyKind === 'reel' ? true : normalizeVerticalStoryFlag(input);
  const aspectRatio = isVerticalStory ? '9:16' : '16:9';
  const maxBeats = storyKind === 'reel'
    ? reel.beatCount
    : clampMaxBeats(input?.maxBeats);

  return {
    storyKind,
    language: normalizeStoryLanguage(input?.language),
    ageGroup: input?.ageGroup || DEFAULT_STORY_CONFIG.ageGroup,
    settingCountry: input?.settingCountry || DEFAULT_STORY_CONFIG.settingCountry,
    maxBeats,
    imageGenerationMode: normalizeImageGenerationMode(input?.imageGenerationMode),
    ...(imageModelSelection ? { imageModelSelection } : {}),
    isVerticalStory,
    aspectRatio,
    visualSettings,
    authoring: storyKind === 'reel' ? { mode: 'prompt' } : authoring,
    reel,
    storyTextOverlay: normalizeStoryTextOverlayConfig(input?.storyTextOverlay),
    storyTransition: normalizeStoryTransitionSettings(input?.storyTransition),
    portraitReferences,
    ...(narrationVoice ? { narrationVoice } : {}),
  };
}

function normalizeImageModelSelection(input?: Partial<ImageModelSelection> | null): ImageModelSelection | undefined {
  const modelKey = sanitizeText(input?.modelKey);
  if (!modelKey) {
    return undefined;
  }

  const taskKey = normalizeImageTaskKey(input?.taskKey);
  return {
    ...(taskKey ? { taskKey } : {}),
    modelKey,
  };
}

function normalizeImageTaskKey(value?: string | null): ImageTaskKey | undefined {
  if (value === 'image_generation' || value === 'reel_image_generation' || value === 'portrait_generation') {
    return value;
  }

  return undefined;
}

function normalizeStoryTextOverlayConfig(
  input?: Partial<StoryConfig['storyTextOverlay']> | null
): StoryConfig['storyTextOverlay'] {
  return {
    enabled: input?.enabled !== false,
    mode: normalizeStoryTextOverlayMode(input?.mode),
    style: normalizeStoryTextOverlayStyle(input?.style ?? DEFAULT_STORY_TEXT_OVERLAY_STYLE),
  };
}

export function deriveVisualStyleSummary(visualSettings?: Partial<VisualSettings> | null): string {
  const resolved: VisualSettings = {
    ...DEFAULT_VISUAL_SETTINGS,
    ...visualSettings,
  };

  return [
    PRESET_SUMMARIES[resolved.preset],
    THEME_SUMMARIES[resolved.theme],
    PALETTE_SUMMARIES[resolved.palette],
    DETAIL_SUMMARIES[resolved.detail],
  ].join(', ');
}

export function getPreludeText(config?: Partial<StoryConfig> | null): string {
  return sanitizeText(config?.authoring?.preludeText);
}

export function hasPreludeText(config?: Partial<StoryConfig> | null): boolean {
  return getPreludeText(config).length > 0;
}

export function isSeedContinueMode(config?: Partial<StoryConfig> | null): boolean {
  return normalizeStoryConfig(config).authoring.mode === 'seeded';
}

export function isSeededMode(config?: Partial<StoryConfig> | null): boolean {
  return normalizeStoryConfig(config).authoring.mode === 'seeded';
}

export function isVerticalStoryConfig(config?: Partial<StoryConfig> | null): boolean {
  return normalizeStoryConfig(config).isVerticalStory;
}

export function isReelStoryConfig(config?: Partial<StoryConfig> | null): boolean {
  return normalizeStoryConfig(config).storyKind === 'reel';
}

export function getReelMaxBeats(config?: Partial<StoryConfig> | null): number {
  const normalized = normalizeStoryConfig(config);
  return normalized.reel.beatCount;
}

export function getSeedSourceText(config?: Partial<StoryConfig> | null): string {
  return sanitizeText(config?.authoring?.sourceText);
}

export function getSeedPlan(config?: Partial<StoryConfig> | null): SeedPlan | undefined {
  return normalizeSeedPlan(config?.authoring?.seedPlan);
}

export function normalizePortraitReferenceConfig(
  input?: Partial<PortraitReferenceConfig> | null
): PortraitReferenceConfig {
  const mode = normalizePortraitReferenceMode(input?.mode);
  if (mode === 'single_portrait') {
    return {
      mode,
      quality: '0.5K',
    };
  }

  return {
    mode,
    quality: normalizePortraitReferenceQuality(input?.quality),
  };
}

function normalizeNarrationVoiceSelection(
  input?: Partial<StoryNarrationVoiceSelection> | null
): StoryNarrationVoiceSelection | undefined {
  if (!input?.mode) {
    return undefined;
  }

  const mode = normalizeNarrationVoiceMode(input.mode);
  if (mode === 'legacy_auto') {
    return { mode };
  }

  const voiceId = sanitizeText(input.voiceId);
  const genderBucket = normalizeNarrationGenderBucket(input.genderBucket);
  const languageCode = normalizeNarrationLanguageCode(input.languageCode);

  return {
    mode,
    genderBucket,
    ...(voiceId ? { voiceId } : {}),
    ...(languageCode ? { languageCode } : {}),
  };
}

function normalizeNarrationVoiceMode(value?: string | null): NarrationVoiceMode {
  return value === 'user_selected' ? 'user_selected' : 'legacy_auto';
}

function normalizeNarrationGenderBucket(value?: string | null): NarrationGenderBucket {
  return value === 'male' ? 'male' : 'female';
}

function normalizeNarrationLanguageCode(value?: string | null): NarrationLanguageCode | undefined {
  if (value === 'en-IN' || value === 'hi-IN') {
    return value;
  }

  return undefined;
}

function sanitizeText(value?: string | null): string {
  return value?.trim() || '';
}

function normalizeStoryKind(value?: string | null): StoryConfig['storyKind'] {
  return value === 'reel' ? 'reel' : 'story';
}

function normalizeStoryLanguage(value?: string | null): StoryLanguage {
  return REEL_LANGUAGE_OPTIONS.some((option) => option.value === value)
    ? value as StoryLanguage
    : DEFAULT_STORY_CONFIG.language;
}

function normalizeReelConfig(input?: Partial<ReelStoryConfig> | null, storyLanguage?: StoryConfig['language']): ReelStoryConfig {
  const legacyLength = normalizeReelLength(input?.length);
  const beatCountCandidate = Number(input?.beatCount);
  const beatCount = beatCountCandidate === 1 || beatCountCandidate === 2 || beatCountCandidate === 3
    ? beatCountCandidate
    : getReelLengthBeatCount(legacyLength) as 1 | 2 | 3;
  const length = input?.length ? legacyLength : getReelLegacyLengthForBeatCount(beatCount);

  return {
    length,
    beatCount,
    textLength: normalizeReelTextLength(input?.textLength ?? input?.length),
    textOverlayEnabled: input?.textOverlayEnabled !== false,
    visualStyleId: sanitizeText(input?.visualStyleId) || null,
    textOverlayStyle: normalizeReelTextOverlayStyle(input?.textOverlayStyle),
    transitionSettings: normalizeReelTransitionSettings(input?.transitionSettings),
    moodKey: sanitizeText(input?.moodKey) || DEFAULT_REEL_CONFIG.moodKey,
    visualStyleKey: sanitizeText(input?.visualStyleKey) || DEFAULT_REEL_CONFIG.visualStyleKey,
    narrationStyleKey: sanitizeText(input?.narrationStyleKey) || DEFAULT_REEL_CONFIG.narrationStyleKey,
    narrationSettings: normalizeReelNarrationSettings(input?.narrationSettings, {
      storyLanguage: input?.narrationSettings?.language || storyLanguage || DEFAULT_STORY_CONFIG.language,
      adminSettings: DEFAULT_REEL_STORY_SETTINGS.narration,
    }),
    brandingEnabled: input?.brandingEnabled !== false,
  };
}

function normalizeAuthoringMode(value?: string | null): StoryAuthoringConfig['mode'] {
  return value === 'seeded' || value === 'seed_continue' ? 'seeded' : DEFAULT_AUTHORING.mode;
}

function normalizeSourceFidelity(value?: string | null): SourceFidelity {
  switch (value) {
    case 'preserve_closely':
    case 'creative_expansion':
      return value;
    case 'balanced_adaptation':
    default:
      return DEFAULT_AUTHORING.sourceFidelity ?? 'balanced_adaptation';
  }
}

function normalizeSeedPlan(value?: SeedPlan | null): SeedPlan | undefined {
  if (!value || !Array.isArray(value.beats)) {
    return undefined;
  }

  const beats = value.beats
    .map(normalizeSeedBeatOutline)
    .filter((beat): beat is SeedBeatOutline => beat !== null);

  if (beats.length === 0) {
    return undefined;
  }

  return {
    beatCount: clampSeedBeatCount(value.beatCount, beats.length),
    beats,
  };
}

function normalizeSeedBeatOutline(value: SeedPlan['beats'][number] | null | undefined): SeedBeatOutline | null {
  if (!value) {
    return null;
  }

  const options = Array.isArray(value.options)
    ? value.options
        .map((option, index) => ({
          id: sanitizeText(option?.id) || `seed-option-${value.beatIndex || 1}-${index + 1}`,
          label: sanitizeText(option?.label),
          intent: sanitizeText(option?.intent),
          isCanonical: Boolean(option?.isCanonical),
        }))
        .filter((option) => option.label && option.intent)
    : [];

  const beatIndex = typeof value.beatIndex === 'number' && Number.isFinite(value.beatIndex)
    ? Math.max(1, Math.round(value.beatIndex))
    : 1;

  const isEnding = Boolean(value.isEnding);
  const normalizedOptions = isEnding ? [] : normalizeSeedOptions(options, beatIndex);

  return {
    beatIndex,
    title: sanitizeText(value.title) || `Beat ${beatIndex}`,
    storyText: sanitizeText(value.storyText),
    sceneSummary: sanitizeText(value.sceneSummary),
    isEnding,
    options: normalizedOptions,
  };
}

function normalizeSeedOptions(
  options: SeedBeatOutline['options'],
  beatIndex: number
): SeedBeatOutline['options'] {
  const normalized = options.slice(0, 3);
  while (normalized.length < 3) {
    const optionNumber = normalized.length + 1;
    normalized.push({
      id: `seed-option-${beatIndex}-${optionNumber}`,
      label: optionNumber === 1 ? 'Follow the original story path' : `Alternate path ${optionNumber - 1}`,
      intent: optionNumber === 1 ? 'Continue along the original seeded story.' : 'Explore a different outcome from this beat.',
      isCanonical: optionNumber === 1,
    });
  }

  const canonicalIndex = normalized.findIndex((option) => option.isCanonical);
  const resolvedCanonicalIndex = canonicalIndex === -1 ? 0 : canonicalIndex;

  return normalized.map((option, index) => ({
    ...option,
    id: option.id || `seed-option-${beatIndex}-${index + 1}`,
    isCanonical: index === resolvedCanonicalIndex,
  }));
}

function clampSeedBeatCount(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function clampMaxBeats(value?: number | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_STORY_CONFIG.maxBeats;
  return Math.min(8, Math.max(3, Math.round(value)));
}

function normalizeImageGenerationMode(value?: string | null): StoryConfig['imageGenerationMode'] {
  return value === 'prompt_only' ? 'prompt_only' : DEFAULT_STORY_CONFIG.imageGenerationMode;
}

function normalizeVerticalStoryFlag(input?: RawStoryConfig | null): boolean {
  return input?.isVerticalStory === true
    || input?.is_vertical_story === true
    || input?.aspectRatio === '9:16'
    || input?.aspect_ratio === '9:16';
}

function normalizePortraitReferenceMode(value?: string | null): PortraitReferenceMode {
  return value === 'character_sheet' ? 'character_sheet' : DEFAULT_PORTRAIT_REFERENCE_CONFIG.mode;
}

function normalizePortraitReferenceQuality(value?: string | null): PortraitReferenceQuality {
  return value === '1K' ? '1K' : DEFAULT_PORTRAIT_REFERENCE_CONFIG.quality;
}
