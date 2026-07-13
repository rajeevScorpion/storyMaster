// Shared types and flag keys for Pack 2 character-universe features (character
// library, global save, character mixing, episodic branching, story bible,
// episode journal). Server actions read these flags from the feature_flags
// table; the client receives a snapshot and fails closed.

export const CHARACTER_UNIVERSE_FLAG_KEYS = [
  'character_library_enabled',
  'character_global_save_enabled',
  'character_mixing_enabled',
  'episodes_enabled',
  'story_bible_enabled',
  'episode_journal_enabled',
] as const;

export type CharacterUniverseFlagKey = (typeof CHARACTER_UNIVERSE_FLAG_KEYS)[number];

export interface CharacterUniverseRuntimeSettings {
  libraryEnabled: boolean;
  globalSaveEnabled: boolean;
  mixingEnabled: boolean;
  episodesEnabled: boolean;
  storyBibleEnabled: boolean;
  journalEnabled: boolean;
}

// Fail-closed defaults: controls stay hidden until the server snapshot loads.
export const DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS: CharacterUniverseRuntimeSettings = {
  libraryEnabled: false,
  globalSaveEnabled: false,
  mixingEnabled: false,
  episodesEnabled: false,
  storyBibleEnabled: false,
  journalEnabled: false,
};

export const RUNTIME_SETTING_BY_FLAG_KEY: Record<
  CharacterUniverseFlagKey,
  keyof CharacterUniverseRuntimeSettings
> = {
  character_library_enabled: 'libraryEnabled',
  character_global_save_enabled: 'globalSaveEnabled',
  character_mixing_enabled: 'mixingEnabled',
  episodes_enabled: 'episodesEnabled',
  story_bible_enabled: 'storyBibleEnabled',
  episode_journal_enabled: 'journalEnabled',
};
