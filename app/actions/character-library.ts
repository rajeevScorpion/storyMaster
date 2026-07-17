'use server';

// Pack 2 character-library server actions: runtime feature snapshot, listing
// the user's reusable character masters, saving a story character globally,
// editing master metadata, and archive/unarchive. All actions verify ownership
// and enforce feature flags server-side (UI gating alone is not trusted).

import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveStoryListThumbnails } from '@/app/actions/persistence';
import { getFeatureFlag, getFeatureFlags } from '@/lib/ai/model-config';
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

/**
 * Resolves the character-universe flag snapshot for an already-authenticated
 * user (or defaults for an anonymous session). Auth is resolved by the caller
 * so a bundled bootstrap can share one `getUser()` across sections.
 */
async function buildCharacterUniverseSettings(
  userId: string | null
): Promise<CharacterUniverseRuntimeSettings> {
  if (!userId) {
    // Anonymous readers never see character-universe controls.
    return DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS;
  }

  // Single `.in()` query for all six flags instead of six separate round-trips.
  const flags = await getFeatureFlags(CHARACTER_UNIVERSE_FLAG_KEYS, false);

  return {
    libraryEnabled: flags['character_library_enabled'],
    globalSaveEnabled: flags['character_global_save_enabled'],
    mixingEnabled: flags['character_mixing_enabled'],
    episodesEnabled: flags['episodes_enabled'],
    storyBibleEnabled: flags['story_bible_enabled'],
    journalEnabled: flags['episode_journal_enabled'],
  };
}

export async function getCharacterUniverseRuntimeSettings(): Promise<CharacterUniverseRuntimeSettings> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return buildCharacterUniverseSettings(user?.id ?? null);
}

/**
 * Character-universe snapshot + masters in a single round trip, threaded with
 * an already-resolved auth context. Flags and masters resolve in parallel;
 * masters are discarded when the library flag is off. Used by the session
 * bootstrap and {@link getCharacterUniversePayload}.
 */
export async function loadCharacterUniversePayloadData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string | null
): Promise<{ settings: CharacterUniverseRuntimeSettings; masters: CharacterMaster[] }> {
  if (!userId) {
    return { settings: DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS, masters: [] };
  }
  const [settings, masters] = await Promise.all([
    buildCharacterUniverseSettings(userId),
    loadCharacterMastersData(supabase, userId, { includeArchived: true }).catch(() => [] as CharacterMaster[]),
  ]);
  return { settings, masters: settings.libraryEnabled ? masters : [] };
}

/**
 * Per-request wrapper: resolves auth, then returns the snapshot + masters in
 * one server-action round trip (replaces the settings→masters client waterfall).
 */
export async function getCharacterUniversePayload(): Promise<{
  settings: CharacterUniverseRuntimeSettings;
  masters: CharacterMaster[];
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return loadCharacterUniversePayloadData(supabase, user?.id ?? null);
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

/**
 * Visual refs (portrait, reference sheet, sheet gallery) can live on a beat
 * instance without ever being synced back to the story roster. When the
 * resolved character is missing a portrait or sheet, pull the first available
 * one from the story_map nodes and beat rows so the saved master still gets a
 * thumbnail. Identity fields (name/type/summaries) stay from the base instance.
 */
async function backfillCharacterVisualRefs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  storyId: string,
  characterId: string,
  base: Character,
  storyMap: StoryMap | null
): Promise<Character> {
  const candidates: Character[] = [];

  for (const node of Object.values(storyMap?.nodes ?? {})) {
    const match = node.data.characters?.find((entry) => entry.id === characterId);
    if (match) candidates.push(match);
  }

  const { data: beatRows } = await supabase
    .from('beats')
    .select('characters')
    .eq('story_id', storyId)
    .eq('generated_by', userId);
  for (const row of beatRows ?? []) {
    const match = (row.characters as Character[] | null)?.find((entry) => entry.id === characterId);
    if (match) candidates.push(match);
  }

  let portraitUrl = base.portraitUrl;
  let referenceSheetUrl = base.referenceSheetUrl;
  let referenceSheetGallery = base.referenceSheetGallery;

  for (const candidate of candidates) {
    if (!portraitUrl && candidate.portraitUrl) portraitUrl = candidate.portraitUrl;
    if (!referenceSheetUrl && candidate.referenceSheetUrl) {
      referenceSheetUrl = candidate.referenceSheetUrl;
    }
    if (!referenceSheetGallery?.length && candidate.referenceSheetGallery?.length) {
      referenceSheetGallery = candidate.referenceSheetGallery;
    }
  }

  // A gallery-only character still has a usable thumbnail; promote its first
  // entry so the reference sheet is copied to the master.
  if (!referenceSheetUrl && referenceSheetGallery?.length) {
    referenceSheetUrl = referenceSheetGallery[0].url;
  }

  return { ...base, portraitUrl, referenceSheetUrl, referenceSheetGallery };
}

