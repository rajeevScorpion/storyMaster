import 'server-only';

import { getFeatureFlag, getFeatureFlagValue, setFeatureFlag, setFeatureFlagValue } from '@/lib/ai/model-config';
import {
  DEFAULT_FEMALE_NARRATION_VOICES,
  DEFAULT_MALE_NARRATION_VOICES,
  DEFAULT_NARRATION_SAMPLE_TEXT,
  NARRATION_VOICE_FLAG_KEYS,
  SUPPORTED_NARRATION_VOICE_LANGUAGES,
  normalizeNarrationVoiceList,
  parseNarrationVoiceListValue,
  serializeNarrationVoiceList,
  type NarrationLanguageCode,
  type NarrationVoiceSettings,
  type NarrationVoiceSettingsSaveResult,
} from '@/lib/ai/narration-voices';

export interface NarrationVoiceSettingsInput {
  userLedVoiceSelectionEnabled: boolean;
  maleVoiceList: string[];
  femaleVoiceList: string[];
  defaultMaleVoice: string;
  defaultFemaleVoice: string;
  sampleTextByLanguage: Partial<Record<NarrationLanguageCode, string>>;
}

function normalizeDefaultVoice(defaultVoice: string | null | undefined, list: string[], fallback: string): {
  voice: string;
  warning: string | null;
} {
  const trimmed = defaultVoice?.trim() || '';
  if (trimmed && list.includes(trimmed)) {
    return { voice: trimmed, warning: null };
  }

  const replacement = list[0] || fallback;
  if (!trimmed) {
    return { voice: replacement, warning: null };
  }

  return {
    voice: replacement,
    warning: `Default voice "${trimmed}" is not in its voice list and was reset to "${replacement}".`,
  };
}

export async function getNarrationVoiceSettings(): Promise<NarrationVoiceSettings> {
  const [
    userLedVoiceSelectionEnabled,
    maleVoiceListValue,
    femaleVoiceListValue,
    defaultMaleVoiceValue,
    defaultFemaleVoiceValue,
    englishSampleText,
    hindiSampleText,
  ] = await Promise.all([
    getFeatureFlag(NARRATION_VOICE_FLAG_KEYS.userLedEnabled, false),
    getFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.maleVoiceList),
    getFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.femaleVoiceList),
    getFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.defaultMaleVoice),
    getFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.defaultFemaleVoice),
    getFeatureFlagValue('narration_sample_text_en_in'),
    getFeatureFlagValue('narration_sample_text_hi_in'),
  ]);

  const maleVoiceList = parseNarrationVoiceListValue(maleVoiceListValue, DEFAULT_MALE_NARRATION_VOICES);
  const femaleVoiceList = parseNarrationVoiceListValue(femaleVoiceListValue, DEFAULT_FEMALE_NARRATION_VOICES);
  const defaultMaleVoice = normalizeDefaultVoice(defaultMaleVoiceValue, maleVoiceList, DEFAULT_MALE_NARRATION_VOICES[0]).voice;
  const defaultFemaleVoice = normalizeDefaultVoice(defaultFemaleVoiceValue, femaleVoiceList, DEFAULT_FEMALE_NARRATION_VOICES[0]).voice;

  return {
    userLedVoiceSelectionEnabled,
    maleVoiceList,
    femaleVoiceList,
    defaultMaleVoice,
    defaultFemaleVoice,
    sampleTextByLanguage: {
      'en-IN': englishSampleText?.trim() || DEFAULT_NARRATION_SAMPLE_TEXT['en-IN'],
      'hi-IN': hindiSampleText?.trim() || DEFAULT_NARRATION_SAMPLE_TEXT['hi-IN'],
    },
    supportedLanguages: SUPPORTED_NARRATION_VOICE_LANGUAGES,
  };
}

export async function saveNarrationVoiceSettings(
  input: NarrationVoiceSettingsInput
): Promise<NarrationVoiceSettingsSaveResult> {
  const warnings: string[] = [];
  const maleVoiceList = normalizeNarrationVoiceList(input.maleVoiceList);
  const femaleVoiceList = normalizeNarrationVoiceList(input.femaleVoiceList);

  if (maleVoiceList.length === 0) {
    maleVoiceList.push(...DEFAULT_MALE_NARRATION_VOICES);
    warnings.push('Male voice list was empty and has been reset to the default curated list.');
  }

  if (femaleVoiceList.length === 0) {
    femaleVoiceList.push(...DEFAULT_FEMALE_NARRATION_VOICES);
    warnings.push('Female voice list was empty and has been reset to the default curated list.');
  }

  const defaultMale = normalizeDefaultVoice(input.defaultMaleVoice, maleVoiceList, DEFAULT_MALE_NARRATION_VOICES[0]);
  const defaultFemale = normalizeDefaultVoice(input.defaultFemaleVoice, femaleVoiceList, DEFAULT_FEMALE_NARRATION_VOICES[0]);
  if (defaultMale.warning) warnings.push(defaultMale.warning);
  if (defaultFemale.warning) warnings.push(defaultFemale.warning);

  const sampleTextByLanguage: Record<NarrationLanguageCode, string> = {
    'en-IN': input.sampleTextByLanguage['en-IN']?.trim() || DEFAULT_NARRATION_SAMPLE_TEXT['en-IN'],
    'hi-IN': input.sampleTextByLanguage['hi-IN']?.trim() || DEFAULT_NARRATION_SAMPLE_TEXT['hi-IN'],
  };

  await Promise.all([
    setFeatureFlag(NARRATION_VOICE_FLAG_KEYS.userLedEnabled, input.userLedVoiceSelectionEnabled),
    setFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.maleVoiceList, serializeNarrationVoiceList(maleVoiceList)),
    setFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.femaleVoiceList, serializeNarrationVoiceList(femaleVoiceList)),
    setFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.defaultMaleVoice, defaultMale.voice),
    setFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.defaultFemaleVoice, defaultFemale.voice),
    setFeatureFlagValue('narration_sample_text_en_in', sampleTextByLanguage['en-IN']),
    setFeatureFlagValue('narration_sample_text_hi_in', sampleTextByLanguage['hi-IN']),
  ]);

  return {
    settings: {
      userLedVoiceSelectionEnabled: input.userLedVoiceSelectionEnabled,
      maleVoiceList,
      femaleVoiceList,
      defaultMaleVoice: defaultMale.voice,
      defaultFemaleVoice: defaultFemale.voice,
      sampleTextByLanguage,
      supportedLanguages: SUPPORTED_NARRATION_VOICE_LANGUAGES,
    },
    warnings,
  };
}
