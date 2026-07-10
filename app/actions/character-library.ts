'use server';

// Pack 2 character-library server actions: runtime feature snapshot, listing
// the user's reusable character masters, saving a story character globally,
// editing master metadata, and archive/unarchive. All actions verify ownership
// and enforce feature flags server-side (UI gating alone is not trusted).

import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { signMixedUrls } from '@/lib/media/storage-url-signing';
import { extractStoragePath, normalizeStorageUrl } from '@/lib/supabase/storage';
import {
  CHARACTER_UNIVERSE_FLAG_KEYS,
  DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS,
  type CharacterUniverseRuntimeSettings,
} from '@/lib/character-universe/settings';
import type { CharacterMaster, CharacterMasterPatch } from '@/lib/types/character-library';
import type { DbCharacterMaster } from '@/lib/types/database';
import type { Character, StoryMap } from '@/lib/types/story';

const STORY_ASSETS_BUCKET = 'story-assets';
const SIGNED_URL_TTL_SECONDS = 3600;
const MAX_MASTER_TEXT_CHARS = 2000;
const MAX_MASTER_NAME_CHARS = 80;

// ── Runtime snapshot ───────────────────────────────────────────────

export async function getCharacterUniverseRuntimeSettings(): Promise<CharacterUniverseRuntimeSettings> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Anonymous readers never see character-universe controls.
    return DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS;
  }

  const [
    libraryEnabled,
    globalSaveEnabled,
    mixingEnabled,
    episodesEnabled,
    storyBibleEnabled,
    journalEnabled,
  ] = await Promise.all(CHARACTER_UNIVERSE_FLAG_KEYS.map((key) => getFeatureFlag(key, false)));

  return {
    libraryEnabled,
    globalSaveEnabled,
    mixingEnabled,
    episodesEnabled,
    storyBibleEnabled,
    journalEnabled,
  };
}

// ── Shared internals ───────────────────────────────────────────────

class CharacterLibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CharacterLibraryError';
  }
}

async function requireFeature(flagKey: string, label: string): Promise<void> {
  if (!(await getFeatureFlag(flagKey, false))) {
    throw new CharacterLibraryError(`${label} is currently disabled.`);
  }
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new CharacterLibraryError('Not authenticated.');
  return { supabase, userId: user.id };
}

function rowToMaster(row: DbCharacterMaster): CharacterMaster {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    appearanceSummary: row.appearance_summary,
    personalitySummary: row.personality_summary,
    roleNotes: row.role_notes,
    portraitUrl: row.portrait_url,
    portraitStorageKey: row.portrait_storage_key,
    referenceSheetUrl: row.reference_sheet_url,
    referenceSheetStorageKey: row.reference_sheet_storage_key,
    sourceType: row.source_type,
    originStoryId: row.origin_story_id,
    originCharacterId: row.origin_character_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

async function signMasterAssetUrls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  masters: CharacterMaster[]
): Promise<CharacterMaster[]> {
  const urls: string[] = [];
  for (const master of masters) {
    if (master.portraitUrl) urls.push(master.portraitUrl);
    if (master.referenceSheetUrl) urls.push(master.referenceSheetUrl);
  }
  if (urls.length === 0) return masters;

  const signed = await signMixedUrls(supabase, urls, STORY_ASSETS_BUCKET, SIGNED_URL_TTL_SECONDS);
  if (signed.size === 0) return masters;

  return masters.map((master) => ({
    ...master,
    portraitUrl: master.portraitUrl ? signed.get(master.portraitUrl) ?? master.portraitUrl : null,
    referenceSheetUrl: master.referenceSheetUrl
      ? signed.get(master.referenceSheetUrl) ?? master.referenceSheetUrl
      : null,
  }));
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  return 'img';
}

/**
 * Copies a story-owned character asset to a stable library storage key so the
 * master survives story deletion and gallery pruning. Best effort: on failure
 * the caller falls back to referencing the original URL.
 */
