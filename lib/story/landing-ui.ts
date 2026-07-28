import {
  DEFAULT_REEL_STORY_SETTINGS,
  normalizeReelStorySettings,
  type ReelStorySetupSettings,
} from '@/lib/reel/settings';
import type {
  NarrationGenderBucket,
  NarrationVoiceClientConfig,
} from '@/lib/ai/narration-voices';
import {
  STORY_LANGUAGE_OPTIONS,
  getEnabledStoryLanguageOptions,
  DEFAULT_ENABLED_STORY_LANGUAGE_IDS,
  type StoryLanguageOption,
} from '@/lib/ai/story-config';
import { DEFAULT_STORY_AUTHORING_WORD_CAP } from '@/lib/story/authoring-limits';

export interface LandingSetupSettings {
  freePlusCharacterSheetsEnabled: boolean;
  creatorCharacterSheetsEnabled: boolean;
  storyPromptOnlyModeEnabled: boolean;
  verticalStoriesSettingEnabled: boolean;
}

export interface LandingInitialData {
  setupSettings: LandingSetupSettings;
  authoringWordCap: number;
  reelSetup: ReelStorySetupSettings;
  narrationVoiceConfig: NarrationVoiceClientConfig | null;
  /** Admin-enabled story languages offered in the picker (catalog order). */
  storyLanguageOptions: StoryLanguageOption[];
}

export const DEFAULT_LANDING_SETUP_SETTINGS: LandingSetupSettings = {
  freePlusCharacterSheetsEnabled: false,
  creatorCharacterSheetsEnabled: false,
  storyPromptOnlyModeEnabled: false,
  verticalStoriesSettingEnabled: false,
};

export const FALLBACK_REEL_SETUP: ReelStorySetupSettings = {
  enabled: false,
  publishEnabled: false,
  settings: DEFAULT_REEL_STORY_SETTINGS,
};

export const DEFAULT_LANDING_INITIAL_DATA: LandingInitialData = {
  setupSettings: DEFAULT_LANDING_SETUP_SETTINGS,
  authoringWordCap: DEFAULT_STORY_AUTHORING_WORD_CAP,
  reelSetup: FALLBACK_REEL_SETUP,
  narrationVoiceConfig: null,
  storyLanguageOptions: getEnabledStoryLanguageOptions(DEFAULT_ENABLED_STORY_LANGUAGE_IDS),
};

export function normalizeLandingInitialData(input?: Partial<LandingInitialData> | null): LandingInitialData {
  return {
    setupSettings: {
      ...DEFAULT_LANDING_SETUP_SETTINGS,
      ...(input?.setupSettings ?? {}),
    },
    authoringWordCap: typeof input?.authoringWordCap === 'number' && Number.isFinite(input.authoringWordCap)
      ? input.authoringWordCap
      : DEFAULT_LANDING_INITIAL_DATA.authoringWordCap,
    reelSetup: input?.reelSetup
      ? {
          enabled: Boolean(input.reelSetup.enabled),
          publishEnabled: Boolean(input.reelSetup.publishEnabled),
          settings: normalizeReelStorySettings(input.reelSetup.settings),
        }
      : FALLBACK_REEL_SETUP,
    narrationVoiceConfig: input?.narrationVoiceConfig ?? null,
    storyLanguageOptions:
      input?.storyLanguageOptions && input.storyLanguageOptions.length > 0
        ? input.storyLanguageOptions
        : getEnabledStoryLanguageOptions(DEFAULT_ENABLED_STORY_LANGUAGE_IDS),
  };
}

/** All catalog languages (for admin/reference), regardless of enabled state. */
export const ALL_STORY_LANGUAGE_OPTIONS: StoryLanguageOption[] = STORY_LANGUAGE_OPTIONS;

export function getDefaultNarrationVoiceSelection(
  config: NarrationVoiceClientConfig | null | undefined,
  genderBucket: NarrationGenderBucket = 'female'
): { genderBucket: NarrationGenderBucket; voiceId: string; accent: string } {
  const accent = config?.accentEnabled ? (config.defaultAccent || config.accentOptions[0]?.id || '') : '';
  if (!config?.enabled) {
    return { genderBucket, voiceId: '', accent };
  }

  const voiceList = genderBucket === 'male' ? config.maleVoiceList : config.femaleVoiceList;
  const configuredDefault = genderBucket === 'male' ? config.defaultMaleVoice : config.defaultFemaleVoice;
  return {
    genderBucket,
    voiceId: voiceList.includes(configuredDefault) ? configuredDefault : voiceList[0] || '',
    accent,
  };
}
