import type { StoryLanguage } from '@/lib/types/story';
import type { NarrationAccentOption, NarrationAccentTierMap } from '@/lib/ai/narration-accents';

export type NarrationGenderBucket = 'male' | 'female';
export type NarrationVoiceMode = 'legacy_auto' | 'user_selected';
export type NarrationLanguageCode = 'en-IN' | 'hi-IN';
export type NarrationVoiceSampleStatus = 'pending' | 'generating' | 'ready' | 'failed';

export interface NarrationVoiceLanguage {
  code: NarrationLanguageCode;
  storyLanguage: StoryLanguage;
  label: string;
  sampleTextFlagKey: string;
}

export interface NarrationVoiceSampleClientStatus {
  voiceId: string;
  genderBucket: NarrationGenderBucket;
  languageCode: NarrationLanguageCode;
  status: NarrationVoiceSampleStatus;
  audioUrl: string | null;
  lastGeneratedAt: string | null;
  error: string | null;
}

export interface NarrationVoiceSettings {
  userLedVoiceSelectionEnabled: boolean;
  maleVoiceList: string[];
  femaleVoiceList: string[];
  defaultMaleVoice: string;
  defaultFemaleVoice: string;
  sampleTextByLanguage: Record<NarrationLanguageCode, string>;
  supportedLanguages: NarrationVoiceLanguage[];
  accentSelectionEnabled: boolean;
  accentOptions: NarrationAccentOption[];
  defaultAccent: string;
  accentTierMap: NarrationAccentTierMap;
}

export interface NarrationVoiceSettingsSaveResult {
  settings: NarrationVoiceSettings;
  warnings: string[];
}

export interface NarrationVoiceClientConfig {
  enabled: boolean;
  maleVoiceList: string[];
  femaleVoiceList: string[];
  defaultMaleVoice: string;
  defaultFemaleVoice: string;
  languageCode: NarrationLanguageCode;
  requestedStoryLanguage: StoryLanguage;
  fallbackToEnglishSample: boolean;
  samples: NarrationVoiceSampleClientStatus[];
  // Accent options the current user's plan may use. Empty/absent when accent
  // selection is disabled or the story language is not English.
  accentEnabled: boolean;
  accentOptions: NarrationAccentOption[];
  defaultAccent: string;
}

export interface StoryNarrationVoiceSelection {
  mode: NarrationVoiceMode;
  genderBucket?: NarrationGenderBucket;
  voiceId?: string;
  languageCode?: NarrationLanguageCode;
  accent?: string;
}

export const DEFAULT_MALE_NARRATION_VOICES = [
  'Charon',
  'Puck',
  'Fenrir',
  'Umbriel',
  'Orus',
  'Achird',
] as const;

export const DEFAULT_FEMALE_NARRATION_VOICES = [
  'Kore',
  'Aoede',
  'Leda',
  'Zephyr',
  'Sulafat',
  'Callirrhoe',
] as const;

export const DEFAULT_NARRATION_SAMPLE_TEXT: Record<NarrationLanguageCode, string> = {
  'en-IN': 'Once upon a time, in a quiet corner of the world, a small story was waiting to come alive.',
  'hi-IN': 'एक बार की बात है, दुनिया के एक शांत कोने में, एक छोटी सी कहानी जीवंत होने का इंतज़ार कर रही थी।',
};

export const SUPPORTED_NARRATION_VOICE_LANGUAGES: NarrationVoiceLanguage[] = [
  {
    code: 'en-IN',
    storyLanguage: 'english',
    label: 'English (India)',
    sampleTextFlagKey: 'narration_sample_text_en_in',
  },
  {
    code: 'hi-IN',
    storyLanguage: 'hindi',
    label: 'Hindi (India)',
    sampleTextFlagKey: 'narration_sample_text_hi_in',
  },
];

export const NARRATION_VOICE_FLAG_KEYS = {
  userLedEnabled: 'narration_user_led_voice_selection_enabled',
  maleVoiceList: 'narration_male_voice_list',
  femaleVoiceList: 'narration_female_voice_list',
  defaultMaleVoice: 'narration_default_male_voice',
  defaultFemaleVoice: 'narration_default_female_voice',
} as const;

export function parseNarrationVoiceListValue(value: string | null | undefined, fallback: readonly string[]): string[] {
  if (!value?.trim()) {
    return [...fallback];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const normalized = normalizeNarrationVoiceList(parsed.map(String));
      return normalized.length > 0 ? normalized : [...fallback];
    }
  } catch {
    // Fall through to multiline/comma parsing.
  }

  const normalized = normalizeNarrationVoiceList(value.split(/[\n,]/));
  return normalized.length > 0 ? normalized : [...fallback];
}

export function normalizeNarrationVoiceList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const voices: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    voices.push(trimmed);
  }

  return voices;
}

export function serializeNarrationVoiceList(voices: readonly string[]): string {
  return JSON.stringify(normalizeNarrationVoiceList(voices));
}

export function voicesToMultilineText(voices: readonly string[]): string {
  return normalizeNarrationVoiceList(voices).join('\n');
}

export function resolveStoryNarrationLanguage(
  storyLanguage: StoryLanguage | string | null | undefined
): { languageCode: NarrationLanguageCode; fallbackToEnglishSample: boolean } {
  const match = SUPPORTED_NARRATION_VOICE_LANGUAGES.find((language) => language.storyLanguage === storyLanguage);
  if (match) {
    return { languageCode: match.code, fallbackToEnglishSample: false };
  }

  return { languageCode: 'en-IN', fallbackToEnglishSample: true };
}

export function getDefaultVoiceForGender(
  genderBucket: NarrationGenderBucket,
  settings: Pick<NarrationVoiceSettings, 'defaultMaleVoice' | 'defaultFemaleVoice'>
): string {
  return genderBucket === 'male' ? settings.defaultMaleVoice : settings.defaultFemaleVoice;
}

export function getVoiceListForGender(
  genderBucket: NarrationGenderBucket,
  settings: Pick<NarrationVoiceSettings, 'maleVoiceList' | 'femaleVoiceList'>
): string[] {
  return genderBucket === 'male' ? settings.maleVoiceList : settings.femaleVoiceList;
}
