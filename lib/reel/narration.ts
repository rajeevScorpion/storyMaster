import type { StoryLanguage } from '@/lib/types/story';

export type NarrationProvider = 'elevenlabs' | 'gemini_tts';
export type NarrationFallbackProvider = 'gemini_tts';
export type NarrationPresetScope = 'system' | 'user';
export type NarrationPresetVisibility = 'private' | 'public';
export type NarrationLanguageMode = 'reel_language' | 'auto' | 'custom';
export type NarrationGenerationMode = 'preview' | 'final';
export type NarrationVoiceGender = 'female' | 'male';

export interface NarrationVoiceOption {
  voiceId: string;
  label: string;
  description?: string;
}

export interface PronunciationDictionaryLocator {
  pronunciation_dictionary_id: string;
  version_id: string;
}

export interface ReelNarrationAdminSettings {
  defaultProvider: NarrationProvider;
  fallbackProvider: NarrationFallbackProvider;
  defaultPresetId: string;
  enabledSystemPresetIds: string[];
  defaultVoiceId: string;
  allowedElevenLabsVoices: NarrationVoiceOption[];
  femaleElevenLabsVoices: NarrationVoiceOption[];
  maleElevenLabsVoices: NarrationVoiceOption[];
  defaultElevenLabsModel: string;
  previewElevenLabsModel: string;
  finalElevenLabsModel: string;
  fallbackGeminiVoice: string;
  maxNarrationLength: number;
  expressiveTagsEnabled: boolean;
  pronunciationDictionaryEnabled: boolean;
  pronunciationDictionaryLocators: PronunciationDictionaryLocator[];
}

export interface ReelNarrationSettings {
  provider: NarrationProvider;
  fallbackProvider: NarrationFallbackProvider;
  language: string;
  languageSource: 'reel_language' | 'user_selected' | 'auto_detected';
  detectedLanguage: string | null;
  isMixedLanguage: boolean;
  voiceGender: NarrationVoiceGender;
  voiceId: string;
  model: string;
  presetId: string | null;
  speed: number;
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
  emotionalIntensity: number;
  pacing: string;
  tone: string;
  deliveryStyle: string;
  narrationInstruction: string;
  languageMode: NarrationLanguageMode;
  useExpressiveTags: boolean;
  usePronunciationDictionary: boolean;
  pauseStyle: string;
}

