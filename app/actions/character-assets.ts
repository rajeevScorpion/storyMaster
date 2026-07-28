'use server';

import { createClient } from '@/lib/supabase/server';
import { normalizeStorageUrl } from '@/lib/supabase/storage';
import { signMixedUrls } from '@/lib/media/storage-url-signing';
import type { Character, CharacterSheetGalleryEntry, StoryMap } from '@/lib/types/story';

type UploadPatch = {
  kind: 'upload';
  url: string;
  storageKey: string;
  uploadedAt: string;
  gallery: CharacterSheetGalleryEntry[];
  cap: number;
};

type SelectPatch = {
  kind: 'select';
  storageKey: string;
};

type ClearActivePatch = {
  kind: 'clear-active';
};

type RemoveEntryPatch = {
  kind: 'remove-entry';
  storageKey: string;
};

type CharacterSheetPatch = UploadPatch | SelectPatch | ClearActivePatch | RemoveEntryPatch;

type PatchOutcome = {
  activeFields: {
    referenceSheetUrl?: string;
    referenceSheetStorageKey?: string;
    referenceSheetUploadedAt?: string;
  };
  gallery?: CharacterSheetGalleryEntry[];
};

function normalizeGalleryEntry(entry: CharacterSheetGalleryEntry): CharacterSheetGalleryEntry {
  return {
    url: normalizeStorageUrl(entry.url, 'story-assets'),
    storageKey: entry.storageKey,
    uploadedAt: entry.uploadedAt,
    ...(entry.optimizationMetadata ? { optimizationMetadata: entry.optimizationMetadata } : {}),
  };
}

function pickFallbackEntry(entries: CharacterSheetGalleryEntry[]): CharacterSheetGalleryEntry | undefined {
  if (entries.length === 0) return undefined;
  return [...entries].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
}

function computeOutcome(character: Character, patch: CharacterSheetPatch): PatchOutcome {
  const existingGallery = character.referenceSheetGallery ?? [];

  switch (patch.kind) {
    case 'upload': {
      if (patch.gallery.length > Math.max(1, patch.cap)) {
        throw new Error(`You can only keep ${patch.cap} reference sheets per character.`);
      }
      const normalizedGallery = patch.gallery.map(normalizeGalleryEntry);
      return {
        activeFields: {
          referenceSheetUrl: normalizeStorageUrl(patch.url, 'story-assets'),
          referenceSheetStorageKey: patch.storageKey,
          referenceSheetUploadedAt: patch.uploadedAt,
        },
        gallery: normalizedGallery,
      };
    }

    case 'select': {
      const target = existingGallery.find((entry) => entry.storageKey === patch.storageKey);
      if (!target) {
        throw new Error('Selected reference sheet was not found in this character\'s gallery.');
      }
      return {
        activeFields: {
          referenceSheetUrl: normalizeStorageUrl(target.url, 'story-assets'),
          referenceSheetStorageKey: target.storageKey,
          referenceSheetUploadedAt: target.uploadedAt,
        },
      };
    }

    case 'clear-active': {
      return {
        activeFields: {
          referenceSheetUrl: undefined,
          referenceSheetStorageKey: undefined,
          referenceSheetUploadedAt: undefined,
        },
      };
    }

    case 'remove-entry': {
      const remaining = existingGallery.filter((entry) => entry.storageKey !== patch.storageKey);
      const wasActive = character.referenceSheetStorageKey === patch.storageKey;
      const fallback = wasActive ? pickFallbackEntry(remaining) : undefined;
      return {
        activeFields: wasActive
          ? fallback
            ? {
                referenceSheetUrl: normalizeStorageUrl(fallback.url, 'story-assets'),
                referenceSheetStorageKey: fallback.storageKey,
                referenceSheetUploadedAt: fallback.uploadedAt,
              }
            : {
                referenceSheetUrl: undefined,
                referenceSheetStorageKey: undefined,
                referenceSheetUploadedAt: undefined,
              }
          : {},
        gallery: remaining.map(normalizeGalleryEntry),
      };
    }
  }
}

function applyOutcomeToCharacter(
  character: Character,
  outcome: PatchOutcome,
  options: { includeGallery: boolean }
): Character {
  const next: Character = { ...character };

  // Active fields — explicit undefined values mean "clear".
  if ('referenceSheetUrl' in outcome.activeFields) {
    if (outcome.activeFields.referenceSheetUrl) {
      next.referenceSheetUrl = outcome.activeFields.referenceSheetUrl;
    } else {
      delete next.referenceSheetUrl;
    }
  }
  if ('referenceSheetStorageKey' in outcome.activeFields) {
    if (outcome.activeFields.referenceSheetStorageKey) {
      next.referenceSheetStorageKey = outcome.activeFields.referenceSheetStorageKey;
    } else {
      delete next.referenceSheetStorageKey;
    }
  }
  if ('referenceSheetUploadedAt' in outcome.activeFields) {
    if (outcome.activeFields.referenceSheetUploadedAt) {
      next.referenceSheetUploadedAt = outcome.activeFields.referenceSheetUploadedAt;
    } else {
      delete next.referenceSheetUploadedAt;
    }
  }

  if (options.includeGallery && outcome.gallery !== undefined) {
    next.referenceSheetGallery = outcome.gallery;
  }

  return next;
}