async function copyAssetToLibraryKey(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  masterId: string,
  sourceUrl: string,
  kind: 'portrait' | 'sheet'
): Promise<{ url: string; storageKey: string } | null> {
  try {
    const admin = createAdminClient();

    let bytes: ArrayBuffer | null = null;
    let mimeType = 'image/webp';

    const storagePath = extractStoragePath(sourceUrl, STORY_ASSETS_BUCKET);
    if (storagePath) {
      const { data, error } = await admin.storage.from(STORY_ASSETS_BUCKET).download(storagePath);
      if (!error && data) {
        bytes = await data.arrayBuffer();
        mimeType = data.type || mimeType;
      }
    }

    if (!bytes) {
      // r2:// refs and expired storage URLs need signing before fetch.
      const signed = await signMixedUrls(supabase, [sourceUrl], STORY_ASSETS_BUCKET, 300);
      const fetchUrl = signed.get(sourceUrl) ?? (sourceUrl.startsWith('http') ? sourceUrl : null);
      if (!fetchUrl) return null;
      const response = await fetch(fetchUrl);
      if (!response.ok) return null;
      bytes = await response.arrayBuffer();
      mimeType = response.headers.get('content-type') || mimeType;
    }

    const storageKey = `${userId}/library/characters/${masterId}_${kind}.${extensionForMimeType(mimeType)}`;
    const { error: uploadError } = await admin.storage
      .from(STORY_ASSETS_BUCKET)
      .upload(storageKey, Buffer.from(bytes), { contentType: mimeType, upsert: true });
    if (uploadError) return null;

    const { data } = admin.storage.from(STORY_ASSETS_BUCKET).getPublicUrl(storageKey);
    return { url: normalizeStorageUrl(data.publicUrl, STORY_ASSETS_BUCKET), storageKey };
  } catch (error) {
    console.error(`Failed to copy ${kind} asset to library:`, error);
    return null;
  }
}

/**
 * Stamps masterId onto the story instance of a character across all three
 * JSONB stores (stories.characters, story_map nodes, beats rows), following
 * the reference-sheet patch precedent in character-assets.ts.
 */