export interface NarrationPreset {
  id: string;
  userId: string | null;
  name: string;
  description: string | null;
  provider: NarrationProvider;
  model: string;
  voiceId: string;
  languageMode: NarrationLanguageMode;
  speed: number;
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
  tone: string;
  emotionalIntensity: number;
  pacing: string;
  deliveryStyle: string;
  narrationInstruction: string;
  presetScope: NarrationPresetScope;
  presetVisibility: NarrationPresetVisibility;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type NarrationVoicePreviewScope = '1_beat' | 'full';

export interface ReelNarrationVoicePreview {
  id: string;
  storyId: string;
  userId: string;
  label: string;
  voiceDisplayName: string;
  audioR2Key: string;
  audioMimeType: string;
  audioUrl: string | null;
  settingsSnapshot: ReelNarrationSettings;
  previewScope: NarrationVoicePreviewScope;
  isActive: boolean;
  createdAt: string;
}

export interface NarrationLanguageDetection {
  selectedLanguage: string;
  detectedLanguage: string | null;
  isMixedLanguage: boolean;
  notice: string | null;
}

export interface NarrationPerformanceScript {
  text: string;
  deliveryInstruction: string;
  language: NarrationLanguageDetection;
  expressiveTagsUsed: boolean;
  modelSupportsExpressiveTags: boolean;
}

const SYSTEM_PRESET_IDS = {
  knowledgeable: '11111111-1111-4111-8111-111111111111',
  philosophical: '22222222-2222-4222-8222-222222222222',
  softNoir: '33333333-3333-4333-8333-333333333333',
  whispering: '44444444-4444-4444-8444-444444444444',
  dramatic: '55555555-5555-4555-8555-555555555555',
  affectionateStoryteller: '66666666-6666-4666-8666-666666666666',
  sageNarrator: '77777777-7777-4777-8777-777777777777',
  melancholicPoet: '88888888-8888-4888-8888-888888888888',
  hopefulMentor: '99999999-9999-4999-8999-999999999999',
  mysticDocumentary: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cinematicTrailerSoft: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  gentleHindiKahani: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  urduPoeticNoir: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  childlikeWonder: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  mythicEpic: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
} as const;

function isoNow(): string {
  return new Date(0).toISOString();
}

function preset(input: Omit<NarrationPreset, 'userId' | 'provider' | 'model' | 'voiceId' | 'languageMode' | 'presetScope' | 'presetVisibility' | 'isDefault' | 'createdAt' | 'updatedAt'> & {
  model?: string;
  voiceId?: string;
  languageMode?: NarrationLanguageMode;
  isDefault?: boolean;
}): NarrationPreset {
  return {
    userId: null,
    provider: 'elevenlabs',
    model: input.model ?? 'eleven_multilingual_v2',
    voiceId: input.voiceId ?? 'EXAVITQu4vr4xnSDxMaL',
    languageMode: input.languageMode ?? 'reel_language',
    presetScope: 'system',
    presetVisibility: 'public',
    isDefault: input.isDefault ?? false,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    ...input,
  };
}

export const SYSTEM_NARRATION_PRESETS: NarrationPreset[] = [
  preset({
    id: SYSTEM_PRESET_IDS.knowledgeable,
    name: 'Knowledgeable',
    description: 'Calm, clear, confident explanation with gentle authority.',
    speed: 0.95,
    stability: 0.75,
    similarityBoost: 0.8,
    style: 0.15,
    speakerBoost: true,
    tone: 'clear, grounded, thoughtful',
    emotionalIntensity: 0.35,
    pacing: 'steady',
    deliveryStyle: 'informed storyteller',
    narrationInstruction: 'Sound warm, precise, and trustworthy. Keep pauses short and purposeful.',
    isDefault: true,
  }),
  preset({
    id: SYSTEM_PRESET_IDS.philosophical,
    name: 'Philosophical',
    description: 'Reflective, intimate, and spacious for meaning-heavy reels.',
    speed: 0.86,
    stability: 0.62,
    similarityBoost: 0.78,
    style: 0.32,
    speakerBoost: true,
    tone: 'reflective, soft, searching',
    emotionalIntensity: 0.5,
    pacing: 'slow',
    deliveryStyle: 'philosophical narrator',
    narrationInstruction: 'Let ideas breathe. Use gentle pauses after images and questions.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.softNoir,
    name: 'Soft Noir',
    description: 'Low, cinematic, and intimate without becoming harsh.',
    speed: 0.82,
    stability: 0.55,
    similarityBoost: 0.76,
    style: 0.42,
    speakerBoost: true,
    tone: 'low, smoky, intimate',
    emotionalIntensity: 0.55,
    pacing: 'slow',
    deliveryStyle: 'soft noir narrator',
    narrationInstruction: 'Keep the voice close and low. Add suspense through pauses, not volume.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.whispering,
    name: 'Whispering',
    description: 'Breathy, close, and delicate for quiet emotional reels.',
    speed: 0.78,
    stability: 0.5,
    similarityBoost: 0.72,
    style: 0.55,
    speakerBoost: true,
    tone: 'hushed, tender, close',
    emotionalIntensity: 0.62,
    pacing: 'very_slow',
    deliveryStyle: 'whispered storyteller',
    narrationInstruction: 'Use a soft near-whisper. Keep consonants clear and avoid melodrama.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.dramatic,
    name: 'Dramatic',
    description: 'Emotion-forward, cinematic, and high contrast.',
    speed: 0.9,
    stability: 0.42,
    similarityBoost: 0.75,
    style: 0.65,
    speakerBoost: true,
    tone: 'dramatic, cinematic, emotionally charged',
    emotionalIntensity: 0.78,
    pacing: 'dynamic',
    deliveryStyle: 'dramatic narrator',
    narrationInstruction: 'Lean into emotion and contrast, but keep the delivery smooth and reel-friendly.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.affectionateStoryteller,
    name: 'Affectionate Storyteller',
    description: 'Warm, caring, and personal with soft emotional lift.',
    speed: 0.88,
    stability: 0.68,
    similarityBoost: 0.8,
    style: 0.28,
    speakerBoost: true,
    tone: 'affectionate, warm, reassuring',
    emotionalIntensity: 0.55,
    pacing: 'gentle',
    deliveryStyle: 'affectionate storyteller',
    narrationInstruction: 'Sound like you are telling something precious to someone you care about.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.sageNarrator,
    name: 'Sage Narrator',
    description: 'Wise, grounded, and unhurried.',
    speed: 0.84,
    stability: 0.7,
    similarityBoost: 0.82,
    style: 0.25,
    speakerBoost: true,
    tone: 'wise, grounded, compassionate',
    emotionalIntensity: 0.45,
    pacing: 'slow',
    deliveryStyle: 'sage narrator',
    narrationInstruction: 'Speak with mature calm. Let each line feel earned.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.melancholicPoet,
    name: 'Melancholic Poet',
    description: 'Soft sadness, poetic rhythm, and careful silence.',
    speed: 0.8,
    stability: 0.56,
    similarityBoost: 0.78,
    style: 0.4,
    speakerBoost: true,
    tone: 'melancholic, lyrical, tender',
    emotionalIntensity: 0.65,
    pacing: 'slow',
    deliveryStyle: 'poetic narrator',
    narrationInstruction: 'Use a lyrical cadence with gentle ache. Avoid theatrical overstatement.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.hopefulMentor,
    name: 'Hopeful Mentor',
    description: 'Encouraging, bright, and steady.',
    speed: 0.94,
    stability: 0.7,
    similarityBoost: 0.82,
    style: 0.25,
    speakerBoost: true,
    tone: 'hopeful, steady, encouraging',
    emotionalIntensity: 0.48,
    pacing: 'steady',
    deliveryStyle: 'hopeful mentor',
    narrationInstruction: 'Carry quiet optimism. Make the final line feel like a hand on the shoulder.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.mysticDocumentary,
    name: 'Mystic Documentary',
    description: 'Documentary clarity with mystical wonder.',
    speed: 0.86,
    stability: 0.64,
    similarityBoost: 0.8,
    style: 0.35,
    speakerBoost: true,
    tone: 'mystic, observant, cinematic',
    emotionalIntensity: 0.55,
    pacing: 'measured',
    deliveryStyle: 'mystic documentary narrator',
    narrationInstruction: 'Balance factual calm with a quiet sense of mystery and awe.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.cinematicTrailerSoft,
    name: 'Cinematic Trailer Soft',
    description: 'Trailer-like lift with a softer emotional edge.',
    speed: 0.92,
    stability: 0.48,
    similarityBoost: 0.78,
    style: 0.55,
    speakerBoost: true,
    tone: 'cinematic, spacious, stirring',
    emotionalIntensity: 0.68,
    pacing: 'dynamic',
    deliveryStyle: 'soft cinematic trailer',
    narrationInstruction: 'Use trailer pacing and weight, but keep the voice intimate and restrained.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.gentleHindiKahani,
    name: 'Gentle Hindi Kahani',
    description: 'Warm Hindi storytelling with gentle pauses.',
    speed: 0.88,
    stability: 0.68,
    similarityBoost: 0.82,
    style: 0.3,
    speakerBoost: true,
    tone: 'narm, kahani-jaisa, affectionate',
    emotionalIntensity: 0.52,
    pacing: 'gentle',
    deliveryStyle: 'Hindi kahani narrator',
    narrationInstruction: 'Narrate like a gentle Hindi kahani. Keep mixed Hindi-English words natural.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.urduPoeticNoir,
    name: 'Urdu Poetic Noir',
    description: 'Poetic Urdu/Hindustani mood with noir softness.',
    speed: 0.82,
    stability: 0.56,
    similarityBoost: 0.78,
    style: 0.44,
    speakerBoost: true,
    tone: 'poetic, noir, mehsoos',
    emotionalIntensity: 0.64,
    pacing: 'slow',
    deliveryStyle: 'Urdu poetic narrator',
    narrationInstruction: 'Keep the cadence poetic and intimate. Preserve Urdu/Hindustani words gracefully.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.childlikeWonder,
    name: 'Childlike Wonder',
    description: 'Soft wonder, curiosity, and innocent warmth.',
    speed: 0.96,
    stability: 0.66,
    similarityBoost: 0.8,
    style: 0.34,
    speakerBoost: true,
    tone: 'curious, bright, gentle',
    emotionalIntensity: 0.5,
    pacing: 'light',
    deliveryStyle: 'wonder-filled storyteller',
    narrationInstruction: 'Bring a small smile into the voice. Keep the wonder sincere and unforced.',
  }),
  preset({
    id: SYSTEM_PRESET_IDS.mythicEpic,
    name: 'Mythic Epic',
    description: 'Grand, ancient, and emotionally resonant.',
    speed: 0.9,
    stability: 0.5,
    similarityBoost: 0.8,
    style: 0.58,
    speakerBoost: true,
    tone: 'mythic, grand, resonant',
    emotionalIntensity: 0.72,
    pacing: 'measured',
    deliveryStyle: 'mythic epic narrator',
    narrationInstruction: 'Give the lines ancient weight. Let pauses create scale.',
  }),
];

export const RECOMMENDED_REEL_FEMALE_VOICES: NarrationVoiceOption[] = [
  {
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
    label: 'Sarah',
    description: 'Mature, reassuring, warm narrator',
  },
  {
    voiceId: 'FGY2WhTYpPnrIDTdsKH5',
    label: 'Laura',
    description: 'Bright, energetic, social reels',
  },
  {
    voiceId: 'Xb7hH8MSUJpSbSDYk0k2',
    label: 'Alice',
    description: 'Clear, friendly educator',
  },
  {
    voiceId: 'XrExE9yKIg1WjnnlVkGX',
    label: 'Matilda',
    description: 'Professional, calm alto narrator',
  },
];

export const RECOMMENDED_REEL_MALE_VOICES: NarrationVoiceOption[] = [
  {
    voiceId: 'JBFqnCBsd6RMkjVDRZzb',
    label: 'George',
    description: 'Warm, captivating storyteller',
  },
  {
    voiceId: 'nPczCjzI2devNBz1zQrb',
    label: 'Brian',
    description: 'Deep, resonant, comforting',
  },
  {
    voiceId: 'cjVigY5qzO86Huf0OWal',
    label: 'Eric',
    description: 'Smooth, trustworthy tenor',
  },
  {
    voiceId: 'pqHfZKP75CvOlQylNhV4',
    label: 'Bill',
    description: 'Wise, mature, balanced narrator',
  },
];

export const DEFAULT_REEL_NARRATION_ADMIN_SETTINGS: ReelNarrationAdminSettings = {
  defaultProvider: 'elevenlabs',
  fallbackProvider: 'gemini_tts',
  defaultPresetId: SYSTEM_PRESET_IDS.knowledgeable,
  enabledSystemPresetIds: SYSTEM_NARRATION_PRESETS.map((preset) => preset.id),
  defaultVoiceId: 'EXAVITQu4vr4xnSDxMaL',
  allowedElevenLabsVoices: [
    ...RECOMMENDED_REEL_FEMALE_VOICES,
    ...RECOMMENDED_REEL_MALE_VOICES,
  ],
  femaleElevenLabsVoices: RECOMMENDED_REEL_FEMALE_VOICES,
  maleElevenLabsVoices: RECOMMENDED_REEL_MALE_VOICES,
  defaultElevenLabsModel: 'eleven_multilingual_v2',
  previewElevenLabsModel: 'eleven_flash_v2_5',
  finalElevenLabsModel: 'eleven_multilingual_v2',
  fallbackGeminiVoice: 'Sulafat',
  maxNarrationLength: 5000,
  expressiveTagsEnabled: true,
  pronunciationDictionaryEnabled: false,
  pronunciationDictionaryLocators: [],
};

export const DEFAULT_REEL_NARRATION_SETTINGS: ReelNarrationSettings = {
  provider: 'elevenlabs',
  fallbackProvider: 'gemini_tts',
  language: 'en-IN',
  languageSource: 'reel_language',
  detectedLanguage: null,
  isMixedLanguage: false,
  voiceGender: 'female',
  voiceId: DEFAULT_REEL_NARRATION_ADMIN_SETTINGS.defaultVoiceId,
  model: DEFAULT_REEL_NARRATION_ADMIN_SETTINGS.finalElevenLabsModel,
  presetId: DEFAULT_REEL_NARRATION_ADMIN_SETTINGS.defaultPresetId,
  speed: SYSTEM_NARRATION_PRESETS[0].speed,
  stability: SYSTEM_NARRATION_PRESETS[0].stability,
  similarityBoost: SYSTEM_NARRATION_PRESETS[0].similarityBoost,
  style: SYSTEM_NARRATION_PRESETS[0].style,
  speakerBoost: SYSTEM_NARRATION_PRESETS[0].speakerBoost,
  emotionalIntensity: SYSTEM_NARRATION_PRESETS[0].emotionalIntensity,
  pacing: SYSTEM_NARRATION_PRESETS[0].pacing,
  tone: SYSTEM_NARRATION_PRESETS[0].tone,
  deliveryStyle: SYSTEM_NARRATION_PRESETS[0].deliveryStyle,
  narrationInstruction: SYSTEM_NARRATION_PRESETS[0].narrationInstruction,
  languageMode: 'reel_language',
  useExpressiveTags: true,
  usePronunciationDictionary: false,
  pauseStyle: 'natural',
};

const ELEVENLABS_MULTILINGUAL_V2_LANGUAGE_CODES = new Set([
  'en', 'ja', 'zh', 'de', 'hi', 'fr', 'ko', 'pt', 'it', 'es',
  'id', 'nl', 'tr', 'fil', 'pl', 'sv', 'bg', 'ro', 'ar', 'cs',
  'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'ru',
]);

const ELEVENLABS_FLASH_V2_5_LANGUAGE_CODES = new Set([
  ...ELEVENLABS_MULTILINGUAL_V2_LANGUAGE_CODES,
  'hu', 'no', 'vi',
]);

const ELEVENLABS_V3_LANGUAGE_CODES = new Set([
  'af', 'ar', 'hy', 'as', 'az', 'be', 'bn', 'bs', 'bg', 'ca',
  'ceb', 'ny', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fil', 'fi',
  'fr', 'gl', 'ka', 'de', 'el', 'gu', 'ha', 'he', 'hi', 'hu',
  'is', 'id', 'ga', 'it', 'ja', 'jv', 'kn', 'kk', 'ky', 'ko',
  'lv', 'ln', 'lt', 'lb', 'mk', 'ms', 'ml', 'zh', 'mr', 'ne',
  'no', 'ps', 'fa', 'pl', 'pt', 'pa', 'ro', 'ru', 'sr', 'sd',
  'sk', 'sl', 'so', 'es', 'sw', 'sv', 'ta', 'te', 'th', 'tr',
  'uk', 'ur', 'vi', 'cy',
]);

const ELEVENLABS_BROAD_LANGUAGE_MODEL_ID = 'eleven_v3';

function cleanString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Number(parsed.toFixed(3))));
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

