// Turn v2 "direct input" reference sources into (a) ordinary roster Characters
// for StorySeedOptions.seedCharacters and (b) StoryConfig.references entries that
// carry the RAW upload key for generation-time image input.
//
// PRIVACY CONTRACT: the raw source r2:// key must NEVER appear on a seeded
// Character (Character.referenceSheetUrl / referenceSheetStorageKey / portraitUrl
// are re-signed for authenticated explorers via the storage-url-signing paths;
// raw uploads may be personal photos). The raw key lives ONLY in
// StoryConfig.references.{characters,worlds}, which is not signed/exposed on load.
//
// Names are resolved once here so the seeded Character and its config reference
// share the same id + name (the binding line and cast registry must agree).
//
// Pure and testable.

import type { Character } from '@/lib/types/story';
import type {
  ReferenceKind,
  StoryConfigCharacterReference,
  StoryConfigWorldReference,
} from '@/lib/types/references';
import { resolveSeedCharacterName } from '@/lib/references/seed';

export interface DirectSeedInput {
  sourceId: string;
  kind: ReferenceKind;
  displayName: string | null;
  /** User description (optionally enriched by lazy analysis for prompt_only). */
  description: string | null;
  /** Durable r2://bucket/key of the RAW upload. */
  storageKey: string;
}

export interface DirectSeedResult {
  seedCharacters: Character[];
  references: {
    characters: StoryConfigCharacterReference[];
    worlds: StoryConfigWorldReference[];
  };
}

/** Relevance keywords for a world: words >= 3 chars from its label + description. */
export function deriveWorldKeywords(label: string, description: string): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const token of `${label} ${description}`.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length >= 3 && !seen.has(token)) {
      seen.add(token);
      keywords.push(token);
    }
  }
  return keywords;
}

export function buildDirectSeed(inputs: DirectSeedInput[]): DirectSeedResult {
  const seedCharacters: Character[] = [];
  const characterRefs: StoryConfigCharacterReference[] = [];
  const worldRefs: StoryConfigWorldReference[] = [];
  const takenNames = new Set<string>();
  let worldOrdinal = 0;

  for (const input of inputs) {
    if (input.kind === 'character') {
      const userNamed = Boolean((input.displayName ?? '').trim());
      const name = resolveSeedCharacterName(input.displayName, takenNames);
      const characterId = `ref_${input.sourceId}`;
      const appearance = (input.description ?? '').trim();

      const character: Character = {
        id: characterId,
        name,
        type: 'main',
        appearanceSummary: appearance,
        personalitySummary: '',
        // NO reference image fields — the raw key travels in the config below.
        ...(userNamed ? {} : { nameIsPlaceholder: true }),
      };
      seedCharacters.push(character);

      characterRefs.push({
        sourceId: input.sourceId,
        characterId,
        name,
        ...(appearance ? { description: appearance } : {}),
        storageKey: input.storageKey,
      });
    } else {
      worldOrdinal += 1;
      const label = (input.displayName ?? '').trim() || `World ${worldOrdinal}`;
      const anchor = (input.description ?? '').trim();
      worldRefs.push({
        sourceId: input.sourceId,
        worldId: input.sourceId,
        label,
        anchor,
        keywords: deriveWorldKeywords(label, anchor),
        adoptionMode: 'description_only',
        sourceStorageKey: input.storageKey,
      });
    }
  }

  return {
    seedCharacters,
    references: { characters: characterRefs, worlds: worldRefs },
  };
}
