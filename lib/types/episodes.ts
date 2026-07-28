// Pack 2: episodic branching — a branch is the spine connecting a chain of
// episode stories; the bible and journal hang off the branch.

import type { Character, SourceFidelity, StoryConfig } from './story';

export interface EpisodeBranch {
  id: string;
  userId: string;
  rootStoryId: string | null;
  branchName: string;
  status: 'active' | 'archived';
  latestStoryId: string | null;
  latestEpisodeNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface SeriesBible {
  id: string;
  branchId: string;
  title: string;
  bibleText: string;
  /** Origin story's full StoryConfig so episodes inherit the Advanced settings. */
  configSnapshot: StoryConfig | null;
  generatedModelId: string | null;
  lastGeneratedAt: string | null;
  lastEditedAt: string | null;
}

export type EpisodeJournalEventType =
  | 'episode_created'
  | 'characters_migrated'
  | 'episode_summary'
  | 'bible_generated'
  | 'bible_edited';

export interface EpisodeJournalEvent {
  id: string;
  branchId: string;
  storyId: string | null;
  eventType: EpisodeJournalEventType;
  summary: string;
  payload: Record<string, unknown>;
  sequenceNo: number;
  createdAt: string;
}

/**
 * Everything the Continue-as-Episode dialog needs, prepared server-side in one
 * call: carried characters have signed asset URLs and are ready to seed the
 * next episode's roster.
 */
export interface EpisodeContinuationSeed {
  branchId: string;
  nextEpisodeNumber: number;
  parentStoryId: string;
  parentStoryTitle: string;
  carriedCharacters: Character[];
  bible: SeriesBible | null;
  journalSummary: string;
  inheritedConfig: StoryConfig;
  authoringDefaults: {
    mode: 'prompt' | 'seeded';
    sourceFidelity: SourceFidelity;
  };
}

export interface EpisodeLink {
  storyId: string;
  title: string;
  episodeNumber: number | null;
}

export interface EpisodeNavigation {
  parent: EpisodeLink | null;
  children: EpisodeLink[];
}