function normalizeProvider(value: unknown, fallback: NarrationProvider): NarrationProvider {
  return value === 'gemini_tts' || value === 'elevenlabs' ? value : fallback;
}

function normalizeFallbackProvider(value: unknown): NarrationFallbackProvider {
  return value === 'gemini_tts' ? 'gemini_tts' : 'gemini_tts';
}

function normalizeLanguageMode(value: unknown): NarrationLanguageMode {
  if (value === 'auto' || value === 'custom' || value === 'reel_language') return value;
  return 'reel_language';
}

function normalizeVoiceGender(value: unknown, fallback: NarrationVoiceGender): NarrationVoiceGender {
  return value === 'male' || value === 'female' ? value : fallback;
}

function normalizePresetScope(value: unknown): NarrationPresetScope {
  return value === 'user' ? 'user' : 'system';
}

function normalizePresetVisibility(value: unknown): NarrationPresetVisibility {
  return value === 'public' ? 'public' : 'private';
}

function normalizeVoiceOptions(value: unknown, fallback: NarrationVoiceOption[]): NarrationVoiceOption[] {
  if (!Array.isArray(value)) return fallback;
  const options = value
    .map((entry) => {
      if (typeof entry === 'string') {
        const voiceId = entry.trim();
        return voiceId ? { voiceId, label: voiceId } : null;
      }
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Record<string, unknown>;
      const voiceId = cleanString(raw.voiceId || raw.voice_id);
      if (!voiceId) return null;
      return {
        voiceId,
        label: cleanString(raw.label, voiceId),
        description: cleanString(raw.description) || undefined,
      };
    })
    .filter((entry): entry is NarrationVoiceOption => Boolean(entry));
  return options.length > 0 ? options : fallback;
}

