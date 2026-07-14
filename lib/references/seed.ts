// Turn ready character adoptions into ordinary roster Character entries for
// StorySeedOptions.seedCharacters. This is the crux of the design: once seeded,
// the adopted character flows through the entire existing pipeline (per-beat
// reference routing, Story Bible cast registry, episode carry-forward, library)
// with no further special-casing.
//
// Pure and testable. It emits ONLY the canonical (styled) r2:// reference — the
// raw upload key must never appear in a Character (it must not enter story
// payloads). The r2:// reference is durable and re-signable on every load via
// signStoryMapAssetUrls / signCharacterRosterReferenceSheetUrls.

import type { Character } from '@/lib/types/story';

export interface SeedCharacterInput {
  adoptionId: string;
  displayName: string | null;
  /** Compiled stable-identity anchor -> Character.appearanceSummary. */
  anchor: string;
  /**
   * Freshly signed https URL of the canonical adopted image, for immediate
   * (client-side) beat-1 generation. Re-signed on every later load via
   * signStoryMapAssetUrls once persisted.
   */
  canonicalSignedUrl: string;
  /** Durable r2://bucket/key of the canonical adopted image (NEVER the source key). */
  canonicalReference: string;
  completedAt?: string | null;
}

/** Resolve a non-colliding, user-facing character name. Falls back to
 *  "Character N" using the lowest free index so removing/re-adding does not
 *  expose fragile array positions as identity. */
export function resolveSeedCharacterName(
  displayName: string | null | undefined,
  takenNames: Set<string>
): string {
  const provided = (displayName ?? '').trim();
  if (provided) {
    const unique = dedupeName(provided, takenNames);
    takenNames.add(unique.toLowerCase());
    return unique;
  }
  let index = 1;
  while (takenNames.has(`character ${index}`)) index += 1;
  const name = `Character ${index}`;
  takenNames.add(name.toLowerCase());
  return name;
}

function dedupeName(name: string, takenNames: Set<string>): string {
  if (!takenNames.has(name.toLowerCase())) return name;
  let suffix = 2;
  while (takenNames.has(`${name} ${suffix}`.toLowerCase())) suffix += 1;
  return `${name} ${suffix}`;
}

export function buildSeedCharacters(inputs: SeedCharacterInput[]): Character[] {
  const takenNames = new Set<string>();
  return inputs.map((input) => {
    const name = resolveSeedCharacterName(input.displayName, takenNames);
    const character: Character = {
      id: `ref_${input.adoptionId}`,
      name,
      type: 'main',
      appearanceSummary: input.anchor,
      personalitySummary: '',
      referenceSheetUrl: input.canonicalSignedUrl,
      referenceSheetStorageKey: input.canonicalReference,
      ...(input.completedAt ? { referenceSheetUploadedAt: input.completedAt } : {}),
    };
    return character;
  });
}
