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
import {
  DEFAULT_NARRATION_ACCENTS,
  NARRATION_ACCENT_FLAG_KEYS,
  getAllowedAccentsForPlan,
  normalizeNarrationAccentList,
  parseNarrationAccentListValue,
  parseNarrationAccentTierMapValue,
  resolveAccentInstruction,
  resolveDefaultAccentId,
  serializeNarrationAccentList,
  serializeNarrationAccentTierMap,
  type NarrationAccentOption,
  type NarrationAccentTierMap,
} from '@/lib/ai/narration-accents';

export interface NarrationVoiceSettingsInput {
  userLedVoiceSelectionEnabled: boolean;
  maleVoiceList: string[];
  femaleVoiceList: string[];
  defaultMaleVoice: string;
  defaultFemaleVoice: string;
  sampleTextByLanguage: Partial<Record<NarrationLanguageCode, string>>;
  accentSelectionEnabled: boolean;
  accentOptions: NarrationAccentOption[];
  defaultAccent: string;
  accentTierMap: NarrationAccentTierMap;
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
    accentSelectionEnabled,
    accentListValue,
    defaultAccentValue,
    accentTierMapValue,
  ] = await Promise.all([
    getFeatureFlag(NARRATION_VOICE_FLAG_KEYS.userLedEnabled, false),
    getFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.maleVoiceList),
    getFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.femaleVoiceList),
    getFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.defaultMaleVoice),
    getFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.defaultFemaleVoice),
    getFeatureFlagValue('narration_sample_text_en_in'),
    getFeatureFlagValue('narration_sample_text_hi_in'),
    getFeatureFlag(NARRATION_ACCENT_FLAG_KEYS.enabled, false),
    getFeatureFlagValue(NARRATION_ACCENT_FLAG_KEYS.accentList),
    getFeatureFlagValue(NARRATION_ACCENT_FLAG_KEYS.defaultAccent),
    getFeatureFlagValue(NARRATION_ACCENT_FLAG_KEYS.tierMap),
  ]);

  const maleVoiceList = parseNarrationVoiceListValue(maleVoiceListValue, DEFAULT_MALE_NARRATION_VOICES);
  const femaleVoiceList = parseNarrationVoiceListValue(femaleVoiceListValue, DEFAULT_FEMALE_NARRATION_VOICES);
  const defaultMaleVoice = normalizeDefaultVoice(defaultMaleVoiceValue, maleVoiceList, DEFAULT_MALE_NARRATION_VOICES[0]).voice;
  const defaultFemaleVoice = normalizeDefaultVoice(defaultFemaleVoiceValue, femaleVoiceList, DEFAULT_FEMALE_NARRATION_VOICES[0]).voice;

  const accentOptions = parseNarrationAccentListValue(accentListValue);
  const defaultAccent = resolveDefaultAccentId(accentOptions, defaultAccentValue);
  const accentTierMap = parseNarrationAccentTierMapValue(accentTierMapValue);

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
    accentSelectionEnabled,
    accentOptions,
    defaultAccent,
    accentTierMap,
  };
}

/**
 * Resolve the natural-language TTS instruction for a stored accent id, or null if
 * the id is absent/unknown. Honored at generation time regardless of the picker's
 * enabled flag so already-locked stories keep their accent.
 */
export async function getNarrationAccentInstruction(
  accentId: string | null | undefined
): Promise<string | null> {
  const id = accentId?.trim().toLowerCase();
  if (!id) return null;
  const settings = await getNarrationVoiceSettings();
  return resolveAccentInstruction(id, settings.accentOptions);
}

/**
 * Resolve the accent options a given plan may use, plus the effective default.
 * Returns an empty option list when accent selection is disabled.
 */
export async function getNarrationAccentSelectionForPlan(
  planKey: string | null | undefined
): Promise<{ enabled: boolean; accentOptions: NarrationAccentOption[]; defaultAccent: string }> {
  const settings = await getNarrationVoiceSettings();
  if (!settings.accentSelectionEnabled) {
    return { enabled: false, accentOptions: [], defaultAccent: settings.defaultAccent };
  }
  const accentOptions = getAllowedAccentsForPlan(
    settings.accentOptions,
    settings.accentTierMap,
    planKey,
    settings.defaultAccent
  );
  const defaultAccent = accentOptions.some((accent) => accent.id === settings.defaultAccent)
    ? settings.defaultAccent
    : accentOptions[0]?.id ?? settings.defaultAccent;
  return { enabled: true, accentOptions, defaultAccent };
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

  let accentOptions = normalizeNarrationAccentList(input.accentOptions);
  if (accentOptions.length === 0) {
    accentOptions = [...DEFAULT_NARRATION_ACCENTS];
    warnings.push('Accent list was empty and has been reset to the default curated list.');
  }
  const defaultAccent = resolveDefaultAccentId(accentOptions, input.defaultAccent);
  if (input.defaultAccent?.trim() && defaultAccent !== input.defaultAccent.trim().toLowerCase()) {
    warnings.push(`Default accent "${input.defaultAccent}" is not in the accent list and was reset to "${defaultAccent}".`);
  }

  // Keep the tier map referencing only accents that still exist.
  const availableAccentIds = new Set(accentOptions.map((accent) => accent.id));
  const accentTierMap: NarrationAccentTierMap = {};
  for (const [planKey, ids] of Object.entries(input.accentTierMap ?? {})) {
    const filtered = Array.from(
      new Set((ids ?? []).map((id) => String(id).trim().toLowerCase()).filter((id) => availableAccentIds.has(id)))
    );
    if (filtered.length > 0) accentTierMap[planKey.trim().toLowerCase()] = filtered;
  }

  await Promise.all([
    setFeatureFlag(NARRATION_VOICE_FLAG_KEYS.userLedEnabled, input.userLedVoiceSelectionEnabled),
    setFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.maleVoiceList, serializeNarrationVoiceList(maleVoiceList)),
    setFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.femaleVoiceList, serializeNarrationVoiceList(femaleVoiceList)),
    setFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.defaultMaleVoice, defaultMale.voice),
    setFeatureFlagValue(NARRATION_VOICE_FLAG_KEYS.defaultFemaleVoice, defaultFemale.voice),
    setFeatureFlagValue('narration_sample_text_en_in', sampleTextByLanguage['en-IN']),
    setFeatureFlagValue('narration_sample_text_hi_in', sampleTextByLanguage['hi-IN']),
    setFeatureFlag(NARRATION_ACCENT_FLAG_KEYS.enabled, input.accentSelectionEnabled),
    setFeatureFlagValue(NARRATION_ACCENT_FLAG_KEYS.accentList, serializeNarrationAccentList(accentOptions)),
    setFeatureFlagValue(NARRATION_ACCENT_FLAG_KEYS.defaultAccent, defaultAccent),
    setFeatureFlagValue(NARRATION_ACCENT_FLAG_KEYS.tierMap, serializeNarrationAccentTierMap(accentTierMap)),
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
      accentSelectionEnabled: input.accentSelectionEnabled,
      accentOptions,
      defaultAccent,
      accentTierMap,
    },
    warnings,
  };
}
