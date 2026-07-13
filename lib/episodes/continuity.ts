// Pack 2: pure episodic-continuity helpers — inheriting the origin story's
// StoryConfig into a new episode, stamping "Episode N" into the cover image
// prompt, and skipping portrait regeneration for carried characters.

import { normalizeStoryConfig } from '@/lib/ai/story-config';
import type { Character, StoryboardPlan, StoryConfig } from '@/lib/types/story';

/**
 * Deep-inherits the parent story's full StoryConfig (visual settings,
 * audience, language, image pipeline, narration, overlays, transitions) so the
 * episode continues the same universe. Only the authoring block is reset — an
 * episode always starts from a fresh premise prompt, never from the parent's
 * seed plan or source text.
 */
export function buildEpisodeConfig(parentConfig: StoryConfig | null | undefined): StoryConfig {
  const normalized = normalizeStoryConfig(parentConfig ?? undefined);
  return {
    ...normalized,
    storyKind: 'story',
    authoring: { mode: 'prompt' },
  };
}

const EPISODE_TITLE_MARKER = 'EPISODE TITLE REQUIREMENT:';

/**
 * Appends the "Episode N" title instruction to a beat-1 image prompt. Framed
 * as an explicit exception because storyboard templates otherwise forbid text
 * inside generated images. Idempotent: re-applying replaces nothing and adds
 * nothing when the marker is already present.
 */
export function appendEpisodeTitleImageInstruction(prompt: string, episodeNumber: number): string {
  if (!prompt || prompt.includes(EPISODE_TITLE_MARKER)) return prompt;
  const caption = `Episode ${episodeNumber}`;
  return (
    `${prompt}\n\n${EPISODE_TITLE_MARKER} As an explicit EXCEPTION to any rule forbidding text in the image, ` +
    `integrate the exact caption text "${caption}" once as a single small, elegant, readable title element ` +
    `inside the artwork (place it in the top-left panel for storyboards), matching the story's art style. ` +
    `Render no other text anywhere in the image.`
  );
}

function hasReusableVisualReference(character: Character | undefined): boolean {
  return Boolean(character && (character.portraitUrl || character.referenceSheetUrl || character.portraitBase64));
}

/**
 * Drops `new_character` portrait tasks for characters that already carry a
 * visual reference (carried episode cast, mixed-in library characters) so
 * their identity is reused instead of regenerated. `visual_change` tasks are
 * kept — a deliberate transformation still needs a fresh reference. Matches by
 * id first, then by normalized name (the LLM may mint new ids on beat 1).
 */
export function filterCarriedPortraitTasks(
  plan: StoryboardPlan,
  beatCharacters: Character[] | undefined
): StoryboardPlan {
  if (!plan.portraitTasks?.length || !beatCharacters?.length) return plan;

  const byId = new Map(beatCharacters.map((character) => [character.id, character]));
  const byName = new Map(
    beatCharacters
      .filter((character) => character.name?.trim())
      .map((character) => [character.name.trim().toLowerCase(), character])
  );

  const portraitTasks = plan.portraitTasks.filter((task) => {
    if (task.reason !== 'new_character') return true;
    const character =
      byId.get(task.characterId) ?? byName.get(task.characterName?.trim().toLowerCase() ?? '');
    return !hasReusableVisualReference(character);
  });

  if (portraitTasks.length === plan.portraitTasks.length) return plan;
  return { ...plan, portraitTasks };
}
