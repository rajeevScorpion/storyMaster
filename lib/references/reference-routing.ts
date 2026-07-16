// Pure per-beat world relevance selection for Reference Personalization. No I/O.
//
// Characters route themselves (they are ordinary roster characters, attached to a
// beat only when present via the existing collectBeatPortraitReferences path).
// Worlds have no location model in the story schema, so we apply the minimal
// viable relevance rule:
//   - 0 worlds  -> none
//   - 1 world   -> always the current world
//   - N worlds  -> keyword match of label + structured keywords against the beat
//                  text; on no match, stay in the last selected world ("sticky");
//                  initial default is the first world.
// Deterministic and unit tested. Anything smarter belongs to a future phase.

import type { StoryConfigWorldReference } from '@/lib/types/references';

function normalize(text: string): string {
  return text.toLowerCase();
}

function worldMatchesBeat(world: StoryConfigWorldReference, beatText: string): boolean {
  const haystack = normalize(beatText);
  const terms = [world.label, ...world.keywords]
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3);
  return terms.some((term) => haystack.includes(term));
}

export function selectRelevantWorld(
  worlds: StoryConfigWorldReference[],
  beatText: string,
  lastSelectedWorldId: string | null
): StoryConfigWorldReference | null {
  if (worlds.length === 0) return null;
  if (worlds.length === 1) return worlds[0];

  const matched = worlds.find((world) => worldMatchesBeat(world, beatText));
  if (matched) return matched;

  if (lastSelectedWorldId) {
    const sticky = worlds.find((world) => world.worldId === lastSelectedWorldId);
    if (sticky) return sticky;
  }
  return worlds[0];
}

/** All world anchors for the Story Bible (compact; the LLM sees every world). */
export function buildWorldAnchorSummaries(
  worlds: StoryConfigWorldReference[] | undefined | null
): { label: string; anchor: string }[] {
  if (!worlds || worlds.length === 0) return [];
  return worlds
    .filter((world) => world.anchor.trim().length > 0)
    .map((world) => ({ label: world.label, anchor: world.anchor }));
}