function uniqueVoiceOptions(...groups: NarrationVoiceOption[][]): NarrationVoiceOption[] {
  const seen = new Set<string>();
  const result: NarrationVoiceOption[] = [];
  groups.flat().forEach((voice) => {
    const voiceId = voice.voiceId.trim();
    if (!voiceId || seen.has(voiceId)) return;
    seen.add(voiceId);
    result.push({ ...voice, voiceId });
  });
  return result;
}

function hasConfiguredVoiceList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export function getReelNarrationVoicesForGender(
  adminSettings: ReelNarrationAdminSettings,
  gender: NarrationVoiceGender
): NarrationVoiceOption[] {
  const voices = gender === 'male'
    ? adminSettings.maleElevenLabsVoices
    : adminSettings.femaleElevenLabsVoices;
  return voices.length > 0 ? voices : adminSettings.allowedElevenLabsVoices;
}

export function getReelNarrationVoiceGender(
  adminSettings: ReelNarrationAdminSettings,
  voiceId: string | null | undefined
): NarrationVoiceGender | null {
  const id = cleanString(voiceId);
  if (!id) return null;
  if (adminSettings.maleElevenLabsVoices.some((voice) => voice.voiceId === id)) return 'male';
  if (adminSettings.femaleElevenLabsVoices.some((voice) => voice.voiceId === id)) return 'female';
  return null;
}

function normalizeDictionaryLocators(value: unknown): PronunciationDictionaryLocator[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const raw = entry as Record<string, unknown>;
      const id = cleanString(raw.pronunciation_dictionary_id || raw.id);
      const versionId = cleanString(raw.version_id || raw.versionId);
      if (!id || !versionId) return null;
      return {
        pronunciation_dictionary_id: id,
        version_id: versionId,
      };
    })
    .filter((entry): entry is PronunciationDictionaryLocator => Boolean(entry));
}

