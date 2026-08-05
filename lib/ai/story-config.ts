import type {
  ImageModelSelection,
  ImageTaskKey,
} from '@/lib/ai/image-models.shared';
import { normalizeImageContinuityStrategy } from '@/lib/ai/image-continuity.shared';
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
  DEFAULT_STORY_BEAT_LENGTH_LEVEL,
  normalizeAgeGroup,
  normalizeStoryBeatLengthLevel,
} from '@/lib/ai/story-audience';
import type {
  StoryConfigCharacterReference,
  StoryConfigReferences,
  StoryConfigWorldReference,
  WorldAdoptionMode,
} from '@/lib/types/references';
import {
  BUILT_IN_STORY_VISUAL_CATALOG,
  findStoryVisualOption,
  getDefaultStoryVisualOption,
  isStoryVisualCategory,
  toStoryVisualOptionSnapshot,
  type StoryVisualCatalog,
  type StoryVisualCategory,
  type StoryVisualOption,
  type StoryVisualOptionSnapshot,
  type StoryVisualOptionSnapshots,
} from '@/lib/ai/story-visual-options.shared';
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
  ...BUILT_IN_STORY_VISUAL_CATALOG.styles.map((option) => ({
    value: option.key,
    label: option.label,
    description: option.description,
  })),
];

export const STORY_THEME_OPTIONS: Array<{ value: StoryTheme; label: string }> = [
  ...BUILT_IN_STORY_VISUAL_CATALOG.moods.map((option) => ({ value: option.key, label: option.label })),
];

export const STORY_PALETTE_OPTIONS: Array<{ value: StoryPalette; label: string }> = [
  ...BUILT_IN_STORY_VISUAL_CATALOG.palettes.map((option) => ({ value: option.key, label: option.label })),
];

export const STORY_DETAIL_OPTIONS: Array<{ value: StoryDetailLevel; label: string }> = [
  ...BUILT_IN_STORY_VISUAL_CATALOG.details.map((option) => ({ value: option.key, label: option.label })),
];

export interface StoryLanguageOption {
  value: StoryLanguage;
  label: string;
}

/**
 * Canonical language catalog for stories. Language controls the written story text
 * AND the narration language sent to TTS. English narration variety (US/UK/…) is a
 * separate axis handled by the accent picker — see lib/ai/narration-accents.ts.
 *
 * This is the full built-in catalog and the single source of truth for VALIDATION
 * (normalizeStoryLanguage). Which of these are actually offered in the UI is a
 * separate, admin-controlled concern — see the enabled-ids helpers below. Existing
 * stories in a language later disabled by an admin keep working because validation
 * still accepts the whole catalog.
 */
export const STORY_LANGUAGE_OPTIONS: StoryLanguageOption[] = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi (हिन्दी)' },
  { value: 'bangla', label: 'Bangla (বাংলা)' },
  { value: 'gujarati', label: 'Gujarati (ગુજરાતી)' },
  { value: 'marathi', label: 'Marathi (मराठी)' },
  { value: 'urdu', label: 'Urdu (اردو)' },
];

/** Reels share the same language catalog. */
export const REEL_LANGUAGE_OPTIONS: StoryLanguageOption[] = STORY_LANGUAGE_OPTIONS;

/** Feature flag holding the JSON array of admin-enabled story language ids. */
export const STORY_LANGUAGE_ENABLED_FLAG_KEY = 'story_language_enabled_ids';

/**
 * Languages offered when no admin override exists. Urdu ships disabled by default;
 * admins can enable it (and disable any other) from Global Settings.
 */
export const DEFAULT_ENABLED_STORY_LANGUAGE_IDS: StoryLanguage[] = [
  'english',
  'hindi',
  'bangla',
  'gujarati',
  'marathi',
];

const STORY_LANGUAGE_CATALOG_IDS = new Set<string>(STORY_LANGUAGE_OPTIONS.map((option) => option.value));

/**
 * Parse the stored enabled-language flag into a validated id list. Falls back to the
 * default set when unset/malformed, and always guarantees at least one language
 * (English) so the picker is never empty.
 */
