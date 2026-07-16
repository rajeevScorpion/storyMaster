// Per-beat routing for v2 "direct input" references. Pure and testable.
//
// Direct-mode character references are seeded as ordinary roster characters, but
// because seeded characters are never flagged "new", the storyboard composer
// emits no portrait task for them. We synthesize those tasks for beat 1 so the
// raw upload can be fed into the character-sheet generation (the styled-sheet
// hybrid), then route the raw upload per character. Worlds reuse the existing
// relevance selector and attach their raw image to the beat.

import type { Character, PortraitTask, StoryboardPlan } from '@/lib/types/story';
import type {
  StoryConfigCharacterReference,
  StoryConfigWorldReference,
} from '@/lib/types/references';
import type { ReferenceImage } from '@/app/actions/story-runtime';
import { selectRelevantWorld } from '@/lib/references/reference-routing';

/** Match a config character reference to the character actually present in the
 *  beat cast (id first, then normalized name — the LLM may keep or re-mint ids). */
function matchBeatCharacter(
  ref: StoryConfigCharacterReference,
  beatById: Map<string, Character>,
  beatByName: Map<string, Character>
): Character | undefined {
  return beatById.get(ref.characterId) ?? beatByName.get(ref.name?.trim().toLowerCase() ?? '');
}

function indexBeatCharacters(beatCharacters: Character[]): {
  byId: Map<string, Character>;
  byName: Map<string, Character>;
} {
  const byId = new Map(beatCharacters.map((character) => [character.id, character]));
  const byName = new Map(
    beatCharacters
      .filter((character) => character.name?.trim())
      .map((character) => [character.name.trim().toLowerCase(), character])
  );
  return { byId, byName };
}

/**
 * Append `new_character` portrait tasks for direct-reference characters that are
 * in the beat cast but have no task yet. Keyed by the BEAT character's id (that
 * is how generatePortraitsForStoryboardPlan looks the character up). Deduped
 * against existing tasks by id and by name.
 */
export function synthesizeDirectPortraitTasks(
  existingTasks: PortraitTask[],
  configCharacters: StoryConfigCharacterReference[] | undefined,
  beatCharacters: Character[]
): PortraitTask[] {
  if (!configCharacters?.length) return existingTasks;
  const { byId, byName } = indexBeatCharacters(beatCharacters);
  const taskIds = new Set(existingTasks.map((task) => task.characterId));
  const taskNames = new Set(
    existingTasks.map((task) => task.characterName?.trim().toLowerCase()).filter(Boolean)
  );

  const added: PortraitTask[] = [];
  for (const ref of configCharacters) {
    const beatCharacter = matchBeatCharacter(ref, byId, byName);
    if (!beatCharacter) continue;
    if (taskIds.has(beatCharacter.id)) continue;
    if (beatCharacter.name?.trim() && taskNames.has(beatCharacter.name.trim().toLowerCase())) continue;
    // Avoid duplicate synthesized tasks for the same beat character.
    taskIds.add(beatCharacter.id);
    if (beatCharacter.name?.trim()) taskNames.add(beatCharacter.name.trim().toLowerCase());

    const detail = (ref.description ?? '').trim() || (beatCharacter.appearanceSummary ?? '').trim();
    added.push({
      characterId: beatCharacter.id,
      characterName: beatCharacter.name,
      reason: 'new_character',
      prompt: [`${beatCharacter.name}.`, detail, 'Single-character reference, clean background, no text.']
        .filter((part) => part.length > 0)
        .join(' '),
    });
  }

  return added.length > 0 ? [...existingTasks, ...added] : existingTasks;
}

/**
 * Map each beat character to its raw upload ReferenceImage, keyed by the BEAT
 * character's id so it lines up with the synthesized portrait tasks.
 */
export function collectDirectCharacterRefs(
  configCharacters: StoryConfigCharacterReference[] | undefined,
  beatCharacters: Character[]
): Map<string, ReferenceImage> {
  const map = new Map<string, ReferenceImage>();
  if (!configCharacters?.length) return map;
  const { byId, byName } = indexBeatCharacters(beatCharacters);
  for (const ref of configCharacters) {
    if (!ref.storageKey) continue;
    const beatCharacter = matchBeatCharacter(ref, byId, byName);
    if (!beatCharacter) continue;
    map.set(beatCharacter.id, { type: 'character', storageKey: ref.storageKey, name: beatCharacter.name });
  }
  return map;
}

/**
 * Select the world relevant to this beat and return its raw upload as a scene
 * reference (or null). Prefers the direct-mode source key, falling back to a v1
 * canonical key if present.
 */
export function selectDirectWorldReference(
  worlds: StoryConfigWorldReference[] | undefined,
  beatText: string,
  lastSelectedWorldId: string | null
): ReferenceImage | null {
  if (!worlds?.length) return null;
  const world = selectRelevantWorld(worlds, beatText, lastSelectedWorldId);
  const key = world?.sourceStorageKey ?? world?.canonicalStorageKey;
  if (!world || !key) return null;
  return { type: 'scene', storageKey: key, name: world.label };
}
