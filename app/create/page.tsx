import { Suspense } from 'react';
import { unstable_cache } from 'next/cache';
import { getReelStorySetupSettings, getStoryboardSettings } from '@/app/actions/admin';
import { getNarrationVoiceSelectionConfig } from '@/app/actions/narration';
import { getEnabledStoryLanguageOptionsForClient } from '@/lib/ai/story-language-settings';
import { getPublishedStoryVisualCatalog } from '@/lib/ai/story-visual-options.server';
import HomeContent from '@/components/story/HomeContent';
import {
  DEFAULT_LANDING_SETUP_SETTINGS,
  FALLBACK_REEL_SETUP,
  normalizeLandingInitialData,
  type LandingInitialData,
} from '@/lib/story/landing-ui';

const getCachedLandingInitialData = unstable_cache(
  async (): Promise<LandingInitialData> => {
    const [storyboardSettings, reelSetup, narrationVoiceConfig, storyLanguageOptions, storyVisualCatalog] = await Promise.all([
      getStoryboardSettings().catch(() => null),
      getReelStorySetupSettings().catch(() => FALLBACK_REEL_SETUP),
      // Cached, cross-user landing payload — skip the per-user (cookie-reading)
      // plan lookup; LandingScreen re-resolves accent gating per user at runtime.
      getNarrationVoiceSelectionConfig('english', { skipPlanResolution: true }).catch(() => null),
      getEnabledStoryLanguageOptionsForClient().catch(() => undefined),
      getPublishedStoryVisualCatalog().catch(() => undefined),
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
      storyBeatLengthDefaultLevel: storyboardSettings?.storyBeatLengthDefaultLevel,
      reelSetup,
      narrationVoiceConfig,
      storyLanguageOptions,
      storyVisualCatalog,
    });
  },
  ['kissago-landing-initial-data-v3'],
  { revalidate: 60 }
);

/**
 * The authoring surface — the prompt composer and, once a story is under way,
 * the beat screen that replaces it in place.
 *
 * This used to be the root route, back when Kissago opened on a blank prompt.
 * The gallery owns `/` now and creating is an opt-in second act reached from
 * the Create pill, so the composer lives here on its own URL. Nothing about the
 * page itself changed in the move: the cached landing payload is the same
 * cross-user blob, still revalidated every 60s.
 */
export default async function CreatePage() {
  const initialLandingData = await getCachedLandingInitialData();

  return (
    <Suspense>
      <HomeContent
        initialLandingData={initialLandingData}
      />
    </Suspense>
  );
}