export function parseEnabledStoryLanguageIds(value: string | null | undefined): StoryLanguage[] {
  const fromDefault = () => [...DEFAULT_ENABLED_STORY_LANGUAGE_IDS];
  if (!value?.trim()) return fromDefault();

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return fromDefault();
    const seen = new Set<string>();
    const ids: StoryLanguage[] = [];
    for (const raw of parsed) {
      const id = String(raw).trim().toLowerCase();
      if (!STORY_LANGUAGE_CATALOG_IDS.has(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id as StoryLanguage);
    }
    if (ids.length === 0) return ['english'];
    return ids;
  } catch {
    return fromDefault();
  }
}

export function serializeEnabledStoryLanguageIds(ids: readonly StoryLanguage[]): string {
  const seen = new Set<string>();
  const clean = ids
    .map((id) => String(id).trim().toLowerCase())
    .filter((id) => STORY_LANGUAGE_CATALOG_IDS.has(id) && !seen.has(id) && seen.add(id));
  return JSON.stringify(clean.length > 0 ? clean : ['english']);
}

/** The catalog entries a given enabled-id set maps to, preserving catalog order. */
export function getEnabledStoryLanguageOptions(
  enabledIds: readonly StoryLanguage[]
): StoryLanguageOption[] {
  const enabled = new Set<string>(enabledIds);
  const options = STORY_LANGUAGE_OPTIONS.filter((option) => enabled.has(option.value));
  return options.length > 0 ? options : [STORY_LANGUAGE_OPTIONS[0]];
}

export const SOURCE_FIDELITY_OPTIONS: Array<{
  value: SourceFidelity;
  label: string;
  description: string;
}> = [
  {
    value: 'strictly_follow',
    label: 'Strictly Follow',
    description: 'Keep the source wording unchanged and only divide it into the selected number of beats.',
  },
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
  theme: 'match_story',
  palette: 'match_story',
  detail: 'balanced',
};

export const DEFAULT_AUTHORING: StoryAuthoringConfig = {
  mode: 'prompt',
  preludeText: '',
  workingTitle: '',
  sourceText: '',
  guidanceText: '',
  sourceFidelity: 'strictly_follow',
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
  beatLength: { level: DEFAULT_STORY_BEAT_LENGTH_LEVEL },
  settingCountry: 'generic',
  maxBeats: 6,
  imageGenerationMode: 'prompt_only',
  imageDeliveryMode: 'live',
  episodicCharacters: false,
  imageContinuityStrategy: 'auto',
  isVerticalStory: false,
  aspectRatio: '16:9',
  visualSettings: DEFAULT_VISUAL_SETTINGS,
  authoring: DEFAULT_AUTHORING,
  reel: DEFAULT_REEL_CONFIG,
  storyTextOverlay: DEFAULT_STORY_TEXT_OVERLAY_CONFIG,
  storyTransition: DEFAULT_STORY_TRANSITION_SETTINGS,
  portraitReferences: DEFAULT_PORTRAIT_REFERENCE_CONFIG,
};

const LEGACY_VISUAL_OPTIONS: StoryVisualOption[] = [
  {
    id: 'legacy:mood:whimsical', category: 'mood', key: 'whimsical', label: 'Whimsical', description: 'Playful and imaginative.',
    visualPromptDefiner: 'Use buoyant poses, imaginative staging, curious reactions, and light compositional rhythm without adding unrelated fantasy objects.',
    narrativePromptDefiner: 'Use playful curiosity and gentle surprise where the events support it, without naming the mood setting.', status: 'archived', sortOrder: 0, isDefault: false,
  },
  {
    id: 'legacy:mood:epic', category: 'mood', key: 'epic', label: 'Epic', description: 'Grand and adventurous.',
    visualPromptDefiner: 'Use a strong sense of scale, directional composition, purposeful poses, and readable stakes without inventing battles or spectacle.',
    narrativePromptDefiner: 'Use purposeful momentum and a sense of meaningful stakes while preserving the requested plot.', status: 'archived', sortOrder: 0, isDefault: false,
  },
  {
    id: 'legacy:mood:dark_fantasy', category: 'mood', key: 'dark_fantasy', label: 'Dark Fantasy', description: 'Elegant unease.',
    visualPromptDefiner: 'Use elegant unease, restrained contrast, aged textures, and controlled shadow while remaining audience-appropriate and story-grounded.',
    narrativePromptDefiner: 'Use restrained unease and moral uncertainty only where supported by the story and audience setting.', status: 'archived', sortOrder: 0, isDefault: false,
  },
  {
    id: 'legacy:mood:futuristic', category: 'mood', key: 'futuristic', label: 'Futuristic', description: 'Forward-looking imagination.',
    visualPromptDefiner: 'Use clean forward-looking design language only on technology and environments already established by the story; do not introduce futuristic objects.',
    narrativePromptDefiner: 'Preserve any future-facing ideas already present, but do not change the era or add technology because of this legacy setting.', status: 'archived', sortOrder: 0, isDefault: false,
  },
];

