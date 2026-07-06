import 'server-only';

import { getFeatureFlagValue, setFeatureFlagValue } from '@/lib/ai/model-config';
import {
  DEFAULT_ENABLED_STORY_LANGUAGE_IDS,
  STORY_LANGUAGE_ENABLED_FLAG_KEY,
  getEnabledStoryLanguageOptions,
  parseEnabledStoryLanguageIds,
  serializeEnabledStoryLanguageIds,
  type StoryLanguageOption,
} from '@/lib/ai/story-config';
import type { StoryLanguage } from '@/lib/types/story';

/**
 * Admin-controlled availability of story languages. The full catalog lives in
 * story-config.ts (STORY_LANGUAGE_OPTIONS); this module reads/writes the subset an
 * admin has enabled. Availability is global (every user sees the same enabled set);
 * validation of already-saved stories still uses the full catalog, so disabling a
 * language only hides it from the picker — it never breaks existing stories.
 */

/** The enabled story-language ids (falls back to the built-in default set). */
export async function getEnabledStoryLanguageIds(): Promise<StoryLanguage[]> {
  const value = await getFeatureFlagValue(STORY_LANGUAGE_ENABLED_FLAG_KEY);
  return parseEnabledStoryLanguageIds(value);
}

/** The enabled languages as picker-ready options, in catalog order. */
export async function getEnabledStoryLanguageOptionsForClient(): Promise<StoryLanguageOption[]> {
  const ids = await getEnabledStoryLanguageIds();
  return getEnabledStoryLanguageOptions(ids);
}

/** Persist the admin's enabled-language selection; returns the normalized ids. */
export async function saveEnabledStoryLanguageIds(
  ids: readonly StoryLanguage[]
): Promise<StoryLanguage[]> {
  const serialized = serializeEnabledStoryLanguageIds(ids);
  await setFeatureFlagValue(STORY_LANGUAGE_ENABLED_FLAG_KEY, serialized);
  return parseEnabledStoryLanguageIds(serialized);
}

export { DEFAULT_ENABLED_STORY_LANGUAGE_IDS };
