import {
  getDefaultVoiceForGender,
  getVoiceListForGender,
  type NarrationGenderBucket,
  type NarrationVoiceMode,
  type NarrationVoiceSettings,
} from '@/lib/ai/narration-voices';

export interface NarrationVoiceResolverInput {
  globalUserLedVoiceSelectionEnabled: boolean;
  settings: Pick<NarrationVoiceSettings, 'maleVoiceList' | 'femaleVoiceList' | 'defaultMaleVoice' | 'defaultFemaleVoice'>;
  storyVoiceMode?: NarrationVoiceMode | null;
  storyVoiceId?: string | null;
  storyGenderBucket?: NarrationGenderBucket | null;
  requestedVoiceMode?: NarrationVoiceMode | null;
  requestedVoiceId?: string | null;
  requestedGenderBucket?: NarrationGenderBucket | null;
  hasPersistedStory?: boolean;
}

export interface NarrationVoiceResolverDecision {
  mode: NarrationVoiceMode;
  voiceId: string | null;
  genderBucket: NarrationGenderBucket | null;
  shouldUseLegacySelector: boolean;
  warnings: string[];
}

export function resolveNarrationVoiceDecision(input: NarrationVoiceResolverInput): NarrationVoiceResolverDecision {
  const warnings: string[] = [];
  const persistedMode = input.storyVoiceMode ?? null;
  const requestedMode = input.requestedVoiceMode ?? null;
  const persistedVoice = input.storyVoiceId?.trim() || null;
  const requestedVoice = input.requestedVoiceId?.trim() || null;
  const genderBucket = input.storyGenderBucket ?? input.requestedGenderBucket ?? 'female';

  if (input.hasPersistedStory && persistedMode === 'legacy_auto') {
    if (persistedVoice) {
      return {
        mode: 'legacy_auto',
        voiceId: persistedVoice,
        genderBucket: input.storyGenderBucket ?? null,
        shouldUseLegacySelector: false,
        warnings,
      };
    }

    return {
      mode: 'legacy_auto',
      voiceId: null,
      genderBucket: input.storyGenderBucket ?? null,
      shouldUseLegacySelector: true,
      warnings,
    };
  }

  const userSelectedActive =
    persistedMode === 'user_selected'
    || requestedMode === 'user_selected'
    || input.globalUserLedVoiceSelectionEnabled;

  if (!userSelectedActive) {
    return {
      mode: 'legacy_auto',
      voiceId: persistedVoice ?? requestedVoice,
      genderBucket: input.storyGenderBucket ?? input.requestedGenderBucket ?? null,
      shouldUseLegacySelector: !persistedVoice && !requestedVoice,
      warnings,
    };
  }

  const allowedVoices = getVoiceListForGender(genderBucket, input.settings);
  const configuredDefault = getDefaultVoiceForGender(genderBucket, input.settings);
  const fallbackVoice = allowedVoices.includes(configuredDefault)
    ? configuredDefault
    : allowedVoices[0] ?? configuredDefault;
  let voiceId = persistedVoice ?? requestedVoice ?? fallbackVoice ?? null;

  if (!voiceId) {
    warnings.push('User-led narration voice selection is enabled, but no voice is configured.');
  } else if (!allowedVoices.includes(voiceId)) {
    warnings.push(`Voice "${voiceId}" is not in the current ${genderBucket} voice list; keeping it for backward compatibility.`);
  }

  return {
    mode: 'user_selected',
    voiceId,
    genderBucket,
    shouldUseLegacySelector: false,
    warnings,
  };
}
