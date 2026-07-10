// Pack 2: user-owned reusable characters ("My Library"). Masters are copies of
// story characters at save time; editing a master never rewrites story JSONB.

export type CharacterMasterSourceType = 'generated_from_story' | 'manual';

export interface CharacterMaster {
  id: string;
  userId: string;
  name: string;
  type: string;
  appearanceSummary: string;
  personalitySummary: string;
  roleNotes: string | null;
  /** Signed display URL when returned from server actions. */
  portraitUrl: string | null;
  portraitStorageKey: string | null;
  referenceSheetUrl: string | null;
  referenceSheetStorageKey: string | null;
  sourceType: CharacterMasterSourceType;
  originStoryId: string | null;
  originCharacterId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CharacterMasterPatch {
  name?: string;
  type?: string;
  appearanceSummary?: string;
  personalitySummary?: string;
  roleNotes?: string | null;
}