export function normalizeReelNarrationAdminSettings(
  input: unknown,
  legacyElevenLabs?: { enabled?: boolean; voiceId?: string; modelId?: string } | null
): ReelNarrationAdminSettings {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const defaults = DEFAULT_REEL_NARRATION_ADMIN_SETTINGS;
  const legacyVoice = cleanString(legacyElevenLabs?.voiceId, defaults.defaultVoiceId);
  const legacyModel = cleanString(legacyElevenLabs?.modelId, defaults.finalElevenLabsModel);
  const legacyAllowedVoices = normalizeVoiceOptions(
    raw.allowedElevenLabsVoices ?? raw.allowed_elevenlabs_voices,
    defaults.allowedElevenLabsVoices
  );
  const femaleElevenLabsVoices = normalizeVoiceOptions(
    raw.femaleElevenLabsVoices ?? raw.female_elevenlabs_voices,
    hasConfiguredVoiceList(raw.allowedElevenLabsVoices ?? raw.allowed_elevenlabs_voices)
      ? legacyAllowedVoices
      : defaults.femaleElevenLabsVoices
  );
  const maleElevenLabsVoices = normalizeVoiceOptions(
    raw.maleElevenLabsVoices ?? raw.male_elevenlabs_voices,
    defaults.maleElevenLabsVoices
  );
  const defaultVoiceId = cleanString(raw.defaultVoiceId, legacyVoice);
  const allowedVoices = uniqueVoiceOptions(femaleElevenLabsVoices, maleElevenLabsVoices, legacyAllowedVoices);
  const enabledSystemPresetIds = Array.isArray(raw.enabledSystemPresetIds)
    ? raw.enabledSystemPresetIds.map((value) => cleanString(value)).filter(Boolean)
    : defaults.enabledSystemPresetIds;

  return {
    defaultProvider: normalizeProvider(raw.defaultProvider, legacyElevenLabs?.enabled === false ? 'gemini_tts' : defaults.defaultProvider),
    fallbackProvider: normalizeFallbackProvider(raw.fallbackProvider),
    defaultPresetId: cleanString(raw.defaultPresetId, defaults.defaultPresetId),
    enabledSystemPresetIds: enabledSystemPresetIds.length > 0 ? enabledSystemPresetIds : defaults.enabledSystemPresetIds,
    defaultVoiceId,
    allowedElevenLabsVoices: allowedVoices.some((voice) => voice.voiceId === defaultVoiceId)
      ? allowedVoices
      : [{ voiceId: defaultVoiceId, label: defaultVoiceId }, ...allowedVoices],
    femaleElevenLabsVoices: femaleElevenLabsVoices.some((voice) => voice.voiceId === defaultVoiceId)
      || maleElevenLabsVoices.some((voice) => voice.voiceId === defaultVoiceId)
      ? femaleElevenLabsVoices
      : [{ voiceId: defaultVoiceId, label: defaultVoiceId }, ...femaleElevenLabsVoices],
    maleElevenLabsVoices,
    defaultElevenLabsModel: cleanString(raw.defaultElevenLabsModel, legacyModel),
    previewElevenLabsModel: cleanString(raw.previewElevenLabsModel, defaults.previewElevenLabsModel),
    finalElevenLabsModel: cleanString(raw.finalElevenLabsModel, legacyModel),
    fallbackGeminiVoice: cleanString(raw.fallbackGeminiVoice, defaults.fallbackGeminiVoice),
    maxNarrationLength: Math.round(normalizeNumber(raw.maxNarrationLength, defaults.maxNarrationLength, 200, 20000)),
    expressiveTagsEnabled: normalizeBoolean(raw.expressiveTagsEnabled, defaults.expressiveTagsEnabled),
    pronunciationDictionaryEnabled: normalizeBoolean(raw.pronunciationDictionaryEnabled, defaults.pronunciationDictionaryEnabled),
    pronunciationDictionaryLocators: normalizeDictionaryLocators(raw.pronunciationDictionaryLocators),
  };
}

export function normalizeNarrationPreset(input: unknown): NarrationPreset {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const fallback = SYSTEM_NARRATION_PRESETS[0];
  return {
    id: cleanString(raw.id, fallback.id),
    userId: cleanString(raw.userId ?? raw.user_id) || null,
    name: cleanString(raw.name, fallback.name),
    description: cleanString(raw.description) || null,
    provider: normalizeProvider(raw.provider, fallback.provider),
    model: cleanString(raw.model, fallback.model),
    voiceId: cleanString(raw.voiceId ?? raw.voice_id, fallback.voiceId),
    languageMode: normalizeLanguageMode(raw.languageMode ?? raw.language_mode),
    speed: normalizeNumber(raw.speed, fallback.speed, 0.5, 2),
    stability: normalizeNumber(raw.stability, fallback.stability, 0, 1),
    similarityBoost: normalizeNumber(raw.similarityBoost ?? raw.similarity_boost, fallback.similarityBoost, 0, 1),
    style: normalizeNumber(raw.style, fallback.style, 0, 1),
    speakerBoost: normalizeBoolean(raw.speakerBoost ?? raw.speaker_boost, fallback.speakerBoost),
    tone: cleanString(raw.tone, fallback.tone),
    emotionalIntensity: normalizeNumber(raw.emotionalIntensity ?? raw.emotional_intensity, fallback.emotionalIntensity, 0, 1),
    pacing: cleanString(raw.pacing, fallback.pacing),
    deliveryStyle: cleanString(raw.deliveryStyle ?? raw.delivery_style, fallback.deliveryStyle),
    narrationInstruction: cleanString(raw.narrationInstruction ?? raw.narration_instruction, fallback.narrationInstruction),
    presetScope: normalizePresetScope(raw.presetScope ?? raw.preset_scope),
    presetVisibility: normalizePresetVisibility(raw.presetVisibility ?? raw.preset_visibility),
    isDefault: normalizeBoolean(raw.isDefault ?? raw.is_default, false),
    createdAt: cleanString(raw.createdAt ?? raw.created_at, fallback.createdAt),
    updatedAt: cleanString(raw.updatedAt ?? raw.updated_at, fallback.updatedAt),
  };
}

export function storyLanguageToNarrationLanguage(language: StoryLanguage | string | null | undefined): string {
  switch (language) {
    case 'hindi':
      return 'hi-IN';
    case 'bangla':
      return 'bn-IN';
    case 'urdu':
      return 'ur-IN';
    case 'gujarati':
      return 'gu-IN';
    default:
      return 'en-IN';
  }
}

export function toElevenLabsLanguageCode(language: string | null | undefined): string | null {
  const normalized = cleanString(language).toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('hi')) return 'hi';
  if (normalized.startsWith('bn')) return 'bn';
  if (normalized.startsWith('ur')) return 'ur';
  if (normalized.startsWith('gu')) return 'gu';
  if (normalized.startsWith('en')) return 'en';
  return normalized.split('-')[0] || null;
}