function patchCharacterArray(
  characters: Character[] | null | undefined,
  characterId: string,
  patch: CharacterSheetPatch,
  options: { includeGallery: boolean }
): { next: Character[]; matched: boolean; outcome?: PatchOutcome } {
  let matched = false;
  let outcome: PatchOutcome | undefined;
  const next = (characters ?? []).map((character) => {
    if (character.id !== characterId) return character;
    matched = true;
    if (!outcome) {
      outcome = computeOutcome(character, patch);
    }
    return applyOutcomeToCharacter(character, outcome, options);
  });
  return { next, matched, outcome };
}

async function updateCharacterReferenceSheetInternal(
  storyId: string,
  characterId: string,
  patch: CharacterSheetPatch
): Promise<void> {
  if (!storyId || !characterId) {
    throw new Error('storyId and characterId are required.');
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data: story, error: storyError } = await supabase
    .from('stories')
    .select('characters, story_map')
    .eq('id', storyId)
    .eq('user_id', user.id)
    .single();

  if (storyError || !story) {
    throw new Error(`Failed to load story: ${storyError?.message || 'Story not found'}`);
  }

  const rosterResult = patchCharacterArray(
    (story.characters ?? []) as Character[],
    characterId,
    patch,
    { includeGallery: true }
  );

  const rawMap = story.story_map;
  if (!rawMap || typeof rawMap !== 'object' || !('nodes' in rawMap)) {
    throw new Error('Story map is missing or corrupted');
  }
  const storyMap = rawMap as unknown as StoryMap;

  let mapMatched = false;
  const patchedNodes: StoryMap['nodes'] = {};
  for (const [id, node] of Object.entries(storyMap.nodes)) {
    const beatResult = patchCharacterArray(
      node.data.characters,
      characterId,
      patch,
      { includeGallery: false }
    );
    if (beatResult.matched) mapMatched = true;
    patchedNodes[id] = {
      ...node,
      data: {
        ...node.data,
        characters: beatResult.next,
      },
    };
  }

  if (!rosterResult.matched && !mapMatched) {
    throw new Error('Character not found on this story.');
  }

  const patchedMap: StoryMap = {
    ...storyMap,
    nodes: patchedNodes,
  };

  const { error: updateStoryError } = await supabase
    .from('stories')
    .update({
      characters: rosterResult.next as unknown as Record<string, unknown>[],
      story_map: patchedMap as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq('id', storyId)
    .eq('user_id', user.id);

  if (updateStoryError) {
    throw new Error(`Failed to update story characters: ${updateStoryError.message}`);
  }

  const { data: beatRows, error: beatFetchError } = await supabase
    .from('beats')
    .select('id, characters')
    .eq('story_id', storyId)
    .eq('generated_by', user.id);

  if (beatFetchError) {
    throw new Error(`Failed to load beats for character patch: ${beatFetchError.message}`);
  }

  for (const row of beatRows ?? []) {
    const beatResult = patchCharacterArray(
      row.characters as Character[] | null,
      characterId,
      patch,
      { includeGallery: false }
    );
    if (!beatResult.matched) continue;
    const { error: beatUpdateError } = await supabase
      .from('beats')
      .update({ characters: beatResult.next as unknown as Record<string, unknown>[] })
      .eq('id', row.id);
    if (beatUpdateError) {
      throw new Error(`Failed to update beat characters: ${beatUpdateError.message}`);
    }
  }
}

export async function setCharacterReferenceSheetRecord(
  storyId: string,
  characterId: string,
  payload: {
    url: string;
    storageKey: string;
    uploadedAt: string;
    gallery: CharacterSheetGalleryEntry[];
    cap: number;
  }
): Promise<{
  referenceSheetUrl: string;
  referenceSheetStorageKey: string;
  referenceSheetUploadedAt: string;
  referenceSheetGallery: CharacterSheetGalleryEntry[];
}> {
  await updateCharacterReferenceSheetInternal(storyId, characterId, {
    kind: 'upload',
    ...payload,
  });

  // The database keeps canonical storage references. Return fresh signed
  // display URLs to the client so browser rendering never requires replacing
  // canonical state with a temporary data URL.
  const supabase = await createClient();
  const canonicalUrls = [
    payload.url,
    ...payload.gallery.map((entry) => entry.url),
  ];
  const signed = await signMixedUrls(supabase, canonicalUrls, 'story-assets', 3600);

  return {
    referenceSheetUrl: signed.get(payload.url) ?? payload.url,
    referenceSheetStorageKey: payload.storageKey,
    referenceSheetUploadedAt: payload.uploadedAt,
    referenceSheetGallery: payload.gallery.map((entry) => ({
      ...entry,
      url: signed.get(entry.url) ?? entry.url,
    })),
  };
}

export async function selectCharacterReferenceSheetRecord(
  storyId: string,
  characterId: string,
  storageKey: string
): Promise<void> {
  await updateCharacterReferenceSheetInternal(storyId, characterId, {
    kind: 'select',
    storageKey,
  });
}

export async function clearCharacterReferenceSheetRecord(
  storyId: string,
  characterId: string
): Promise<void> {
  await updateCharacterReferenceSheetInternal(storyId, characterId, {
    kind: 'clear-active',
  });
}

export async function removeCharacterReferenceSheetEntryRecord(
  storyId: string,
  characterId: string,
  storageKey: string
): Promise<void> {
  await updateCharacterReferenceSheetInternal(storyId, characterId, {
    kind: 'remove-entry',
    storageKey,
  });
}