async function stampMasterIdOnStoryCharacter(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  storyId: string,
  characterId: string,
  masterId: string
): Promise<void> {
  const { data: story, error } = await supabase
    .from('stories')
    .select('characters, story_map')
    .eq('id', storyId)
    .eq('user_id', userId)
    .single();
  if (error || !story) return;

  const stamp = (characters: Character[] | null | undefined): Character[] =>
    (characters ?? []).map((character) =>
      character.id === characterId ? { ...character, masterId } : character
    );

  const storyMap = story.story_map as StoryMap | null;
  const patchedNodes: StoryMap['nodes'] = {};
  if (storyMap?.nodes) {
    for (const [id, node] of Object.entries(storyMap.nodes)) {
      patchedNodes[id] = {
        ...node,
        data: { ...node.data, characters: stamp(node.data.characters) },
      };
    }
  }

  await supabase
    .from('stories')
    .update({
      characters: stamp(story.characters as Character[] | null) as unknown as Record<string, unknown>[],
      ...(storyMap ? { story_map: { ...storyMap, nodes: patchedNodes } as unknown as Record<string, unknown> } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', storyId)
    .eq('user_id', userId);

  const { data: beatRows } = await supabase
    .from('beats')
    .select('id, characters')
    .eq('story_id', storyId)
    .eq('generated_by', userId);

  for (const row of beatRows ?? []) {
    const characters = row.characters as Character[] | null;
    if (!characters?.some((character) => character.id === characterId)) continue;
    await supabase
      .from('beats')
      .update({ characters: stamp(characters) as unknown as Record<string, unknown>[] })
      .eq('id', row.id);
  }
}

// ── Library reads ──────────────────────────────────────────────────

export async function listCharacterMasters(options?: {
  includeArchived?: boolean;
}): Promise<CharacterMaster[]> {
  await requireFeature('character_library_enabled', 'The character library');
  const { supabase } = await requireUser();

  let query = supabase
    .from('character_masters')
    .select('*')
    .order('updated_at', { ascending: false });
  if (!options?.includeArchived) {
    query = query.is('archived_at', null);
  }

  const { data, error } = await query;
  if (error) throw new CharacterLibraryError(`Failed to load character library: ${error.message}`);

  return signMasterAssetUrls(supabase, (data as DbCharacterMaster[]).map(rowToMaster));
}

// ── Save to library ────────────────────────────────────────────────

export type SaveCharacterToLibraryResult =
  | { status: 'saved'; master: CharacterMaster }
  | { status: 'conflict'; existingMaster: CharacterMaster }
  | { status: 'failed'; error: string };

export async function saveCharacterToLibrary(input: {
  storyId: string;
  characterId: string;
  /** Overwrite an existing live master with the same name. */
  overwriteMasterId?: string;
}): Promise<SaveCharacterToLibraryResult> {
  try {
    await requireFeature('character_library_enabled', 'The character library');
    await requireFeature('character_global_save_enabled', 'Saving characters to your library');
    const { supabase, userId } = await requireUser();

    const { data: story, error } = await supabase
      .from('stories')
      .select('id, characters, story_map')
      .eq('id', input.storyId)
      .eq('user_id', userId)
      .single();
    if (error || !story) return { status: 'failed', error: 'Story not found.' };

    // Roster first, story_map nodes as fallback (latest beat wins).
    let character = ((story.characters ?? []) as Character[]).find(
      (entry) => entry.id === input.characterId
    );
    if (!character) {
      const storyMap = story.story_map as StoryMap | null;
      for (const node of Object.values(storyMap?.nodes ?? {})) {
        const match = node.data.characters?.find((entry) => entry.id === input.characterId);
        if (match) character = match;
      }
    }
    if (!character?.name?.trim()) {
      return { status: 'failed', error: 'Character not found on this story.' };
    }

    const masterId = input.overwriteMasterId ?? uuidv4();

    // Copy assets to stable library keys so the master survives story deletion.
    const [portraitCopy, sheetCopy] = await Promise.all([
      character.portraitUrl
        ? copyAssetToLibraryKey(supabase, userId, masterId, character.portraitUrl, 'portrait')
        : Promise.resolve(null),
      character.referenceSheetUrl
        ? copyAssetToLibraryKey(supabase, userId, masterId, character.referenceSheetUrl, 'sheet')
        : Promise.resolve(null),
    ]);

    const masterFields = {
      name: character.name.trim().slice(0, MAX_MASTER_NAME_CHARS),
      type: character.type ?? '',
      appearance_summary: (character.appearanceSummary ?? '').slice(0, MAX_MASTER_TEXT_CHARS),
      personality_summary: (character.personalitySummary ?? '').slice(0, MAX_MASTER_TEXT_CHARS),
      portrait_url: portraitCopy?.url ?? character.portraitUrl ?? null,
      portrait_storage_key: portraitCopy?.storageKey ?? null,
      reference_sheet_url: sheetCopy?.url ?? character.referenceSheetUrl ?? null,
      reference_sheet_storage_key: sheetCopy?.storageKey ?? null,
      source_type: 'generated_from_story' as const,
      origin_story_id: input.storyId,
      origin_character_id: character.id,
      updated_at: new Date().toISOString(),
    };

    let saved: DbCharacterMaster | null = null;
    if (input.overwriteMasterId) {
      const { data, error: updateError } = await supabase
        .from('character_masters')
        .update(masterFields)
        .eq('id', input.overwriteMasterId)
        .eq('user_id', userId)
        .select('*')
        .single();
      if (updateError || !data) {
        return { status: 'failed', error: 'Could not update the existing library character.' };
      }
      saved = data as DbCharacterMaster;
    } else {
      const { data, error: insertError } = await supabase
        .from('character_masters')
        .insert({ id: masterId, user_id: userId, ...masterFields })
        .select('*')
        .single();
      if (insertError) {
        // Unique violation on (user_id, normalized_name): surface the existing
        // master so the UI can offer update-or-rename.
        if (insertError.code === '23505') {
          const { data: existing } = await supabase
            .from('character_masters')
            .select('*')
            .eq('user_id', userId)
            .eq('normalized_name', character.name.trim().toLowerCase())
            .is('archived_at', null)
            .maybeSingle();
          if (existing) {
            const [signedExisting] = await signMasterAssetUrls(supabase, [
              rowToMaster(existing as DbCharacterMaster),
            ]);
            return { status: 'conflict', existingMaster: signedExisting };
          }
        }
        return { status: 'failed', error: 'Could not save the character to your library.' };
      }
      saved = data as DbCharacterMaster;
    }

    // Best effort: link the story instance to its new master everywhere.
    await stampMasterIdOnStoryCharacter(supabase, userId, input.storyId, character.id, saved.id).catch(
      (linkError) => console.error('Failed to stamp masterId on story character:', linkError)
    );

    const [signedMaster] = await signMasterAssetUrls(supabase, [rowToMaster(saved)]);
    return { status: 'saved', master: signedMaster };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Could not save the character.',
    };
  }
}

// ── Master edits ───────────────────────────────────────────────────

export async function updateCharacterMaster(
  masterId: string,
  patch: CharacterMasterPatch
): Promise<CharacterMaster> {
  await requireFeature('character_library_enabled', 'The character library');
  const { supabase, userId } = await requireUser();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) throw new CharacterLibraryError('Character name cannot be empty.');
    updates.name = trimmed.slice(0, MAX_MASTER_NAME_CHARS);
  }
  if (patch.type !== undefined) updates.type = patch.type.slice(0, 200);
  if (patch.appearanceSummary !== undefined) {
    updates.appearance_summary = patch.appearanceSummary.slice(0, MAX_MASTER_TEXT_CHARS);
  }
  if (patch.personalitySummary !== undefined) {
    updates.personality_summary = patch.personalitySummary.slice(0, MAX_MASTER_TEXT_CHARS);
  }
  if (patch.roleNotes !== undefined) {
    updates.role_notes = patch.roleNotes ? patch.roleNotes.slice(0, MAX_MASTER_TEXT_CHARS) : null;
  }

  const { data, error } = await supabase
    .from('character_masters')
    .update(updates)
    .eq('id', masterId)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error || !data) {
    if (error?.code === '23505') {
      throw new CharacterLibraryError('You already have a library character with that name.');
    }
    throw new CharacterLibraryError('Could not update the character.');
  }

  const [signed] = await signMasterAssetUrls(supabase, [rowToMaster(data as DbCharacterMaster)]);
  return signed;
}

export async function archiveCharacterMaster(masterId: string): Promise<void> {
  await requireFeature('character_library_enabled', 'The character library');
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from('character_masters')
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', masterId)
    .eq('user_id', userId);
  if (error) throw new CharacterLibraryError('Could not archive the character.');
}

export async function unarchiveCharacterMaster(masterId: string): Promise<void> {
  await requireFeature('character_library_enabled', 'The character library');
  const { supabase, userId } = await requireUser();
  const { error } = await supabase
    .from('character_masters')
    .update({ archived_at: null, updated_at: new Date().toISOString() })
    .eq('id', masterId)
    .eq('user_id', userId);
  if (error) {
    if (error.code === '23505') {
      throw new CharacterLibraryError(
        'You already have an active library character with that name. Rename it first.'
      );
    }
    throw new CharacterLibraryError('Could not restore the character.');
  }
}