export function elevenLabsModelSupportsLanguage(
  model: string | null | undefined,
  language: string | null | undefined
): boolean {
  const languageCode = toElevenLabsLanguageCode(language);
  if (!languageCode) return true;

  const modelId = cleanString(model).toLowerCase();
  if (!modelId) return true;

  if (modelId === 'eleven_multilingual_v2'
    || modelId === 'eleven_multilingual_sts_v2'
    || modelId === 'eleven_multilingual_ttv_v2') {
    return ELEVENLABS_MULTILINGUAL_V2_LANGUAGE_CODES.has(languageCode);
  }

  if (modelId === 'eleven_flash_v2_5' || modelId === 'eleven_turbo_v2_5') {
    return ELEVENLABS_FLASH_V2_5_LANGUAGE_CODES.has(languageCode);
  }

  if (modelId === 'eleven_flash_v2' || modelId === 'eleven_turbo_v2') {
    return languageCode === 'en';
  }

  if (modelId === 'eleven_v3' || modelId === 'eleven_ttv_v3') {
    return ELEVENLABS_V3_LANGUAGE_CODES.has(languageCode);
  }

  return true;
}

export function getElevenLabsUnsupportedLanguageReason(
  model: string | null | undefined,
  language: string | null | undefined
): string | null {
  if (elevenLabsModelSupportsLanguage(model, language)) return null;
  const languageCode = toElevenLabsLanguageCode(language) ?? language ?? 'unknown';
  return `ElevenLabs model ${cleanString(model, 'default')} does not support language_code '${languageCode}'.`;
}

export function resolveElevenLabsModelForLanguage(
  preferredModel: string | null | undefined,
  language: string | null | undefined,
  fallbackModels: Array<string | null | undefined> = []
): string {
  const candidates: string[] = [];
  [preferredModel, ...fallbackModels, ELEVENLABS_BROAD_LANGUAGE_MODEL_ID].forEach((candidate) => {
    const model = cleanString(candidate);
    if (model && !candidates.includes(model)) candidates.push(model);
  });

  return candidates.find((model) => elevenLabsModelSupportsLanguage(model, language))
    ?? candidates[0]
    ?? cleanString(preferredModel);
}

export function resolvePreviewElevenLabsModel(
  settings: ReelNarrationSettings,
  adminSettings: ReelNarrationAdminSettings
): string {
  return resolveElevenLabsModelForLanguage(
    cleanString(adminSettings.previewElevenLabsModel, settings.model),
    settings.language,
    [
      settings.model,
      adminSettings.finalElevenLabsModel,
      adminSettings.defaultElevenLabsModel,
    ]
  );
}

export function getEnabledSystemNarrationPresets(adminSettings: ReelNarrationAdminSettings): NarrationPreset[] {
  const enabled = new Set(adminSettings.enabledSystemPresetIds);
  return SYSTEM_NARRATION_PRESETS.filter((preset) => enabled.has(preset.id));
}

