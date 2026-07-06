import { Suspense } from 'react';
import { unstable_cache } from 'next/cache';
import { getReelStorySetupSettings, getStoryboardSettings } from '@/app/actions/admin';
import { getNarrationVoiceSelectionConfig } from '@/app/actions/narration';
import { getEnabledStoryLanguageOptionsForClient } from '@/lib/ai/story-language-settings';
import HomeContent from '@/components/story/HomeContent';
import {
  DEFAULT_LANDING_SETUP_SETTINGS,
  FALLBACK_REEL_SETUP,
  normalizeLandingInitialData,
  type LandingInitialData,
} from '@/lib/story/landing-ui';

const getCachedLandingInitialData = unstable_cache(
  async (): Promise<LandingInitialData> => {
    const [storyboardSettings, reelSetup, narrationVoiceConfig, storyLanguageOptions] = await Promise.all([
      getStoryboardSettings().catch(() => null),
      getReelStorySetupSettings().catch(() => FALLBACK_REEL_SETUP),
      // Cached, cross-user landing payload — skip the per-user (cookie-reading)
      // plan lookup; LandingScreen re-resolves accent gating per user at runtime.
      getNarrationVoiceSelectionConfig('english', { skipPlanResolution: true }).catch(() => null),
      getEnabledStoryLanguageOptionsForClient().catch(() => undefined),
    ]);

    return normalizeLandingInitialData({
      setupSettings: storyboardSettings
        ? {
            freePlusCharacterSheetsEnabled: storyboardSettings.freePlusCharacterSheetsEnabled,
            creatorCharacterSheetsEnabled: storyboardSettings.creatorCharacterSheetsEnabled,
            storyPromptOnlyModeEnabled: storyboardSettings.storyPromptOnlyModeEnabled,
            verticalStoriesSettingEnabled: storyboardSettings.verticalStoriesSettingEnabled,
          }
        : DEFAULT_LANDING_SETUP_SETTINGS,
      authoringWordCap: storyboardSettings?.authoringWordCap,
      reelSetup,
      narrationVoiceConfig,
      storyLanguageOptions,
    });
  },
  ['kissago-landing-initial-data-v1'],
  { revalidate: 60 }
);

export default async function Home() {
  const initialLandingData = await getCachedLandingInitialData();

  return (
    <Suspense>
      <HomeContent
        initialLandingData={initialLandingData}
      />
    </Suspense>
  );
}