// ── Library reads ──────────────────────────────────────────────────

/**
 * Master-list loader threaded with an already-resolved auth context (feature
 * gating is the caller's responsibility). `listCharacterMasters` below is the
 * thin per-request wrapper.
 */
async function loadCharacterMastersData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  options?: { includeArchived?: boolean }
): Promise<CharacterMaster[]> {
  let query = supabase
    .from('character_masters')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (!options?.includeArchived) {
    query = query.is('archived_at', null);
  }

  const { data, error } = await query;
  if (error) throw new CharacterLibraryError(`Failed to load character library: ${error.message}`);

  return signMasterAssetUrls(supabase, (data as DbCharacterMaster[]).map(rowToMaster));
}

export async function listCharacterMasters(options?: {
  includeArchived?: boolean;
}): Promise<CharacterMaster[]> {
  await requireFeature('character_library_enabled', 'The character library');
  const { supabase, userId } = await requireUser();
  return loadCharacterMastersData(supabase, userId, options);
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

    // Roster first, story_map nodes as fallback for identity.
    const storyMap = story.story_map as StoryMap | null;
    let character = ((story.characters ?? []) as Character[]).find(
      (entry) => entry.id === input.characterId
    );
    if (!character) {
      for (const node of Object.values(storyMap?.nodes ?? {})) {
        const match = node.data.characters?.find((entry) => entry.id === input.characterId);
        if (match) character = match;
      }
    }
    if (!character?.name?.trim()) {
      return { status: 'failed', error: 'Character not found on this story.' };
    }

    // Visual refs may live only on a beat instance — backfill before copying.
    const hasSheet = Boolean(character.referenceSheetUrl || character.referenceSheetGallery?.length);
    if (!character.portraitUrl || !hasSheet) {
      character = await backfillCharacterVisualRefs(
        supabase,
        userId,
        input.storyId,
        input.characterId,
        character,
        storyMap
      );
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

// ── Thumbnail repair ───────────────────────────────────────────────

const MAX_REPAIR_PER_CALL = 15;

/**
 * Self-heals library masters that were saved before the visual-backfill logic
 * existed (or whose best-effort asset copy failed), leaving both portrait and
 * reference-sheet URLs null. For each such master with a known origin story, we
 * pull the first available portrait/sheet from that story's roster, story_map
 * nodes, and beat rows (reusing {@link backfillCharacterVisualRefs}), copy it
 * to a stable library key, and persist the URLs. Best effort per master — one
 * unrecoverable story never aborts the batch. Returns the repaired masters
 * (signed) so the caller can merge them into an already-rendered list.
 */
export async function repairCharacterMasterVisuals(): Promise<CharacterMaster[]> {
  await requireFeature('character_library_enabled', 'The character library');
  const { supabase, userId } = await requireUser();

  const { data, error } = await supabase
    .from('character_masters')
    .select('*')
    .eq('user_id', userId)
    .is('portrait_url', null)
    .is('reference_sheet_url', null)
    .not('origin_story_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(MAX_REPAIR_PER_CALL);
  if (error || !data || data.length === 0) return [];

  const rows = data as DbCharacterMaster[];

  // One story fetch per distinct origin story, shared across its masters.
  const storyIds = Array.from(new Set(rows.map((row) => row.origin_story_id).filter(Boolean))) as string[];
  const storyById = new Map<string, { characters: Character[] | null; story_map: StoryMap | null }>();
  await Promise.all(
    storyIds.map(async (storyId) => {
      const { data: story } = await supabase
        .from('stories')
        .select('characters, story_map')
        .eq('id', storyId)
        .eq('user_id', userId)
        .maybeSingle();
      if (story) {
        storyById.set(storyId, {
          characters: (story.characters as Character[] | null) ?? null,
          story_map: (story.story_map as StoryMap | null) ?? null,
        });
      }
    })
  );

  const repaired: CharacterMaster[] = [];

  for (const row of rows) {
    try {
      const storyId = row.origin_story_id;
      const characterId = row.origin_character_id;
      if (!storyId || !characterId) continue;
      const story = storyById.get(storyId);
      if (!story) continue;

      // Identity base: prefer the story roster instance, else the master's own
      // fields — backfill only fills the visual refs.
      const rosterInstance = (story.characters ?? []).find((entry) => entry.id === characterId);
      const base: Character = rosterInstance ?? {
        id: characterId,
        name: row.name,
        type: row.type,
        appearanceSummary: row.appearance_summary,
        personalitySummary: row.personality_summary,
      };

      const enriched = await backfillCharacterVisualRefs(
        supabase,
        userId,
        storyId,
        characterId,
        base,
        story.story_map
      );
      if (!enriched.portraitUrl && !enriched.referenceSheetUrl) continue;

      const [portraitCopy, sheetCopy] = await Promise.all([
        enriched.portraitUrl
          ? copyAssetToLibraryKey(supabase, userId, row.id, enriched.portraitUrl, 'portrait')
          : Promise.resolve(null),
        enriched.referenceSheetUrl
          ? copyAssetToLibraryKey(supabase, userId, row.id, enriched.referenceSheetUrl, 'sheet')
          : Promise.resolve(null),
      ]);

      const patch = {
        portrait_url: portraitCopy?.url ?? enriched.portraitUrl ?? null,
        portrait_storage_key: portraitCopy?.storageKey ?? null,
        reference_sheet_url: sheetCopy?.url ?? enriched.referenceSheetUrl ?? null,
        reference_sheet_storage_key: sheetCopy?.storageKey ?? null,
        updated_at: new Date().toISOString(),
      };
      if (!patch.portrait_url && !patch.reference_sheet_url) continue;

      const { data: updated } = await supabase
        .from('character_masters')
        .update(patch)
        .eq('id', row.id)
        .eq('user_id', userId)
        .select('*')
        .single();
      if (updated) repaired.push(rowToMaster(updated as DbCharacterMaster));
    } catch (repairError) {
      console.error(`Failed to repair visuals for master ${row.id}:`, repairError);
    }
  }

  return repaired.length > 0 ? signMasterAssetUrls(supabase, repaired) : [];
}

// ── Story usage ────────────────────────────────────────────────────

export interface CharacterStoryUsage {
  id: string;
  title: string;
  status: string;
  is_archived: boolean;
  updated_at: string;
  episode_number: number | null;
  thumbnail_url: string | null;
  thumbnail_is_storyboard: boolean;
  /** True for the story this master was originally saved from. */
  isOrigin: boolean;
}

/**
 * Lists the user's stories that use a given library master, so the character
 * detail dialog can link out to each. Matches on the `masterId` stamped onto
 * `stories.characters` (set when a library character is mixed into a new story
 * or saved back), unioned with the master's `origin_story_id`.
 *
 * Known gap: stories that used the character before masterId-stamping existed
 * only surface via `origin_story_id`.
 */
export async function listStoriesUsingCharacterMaster(
  masterId: string
): Promise<CharacterStoryUsage[]> {
  await requireFeature('character_library_enabled', 'The character library');
  const { supabase, userId } = await requireUser();

  const { data: master } = await supabase
    .from('character_masters')
    .select('origin_story_id')
    .eq('id', masterId)
    .eq('user_id', userId)
    .maybeSingle();
  const originStoryId = (master?.origin_story_id as string | null) ?? null;

  const storyColumns =
    'id, title, status, is_archived, updated_at, cover_image_url, episode_number';

  const [taggedResult, originResult] = await Promise.all([
    supabase
      .from('stories')
      .select(storyColumns)
      .eq('user_id', userId)
      .neq('story_kind', 'reel')
      .contains('characters', JSON.stringify([{ masterId }]))
      .order('updated_at', { ascending: false }),
    originStoryId
      ? supabase
          .from('stories')
          .select(storyColumns)
          .eq('id', originStoryId)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  type StoryRow = {
    id: string;
    title: string;
    status: string;
    is_archived: boolean;
    updated_at: string;
    cover_image_url: string | null;
    episode_number: number | null;
  };

  const byId = new Map<string, StoryRow>();
  for (const row of (taggedResult.data as StoryRow[] | null) ?? []) {
    byId.set(row.id, row);
  }
  const originRow = (originResult as { data: StoryRow | null }).data;
  if (originRow) byId.set(originRow.id, originRow);

  const rows = Array.from(byId.values()).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
  if (rows.length === 0) return [];

  const thumbnails = await resolveStoryListThumbnails(supabase, rows);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    is_archived: Boolean(row.is_archived),
    updated_at: row.updated_at,
    episode_number: row.episode_number ?? null,
    thumbnail_url: thumbnails.get(row.id)?.url ?? null,
    thumbnail_is_storyboard: thumbnails.get(row.id)?.isStoryboard === true,
    isOrigin: row.id === originStoryId,
  }));
}