const VISUAL_SETTING_FIELDS: Record<StoryVisualCategory, keyof Pick<VisualSettings, 'preset' | 'theme' | 'palette' | 'detail'>> = {
  style: 'preset',
  mood: 'theme',
  palette: 'palette',
  detail: 'detail',
};

type RawStoryConfig = Partial<StoryConfig> & {
  storyKind?: string | null;
  story_kind?: string | null;
  is_vertical_story?: boolean | null;
  aspect_ratio?: string | null;
  visualSettings?: Partial<VisualSettings> | null;
  imageModelSelection?: Partial<ImageModelSelection> | null;
  image_model_selection?: Partial<ImageModelSelection> | null;
  imageContinuityStrategy?: string | null;
  image_continuity_strategy?: string | null;
  authoring?: (Partial<StoryAuthoringConfig> & {
    mode?: string | null;
    preludeText?: string | null;
  }) | null;
  reel?: Partial<ReelStoryConfig> | null;
  storyTextOverlay?: Partial<StoryConfig['storyTextOverlay']> | null;
  storyTransition?: Partial<StoryConfig['storyTransition']> | null;
  portraitReferences?: Partial<PortraitReferenceConfig> | null;
  references?: StoryConfigReferences | null;
  narrationVoice?: Partial<StoryNarrationVoiceSelection> | null;
};

export function normalizeStoryConfig(input?: RawStoryConfig | null): StoryConfig {
  const storyKind = normalizeStoryKind(input?.storyKind ?? input?.story_kind);
  const reel = normalizeReelConfig(input?.reel, input?.language);
  const resolvedOptions = normalizeStoryVisualOptionSnapshots(input?.visualSettings?.resolvedOptions);
  const visualSettings: VisualSettings = {
    preset: input?.visualSettings?.preset || DEFAULT_VISUAL_SETTINGS.preset,
    theme: input?.visualSettings?.theme || DEFAULT_VISUAL_SETTINGS.theme,
    palette: input?.visualSettings?.palette || DEFAULT_VISUAL_SETTINGS.palette,
    detail: input?.visualSettings?.detail || DEFAULT_VISUAL_SETTINGS.detail,
    ...(resolvedOptions ? { resolvedOptions } : {}),
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
  const references = normalizeStoryConfigReferences(input?.references);
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
    ageGroup: normalizeAgeGroup(input?.ageGroup),
    ...(storyKind === 'story'
      ? {
          beatLength: {
            level: normalizeStoryBeatLengthLevel(input?.beatLength?.level),
          },
        }
      : {}),
    settingCountry: input?.settingCountry || DEFAULT_STORY_CONFIG.settingCountry,
    maxBeats,
    imageGenerationMode: normalizeImageGenerationMode(input?.imageGenerationMode),
    imageDeliveryMode: normalizeImageDeliveryMode(input?.imageDeliveryMode),
    episodicCharacters: input?.episodicCharacters === true,
    ...(imageModelSelection ? { imageModelSelection } : {}),
    imageContinuityStrategy: normalizeImageContinuityStrategy(
      input?.imageContinuityStrategy ?? input?.image_continuity_strategy
    ),
    isVerticalStory,
    aspectRatio,
    visualSettings,
    authoring: storyKind === 'reel' ? { mode: 'prompt' } : authoring,
    reel,
    storyTextOverlay: normalizeStoryTextOverlayConfig(input?.storyTextOverlay),
    storyTransition: normalizeStoryTransitionSettings(input?.storyTransition),
    portraitReferences,
    ...(references ? { references } : {}),
    ...(narrationVoice ? { narrationVoice } : {}),
  };
}