export function getNarrationPresetById(id: string | null | undefined): NarrationPreset | null {
  if (!id) return null;
  return SYSTEM_NARRATION_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function normalizeReelNarrationSettings(
  input: unknown,
  options: {
    storyLanguage?: StoryLanguage | string | null;
    adminSettings?: ReelNarrationAdminSettings;
    preset?: NarrationPreset | null;
  } = {}
): ReelNarrationSettings {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const adminSettings = options.adminSettings ?? DEFAULT_REEL_NARRATION_ADMIN_SETTINGS;
  const defaultPreset = options.preset
    ?? getNarrationPresetById(cleanString(raw.presetId ?? raw.preset_id, adminSettings.defaultPresetId))
    ?? getNarrationPresetById(adminSettings.defaultPresetId)
    ?? SYSTEM_NARRATION_PRESETS[0];
  const rawVoiceId = cleanString(raw.voiceId ?? raw.voice_id);
  const inferredGender = getReelNarrationVoiceGender(adminSettings, rawVoiceId || defaultPreset.voiceId || adminSettings.defaultVoiceId)
    ?? DEFAULT_REEL_NARRATION_SETTINGS.voiceGender;
  const rawVoiceGender = raw.voiceGender ?? raw.voice_gender;
  const voiceGender = normalizeVoiceGender(rawVoiceGender, inferredGender);
  const genderDefaultVoice = getReelNarrationVoicesForGender(adminSettings, voiceGender)[0]?.voiceId;
  const hasExplicitVoiceGender = rawVoiceGender === 'male' || rawVoiceGender === 'female';
  const fallbackVoiceId = hasExplicitVoiceGender
    ? genderDefaultVoice || defaultPreset.voiceId || adminSettings.defaultVoiceId
    : defaultPreset.voiceId || genderDefaultVoice || adminSettings.defaultVoiceId;
  const fallback = {
    ...DEFAULT_REEL_NARRATION_SETTINGS,
    provider: adminSettings.defaultProvider,
    fallbackProvider: adminSettings.fallbackProvider,
    language: storyLanguageToNarrationLanguage(options.storyLanguage),
    voiceGender,
    voiceId: fallbackVoiceId,
    model: defaultPreset.model || adminSettings.finalElevenLabsModel,
    presetId: defaultPreset.id,
    speed: defaultPreset.speed,
    stability: defaultPreset.stability,
    similarityBoost: defaultPreset.similarityBoost,
    style: defaultPreset.style,
    speakerBoost: defaultPreset.speakerBoost,
    emotionalIntensity: defaultPreset.emotionalIntensity,
    pacing: defaultPreset.pacing,
    tone: defaultPreset.tone,
    deliveryStyle: defaultPreset.deliveryStyle,
    narrationInstruction: defaultPreset.narrationInstruction,
    languageMode: defaultPreset.languageMode,
    useExpressiveTags: adminSettings.expressiveTagsEnabled,
    usePronunciationDictionary: adminSettings.pronunciationDictionaryEnabled,
  } satisfies ReelNarrationSettings;

  return {
    provider: normalizeProvider(raw.provider, fallback.provider),
    fallbackProvider: normalizeFallbackProvider(raw.fallbackProvider ?? raw.fallback_provider ?? fallback.fallbackProvider),
    language: cleanString(raw.language, fallback.language),
    languageSource: raw.languageSource === 'user_selected' || raw.language_source === 'user_selected'
      ? 'user_selected'
      : raw.languageSource === 'auto_detected' || raw.language_source === 'auto_detected'
      ? 'auto_detected'
      : 'reel_language',
    detectedLanguage: cleanString(raw.detectedLanguage ?? raw.detected_language) || null,
    isMixedLanguage: normalizeBoolean(raw.isMixedLanguage ?? raw.is_mixed_language, fallback.isMixedLanguage),
    voiceGender,
    voiceId: rawVoiceId || fallback.voiceId,
    model: cleanString(raw.model, fallback.model),
    presetId: cleanString(raw.presetId ?? raw.preset_id, fallback.presetId ?? '') || null,
    speed: normalizeNumber(raw.speed, fallback.speed, 0.5, 2),
    stability: normalizeNumber(raw.stability, fallback.stability, 0, 1),
    similarityBoost: normalizeNumber(raw.similarityBoost ?? raw.similarity_boost, fallback.similarityBoost, 0, 1),
    style: normalizeNumber(raw.style, fallback.style, 0, 1),
    speakerBoost: normalizeBoolean(raw.speakerBoost ?? raw.speaker_boost, fallback.speakerBoost),
    emotionalIntensity: normalizeNumber(raw.emotionalIntensity ?? raw.emotional_intensity, fallback.emotionalIntensity, 0, 1),
    pacing: cleanString(raw.pacing, fallback.pacing),
    tone: cleanString(raw.tone, fallback.tone),
    deliveryStyle: cleanString(raw.deliveryStyle ?? raw.delivery_style, fallback.deliveryStyle),
    narrationInstruction: cleanString(raw.narrationInstruction ?? raw.narration_instruction, fallback.narrationInstruction),
    languageMode: normalizeLanguageMode(raw.languageMode ?? raw.language_mode ?? fallback.languageMode),
    useExpressiveTags: normalizeBoolean(raw.useExpressiveTags ?? raw.use_expressive_tags, fallback.useExpressiveTags),
    usePronunciationDictionary: normalizeBoolean(raw.usePronunciationDictionary ?? raw.use_pronunciation_dictionary, fallback.usePronunciationDictionary),
    pauseStyle: cleanString(raw.pauseStyle ?? raw.pause_style, fallback.pauseStyle),
  };
}

export function applyPresetToNarrationSettings(
  settings: ReelNarrationSettings,
  preset: NarrationPreset,
  adminSettings: ReelNarrationAdminSettings = DEFAULT_REEL_NARRATION_ADMIN_SETTINGS
): ReelNarrationSettings {
  return normalizeReelNarrationSettings(
    {
      ...settings,
      provider: preset.provider,
      presetId: preset.id,
      model: preset.model || settings.model,
      voiceGender: getReelNarrationVoiceGender(adminSettings, preset.voiceId) ?? settings.voiceGender,
      voiceId: preset.voiceId || settings.voiceId,
      languageMode: preset.languageMode,
      speed: preset.speed,
      stability: preset.stability,
      similarityBoost: preset.similarityBoost,
      style: preset.style,
      speakerBoost: preset.speakerBoost,
      tone: preset.tone,
      emotionalIntensity: preset.emotionalIntensity,
      pacing: preset.pacing,
      deliveryStyle: preset.deliveryStyle,
      narrationInstruction: preset.narrationInstruction,
    },
    { adminSettings, preset }
  );
}

export function detectNarrationLanguage(text: string, selectedLanguage: string): NarrationLanguageDetection {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return {
      selectedLanguage,
      detectedLanguage: null,
      isMixedLanguage: false,
      notice: null,
    };
  }

  const devanagari = (compact.match(/[\u0900-\u097F]/g) || []).length;
  const bengali = (compact.match(/[\u0980-\u09FF]/g) || []).length;
  const gujarati = (compact.match(/[\u0A80-\u0AFF]/g) || []).length;
  const arabic = (compact.match(/[\u0600-\u06FF]/g) || []).length;
  const latinLetters = (compact.match(/[A-Za-z]/g) || []).length;
  const hinglishMarkers = /\b(dil|kahani|zindagi|pyaar|safar|yaad|sapna|khushi|dard|roshni|andhera|rishta|awaaz)\b/i.test(compact);
  const hasIndic = devanagari > 0 || bengali > 0 || gujarati > 0 || arabic > 0 || hinglishMarkers;
  const hasLatin = latinLetters > 0;
  const scriptCount = [devanagari, bengali, gujarati, arabic].filter((count) => count > 0).length;
  const isMixedLanguage = (hasIndic && hasLatin) || scriptCount > 1;
  let detectedLanguage: string | null = null;

  if (devanagari > arabic && devanagari > latinLetters * 0.25) {
    detectedLanguage = 'hi-IN';
  } else if (bengali > latinLetters * 0.25) {
    detectedLanguage = 'bn-IN';
  } else if (gujarati > latinLetters * 0.25) {
    detectedLanguage = 'gu-IN';
  } else if (arabic > devanagari && arabic > latinLetters * 0.2) {
    detectedLanguage = 'ur-IN';
  } else if (hinglishMarkers && hasLatin) {
    detectedLanguage = 'hi-IN';
  } else if (latinLetters > 0) {
    const selectedLower = selectedLanguage.toLowerCase();
    detectedLanguage = selectedLower.startsWith('hi') && hinglishMarkers
      ? 'hi-IN'
      : selectedLower.startsWith('bn') || selectedLower.startsWith('gu') || selectedLower.startsWith('ur')
      ? selectedLanguage
      : 'en-IN';
  }

  const selectedRoot = selectedLanguage.slice(0, 2).toLowerCase();
  const detectedRoot = detectedLanguage?.slice(0, 2).toLowerCase();
  const differs = Boolean(detectedRoot && selectedRoot && detectedRoot !== selectedRoot);

  return {
    selectedLanguage,
    detectedLanguage,
    isMixedLanguage,
    notice: differs || isMixedLanguage
      ? `Selected ${selectedLanguage}; detected ${detectedLanguage ?? 'mixed/unknown'}${isMixedLanguage ? ' with mixed-language narration' : ''}.`
      : null,
  };
}

