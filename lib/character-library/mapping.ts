// Pack 2: pure helpers for turning library masters into local story character
// instances (mixing / episode carry) and detecting name conflicts. Local
// instances get a fresh id; the master is never mutated by story usage.

import { v4 as uuidv4 } from 'uuid';
import type { CharacterMaster } from '@/lib/types/character-library';
import type { Character } from '@/lib/types/story';

export function normalizeCharacterName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Creates a fresh local story instance from a library master. The instance
 * links back via masterId/sourceStoryId but is otherwise an independent copy —
 * local overrides never flow back to the master.
 */
export function masterToCharacter(master: CharacterMaster, now: Date = new Date()): Character {
  const character: Character = {
    id: uuidv4(),
    name: master.name,
    type: master.type,
    appearanceSummary: master.appearanceSummary,
    personalitySummary: master.personalitySummary,
    masterId: master.id,
    importedAt: now.toISOString(),
  };
  if (master.originStoryId) character.sourceStoryId = master.originStoryId;
  if (master.portraitUrl) character.portraitUrl = master.portraitUrl;
  if (master.referenceSheetUrl) {
    character.referenceSheetUrl = master.referenceSheetUrl;
    if (master.referenceSheetStorageKey) {
      character.referenceSheetStorageKey = master.referenceSheetStorageKey;
    }
  }
  return character;
}

export interface CharacterNameConflict {
  normalizedName: string;
  names: string[];
}

/**
 * Finds selections that normalize to the same name (e.g. "Tara" from Story A
 * and "tara " from Story B). The UI asks the user to rename or deselect one
 * before starting the story.
 */
export function findCharacterNameConflicts(
  selected: Array<Pick<Character, 'name'>>
): CharacterNameConflict[] {
  const byName = new Map<string, string[]>();
  for (const character of selected) {
    const normalized = normalizeCharacterName(character.name ?? '');
    if (!normalized) continue;
    byName.set(normalized, [...(byName.get(normalized) ?? []), character.name]);
  }
  return [...byName.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([normalizedName, names]) => ({ normalizedName, names }));
}