function normalizeStoryConfigReferences(
  input?: StoryConfigReferences | null
): StoryConfigReferences | undefined {
  const setupId = sanitizeText(input?.setupId);
  if (!setupId) return undefined;

  const worldsInput = Array.isArray(input?.worlds) ? input!.worlds : [];
  const worlds: StoryConfigWorldReference[] = [];
  for (const raw of worldsInput) {
    // A world is keyed by adoptionId (v1) OR sourceId (v2 direct); need at least one.
    const adoptionId = sanitizeText(raw?.adoptionId);
    const sourceId = sanitizeText(raw?.sourceId);
    const worldId = sanitizeText(raw?.worldId);
    if ((!adoptionId && !sourceId) || !worldId) continue;
    const adoptionMode: WorldAdoptionMode =
      raw?.adoptionMode === 'description_plus_canonical_visual'
        ? 'description_plus_canonical_visual'
        : 'description_only';
    worlds.push({
      ...(adoptionId ? { adoptionId } : {}),
      ...(sourceId ? { sourceId } : {}),
      worldId,
      label: sanitizeText(raw?.label) || worldId,
      anchor: typeof raw?.anchor === 'string' ? raw.anchor : '',
      keywords: Array.isArray(raw?.keywords)
        ? raw.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
        : [],
      adoptionMode,
      ...(sanitizeText(raw?.canonicalStorageKey)
        ? { canonicalStorageKey: sanitizeText(raw?.canonicalStorageKey) }
        : {}),
      ...(sanitizeText(raw?.sourceStorageKey)
        ? { sourceStorageKey: sanitizeText(raw?.sourceStorageKey) }
        : {}),
    });
  }

  const charactersInput = Array.isArray(input?.characters) ? input!.characters : [];
  const characters: StoryConfigCharacterReference[] = [];
  for (const raw of charactersInput) {
    const sourceId = sanitizeText(raw?.sourceId);
    const characterId = sanitizeText(raw?.characterId);
    const storageKey = sanitizeText(raw?.storageKey);
    // Direct-input characters need a raw upload pointer; skip anything malformed.
    if (!sourceId || !characterId || !storageKey) continue;
    characters.push({
      sourceId,
      characterId,
      name: sanitizeText(raw?.name),
      ...(sanitizeText(raw?.description) ? { description: sanitizeText(raw?.description) } : {}),
      storageKey,
    });
  }

  return {
    setupId,
    worlds,
    ...(characters.length > 0 ? { characters } : {}),
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

  const style = resolveStoryVisualOptionSnapshot(resolved, 'style');
  const mood = resolveStoryVisualOptionSnapshot(resolved, 'mood');
  const palette = resolveStoryVisualOptionSnapshot(resolved, 'palette');
  const detail = resolveStoryVisualOptionSnapshot(resolved, 'detail');

  return [
    `Rendering: ${style.visualPromptDefiner}`,
    `Emotional atmosphere: ${mood.visualPromptDefiner}`,
    `Color and light: ${palette.visualPromptDefiner}`,
    `Scene richness: ${detail.visualPromptDefiner}`,
    'Scope boundary: apply these directions only to the visual treatment of story-grounded people, places, objects, and actions. Do not introduce objects, weather, technology, time of day, text, dialogue, or plot events merely to represent a style, mood, palette, or detail setting.',
  ].join('\n');
}

/** Narrative-only mood direction. Rendering, palette, and detail never enter story prose prompts. */
export function deriveNarrativeMoodSummary(visualSettings?: Partial<VisualSettings> | null): string {
  const resolved: VisualSettings = {
    ...DEFAULT_VISUAL_SETTINGS,
    ...visualSettings,
  };
  const mood = resolveStoryVisualOptionSnapshot(resolved, 'mood');
  return mood.narrativePromptDefiner
    || 'Let the story request and established events determine the emotional tone. Do not force a named mood into the narration.';
}

export function buildDefaultVisualSettings(catalog: StoryVisualCatalog): VisualSettings {
  const style = getDefaultStoryVisualOption(catalog, 'style');
  const mood = getDefaultStoryVisualOption(catalog, 'mood');
  const palette = getDefaultStoryVisualOption(catalog, 'palette');
  const detail = getDefaultStoryVisualOption(catalog, 'detail');
  return {
    preset: style.key,
    theme: mood.key,
    palette: palette.key,
    detail: detail.key,
    resolvedOptions: {
      style: toStoryVisualOptionSnapshot(style),
      mood: toStoryVisualOptionSnapshot(mood),
      palette: toStoryVisualOptionSnapshot(palette),
      detail: toStoryVisualOptionSnapshot(detail),
    },
  };
}

export function selectStoryVisualOption(
  visualSettings: VisualSettings,
  catalog: StoryVisualCatalog,
  category: StoryVisualCategory,
  key: string
): VisualSettings {
  const option = findStoryVisualOption(catalog, category, key);
  if (!option) return visualSettings;
  const field = VISUAL_SETTING_FIELDS[category];
  return {
    ...visualSettings,
    [field]: option.key,
    resolvedOptions: {
      ...(visualSettings.resolvedOptions ?? {}),
      [category]: toStoryVisualOptionSnapshot(option),
    },
  };
}

export function resolveStoryVisualOptionSnapshot(
  visualSettings: VisualSettings,
  category: StoryVisualCategory
): StoryVisualOptionSnapshot {
  const selectedKey = String(visualSettings[VISUAL_SETTING_FIELDS[category]] || '');
  const snapshot = visualSettings.resolvedOptions?.[category];
  if (snapshot?.key === selectedKey && snapshot.category === category) {
    return snapshot;
  }

  const builtIn = findStoryVisualOption(BUILT_IN_STORY_VISUAL_CATALOG, category, selectedKey)
    ?? LEGACY_VISUAL_OPTIONS.find((option) => option.category === category && option.key === selectedKey)
    ?? getDefaultStoryVisualOption(BUILT_IN_STORY_VISUAL_CATALOG, category);
  return toStoryVisualOptionSnapshot(builtIn);
}

function normalizeStoryVisualOptionSnapshots(
  input?: StoryVisualOptionSnapshots | null
): StoryVisualOptionSnapshots | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const normalized: StoryVisualOptionSnapshots = {};
  for (const category of ['style', 'mood', 'palette', 'detail'] as const) {
    const raw = input[category] as Partial<StoryVisualOptionSnapshot> | undefined;
    if (!raw || !isStoryVisualCategory(raw.category) || raw.category !== category) continue;
    const key = sanitizeText(raw.key).slice(0, 80);
    const visualPromptDefiner = sanitizeText(raw.visualPromptDefiner).slice(0, 1200);
    if (!key || !visualPromptDefiner) continue;
    normalized[category] = {
      id: sanitizeText(raw.id).slice(0, 120) || `snapshot:${category}:${key}`,
      category,
      key,
      label: sanitizeText(raw.label).slice(0, 120) || key,
      description: sanitizeText(raw.description).slice(0, 240),
      visualPromptDefiner,
      narrativePromptDefiner: sanitizeText(raw.narrativePromptDefiner).slice(0, 1200) || null,
    };
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
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
  const accent = sanitizeText(input.accent).toLowerCase();

  if (mode === 'legacy_auto') {
    // Accent is independent of the voice-selection mode — preserve it even when the
    // narrator voice itself is auto-selected.
    return { mode, ...(accent ? { accent } : {}) };
  }

  const voiceId = sanitizeText(input.voiceId);
  const genderBucket = normalizeNarrationGenderBucket(input.genderBucket);
  const languageCode = normalizeNarrationLanguageCode(input.languageCode);

  return {
    mode,
    genderBucket,
    ...(voiceId ? { voiceId } : {}),
    ...(languageCode ? { languageCode } : {}),
    ...(accent ? { accent } : {}),
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
    case 'strictly_follow':
    case 'preserve_closely':
    case 'balanced_adaptation':
    case 'creative_expansion':
      return value;
    default:
      return DEFAULT_AUTHORING.sourceFidelity ?? 'strictly_follow';
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
  if (value === 'generate' || value === 'prompt_only') {
    return value;
  }
  return DEFAULT_STORY_CONFIG.imageGenerationMode;
}

function normalizeImageDeliveryMode(value?: string | null): StoryConfig['imageDeliveryMode'] {
  return value === 'batch' || value === 'stateful' ? value : 'live';
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