export function elevenLabsModelSupportsExpressiveTags(model: string | null | undefined): boolean {
  const normalized = cleanString(model).toLowerCase();
  return normalized.includes('v3') || normalized.includes('alpha') || normalized.includes('expressive');
}

export function normalizeReelNarrationPanelPauseMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(3000, Math.round(parsed)));
}

function formatPanelPauseSeparator(pauseMs: number, supportsExpressiveTags: boolean): string {
  const normalizedPauseMs = normalizeReelNarrationPanelPauseMs(pauseMs);
  if (normalizedPauseMs <= 0) return '\n';
  if (supportsExpressiveTags) {
    return normalizedPauseMs >= 1200 ? '\n[long pause]\n' : '\n[pause]\n';
  }

  const seconds = (normalizedPauseMs / 1000)
    .toFixed(2)
    .replace(/0+$/g, '')
    .replace(/\.$/g, '');
  return `\n<break time="${seconds}s" />\n`;
}

function stripExpressiveTags(text: string): string {
  return text
    .replace(/\[(?:whisper|softly|pause|sigh|warmly|slowly|breath|dramatic|gentle)[^\]]*\]/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function paceText(text: string, pacing: string, pauseStyle: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return normalized;
  const sentenceBreak = pacing === 'very_slow' || pacing === 'slow' ? '\n\n' : '\n';
  const paced = normalized.replace(/([.!?])\s+/g, `$1${sentenceBreak}`);
  if (pauseStyle === 'long') {
    return paced.replace(/,\s+/g, ', ... ');
  }
  if (pauseStyle === 'short') {
    return paced.replace(/;\s+/g, ', ');
  }
  return paced;
}

function getPacedNarrationParts(input: {
  text: string;
  captionTexts?: string[];
  pacing: string;
  pauseStyle: string;
}): string[] {
  const captionParts = input.captionTexts
    ?.map((text) => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const sourceParts = captionParts && captionParts.length > 0
    ? captionParts
    : [input.text.replace(/\s+/g, ' ').trim()].filter(Boolean);
  return sourceParts.map((part) => paceText(part, input.pacing, input.pauseStyle));
}

export function buildNarrationDeliveryInstruction(
  settings: ReelNarrationSettings,
  preset?: NarrationPreset | null
): string {
  const source = preset ?? getNarrationPresetById(settings.presetId);
  return [
    source?.narrationInstruction || settings.narrationInstruction,
    `Tone: ${settings.tone}.`,
    `Delivery: ${settings.deliveryStyle}.`,
    `Pacing: ${settings.pacing}; pause style: ${settings.pauseStyle}.`,
    `Emotional intensity: ${Math.round(settings.emotionalIntensity * 100)}%.`,
  ].filter(Boolean).join(' ');
}

export function buildNarrationPerformanceScript(input: {
  text: string;
  captionTexts?: string[];
  panelPauseMs?: number;
  settings: ReelNarrationSettings;
  preset?: NarrationPreset | null;
  provider: NarrationProvider;
  adminSettings?: ReelNarrationAdminSettings;
  generationMode?: NarrationGenerationMode;
}): NarrationPerformanceScript {
  const adminSettings = input.adminSettings ?? DEFAULT_REEL_NARRATION_ADMIN_SETTINGS;
  const language = detectNarrationLanguage(input.text, input.settings.language);
  const deliveryInstruction = buildNarrationDeliveryInstruction(input.settings, input.preset);
  const supportsExpressiveTags = input.provider === 'elevenlabs'
    && adminSettings.expressiveTagsEnabled
    && input.settings.useExpressiveTags
    && elevenLabsModelSupportsExpressiveTags(input.settings.model);
  const pacedParts = getPacedNarrationParts({
    text: input.text,
    captionTexts: input.captionTexts,
    pacing: input.settings.pacing,
    pauseStyle: input.settings.pauseStyle,
  });
  const pacedText = pacedParts.join('\n');

  if (input.provider === 'gemini_tts') {
    return {
      text: stripExpressiveTags(pacedText),
      deliveryInstruction,
      language,
      expressiveTagsUsed: false,
      modelSupportsExpressiveTags: false,
    };
  }

  if (!supportsExpressiveTags) {
    const separator = formatPanelPauseSeparator(input.panelPauseMs ?? 0, false);
    return {
      text: pacedParts.map(stripExpressiveTags).join(separator),
      deliveryInstruction,
      language,
      expressiveTagsUsed: false,
      modelSupportsExpressiveTags: false,
    };
  }

  const tag = input.settings.emotionalIntensity > 0.65
    ? '[warmly, with feeling]'
    : input.settings.pacing === 'very_slow' || input.settings.pacing === 'slow'
    ? '[softly, slowly]'
    : '[gently]';
  const separator = formatPanelPauseSeparator(input.panelPauseMs ?? 0, true);

  return {
    text: `${tag}\n${pacedParts.join(separator)}`.trim(),
    deliveryInstruction,
    language,
    expressiveTagsUsed: true,
    modelSupportsExpressiveTags: true,
  };
}

export function buildPresetInputFromSettings(
  settings: ReelNarrationSettings,
  name: string,
  description = ''
): Omit<NarrationPreset, 'id' | 'userId' | 'presetScope' | 'presetVisibility' | 'isDefault' | 'createdAt' | 'updatedAt'> {
  return {
    name,
    description,
    provider: settings.provider,
    model: settings.model,
    voiceId: settings.voiceId,
    languageMode: settings.languageMode,
    speed: settings.speed,
    stability: settings.stability,
    similarityBoost: settings.similarityBoost,
    style: settings.style,
    speakerBoost: settings.speakerBoost,
    tone: settings.tone,
    emotionalIntensity: settings.emotionalIntensity,
    pacing: settings.pacing,
    deliveryStyle: settings.deliveryStyle,
    narrationInstruction: settings.narrationInstruction,
  };
}
