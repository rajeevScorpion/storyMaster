import type {
  PortraitReferenceConfig,
  PortraitReferenceQuality,
  PortraitReferenceMode,
  StoryAuthoringConfig,
  StoryConfig,
  StoryDetailLevel,
  StoryPalette,
  StoryTheme,
  VisualSettings,
  VisualStylePreset,
} from '@/lib/types/story';

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

export const DEFAULT_VISUAL_SETTINGS: VisualSettings = {
  preset: 'storybook_illustration',
  theme: 'whimsical',
  palette: 'warm',
  detail: 'balanced',
};

export const DEFAULT_AUTHORING: StoryAuthoringConfig = {
  mode: 'prompt',
  preludeText: '',
};

export const DEFAULT_PORTRAIT_REFERENCE_CONFIG: PortraitReferenceConfig = {
  mode: 'single_portrait',
  quality: '0.5K',
};

export const DEFAULT_STORY_CONFIG: StoryConfig = {
  language: 'english',
  ageGroup: 'all_ages',
  settingCountry: 'generic',
  maxBeats: 6,
  visualSettings: DEFAULT_VISUAL_SETTINGS,
  authoring: DEFAULT_AUTHORING,
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
  visualSettings?: Partial<VisualSettings> | null;
  authoring?: Partial<StoryAuthoringConfig> | null;
  portraitReferences?: Partial<PortraitReferenceConfig> | null;
};

export function normalizeStoryConfig(input?: RawStoryConfig | null): StoryConfig {
  const visualSettings: VisualSettings = {
    preset: input?.visualSettings?.preset || DEFAULT_VISUAL_SETTINGS.preset,
    theme: input?.visualSettings?.theme || DEFAULT_VISUAL_SETTINGS.theme,
    palette: input?.visualSettings?.palette || DEFAULT_VISUAL_SETTINGS.palette,
    detail: input?.visualSettings?.detail || DEFAULT_VISUAL_SETTINGS.detail,
  };

  const authoring: StoryAuthoringConfig = {
    mode: input?.authoring?.mode || DEFAULT_AUTHORING.mode,
    preludeText: sanitizePrelude(input?.authoring?.preludeText ?? DEFAULT_AUTHORING.preludeText),
  };

  const portraitReferences = normalizePortraitReferenceConfig(input?.portraitReferences);

  return {
    language: input?.language || DEFAULT_STORY_CONFIG.language,
    ageGroup: input?.ageGroup || DEFAULT_STORY_CONFIG.ageGroup,
    settingCountry: input?.settingCountry || DEFAULT_STORY_CONFIG.settingCountry,
    maxBeats: clampMaxBeats(input?.maxBeats),
    visualSettings,
    authoring,
    portraitReferences,
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
  return sanitizePrelude(config?.authoring?.preludeText);
}

export function hasPreludeText(config?: Partial<StoryConfig> | null): boolean {
  return getPreludeText(config).length > 0;
}

export function isSeedContinueMode(config?: Partial<StoryConfig> | null): boolean {
  return normalizeStoryConfig(config).authoring.mode === 'seed_continue';
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

function sanitizePrelude(value?: string | null): string {
  return value?.trim() || '';
}

function clampMaxBeats(value?: number | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_STORY_CONFIG.maxBeats;
  return Math.min(8, Math.max(3, Math.round(value)));
}

function normalizePortraitReferenceMode(value?: string | null): PortraitReferenceMode {
  return value === 'character_sheet' ? 'character_sheet' : DEFAULT_PORTRAIT_REFERENCE_CONFIG.mode;
}

function normalizePortraitReferenceQuality(value?: string | null): PortraitReferenceQuality {
  return value === '1K' ? '1K' : DEFAULT_PORTRAIT_REFERENCE_CONFIG.quality;
}
