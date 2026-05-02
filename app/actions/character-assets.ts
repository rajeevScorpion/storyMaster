'use server';

import { createClient } from '@/lib/supabase/server';
import { normalizeStorageUrl } from '@/lib/supabase/storage';
import type { Character, StoryMap } from '@/lib/types/story';

type ReferenceSheetPayload = {
  url: string;
  storageKey: string;
  uploadedAt: string;
};

function applyReferenceSheet(
  character: Character,
  payload: ReferenceSheetPayload | null
): Character {
  if (!payload) {
    const next = { ...character };
    delete next.referenceSheetUrl;
    delete next.referenceSheetStorageKey;
    delete next.referenceSheetUploadedAt;
    return next;
  }
  return {
    ...character,
    referenceSheetUrl: normalizeStorageUrl(payload.url, 'story-assets'),
    referenceSheetStorageKey: payload.storageKey,
    referenceSheetUploadedAt: payload.uploadedAt,
  };
}

function patchCharacterArray(
  characters: Character[] | null | undefined,
  characterId: string,
  payload: ReferenceSheetPayload | null
): { next: Character[]; matched: boolean } {
  let matched = false;
  const next = (characters ?? []).map((character) => {
    if (character.id !== characterId) return character;
    matched = true;
    return applyReferenceSheet(character, payload);
  });
  return { next, matched };
}

async function updateCharacterReferenceSheetInternal(
  storyId: string,
  characterId: string,
  payload: ReferenceSheetPayload | null
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
    payload
  );

  const rawMap = story.story_map;
  if (!rawMap || typeof rawMap !== 'object' || !('nodes' in rawMap)) {
    throw new Error('Story map is missing or corrupted');
  }
  const storyMap = rawMap as unknown as StoryMap;

  let mapMatched = false;
  const patchedNodes: StoryMap['nodes'] = {};
  for (const [id, node] of Object.entries(storyMap.nodes)) {
    const beatResult = patchCharacterArray(node.data.characters, characterId, payload);
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
    const beatResult = patchCharacterArray(row.characters as Character[] | null, characterId, payload);
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
  payload: ReferenceSheetPayload
): Promise<void> {
  await updateCharacterReferenceSheetInternal(storyId, characterId, payload);
}

export async function clearCharacterReferenceSheetRecord(
  storyId: string,
  characterId: string
): Promise<void> {
  await updateCharacterReferenceSheetInternal(storyId, characterId, null);
}
