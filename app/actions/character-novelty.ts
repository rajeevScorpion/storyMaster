'use server';

import { createClient } from '@/lib/supabase/server';
import {
  CHARACTER_NAME_HISTORY_LIMIT,
  EMPTY_CHARACTER_NOVELTY_CONTEXT,
  normalizeCharacterName,
  resolveCharacterNameSource,
  type CharacterNoveltyContext,
} from '@/lib/ai/character-novelty.shared';
import type { Character, StoryConfig } from '@/lib/types/story';

const NOVELTY_QUERY_LIMIT = CHARACTER_NAME_HISTORY_LIMIT * 3;

interface RecordCharacterNoveltyInput {
  storyId: string;
  characters: Character[];
  storyConfig?: Partial<StoryConfig> | null;
}

function isMissingNoveltyTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '42P01'
    || Boolean(error?.message?.includes('character_novelty_usage'));
}

export async function getCharacterNoveltyContextAction(): Promise<CharacterNoveltyContext> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return EMPTY_CHARACTER_NOVELTY_CONTEXT;

  const { data, error } = await supabase
    .from('character_novelty_usage')
    .select('display_name, normalized_name, appearance_signature')
    .eq('user_id', user.id)
    .order('last_used_at', { ascending: false })
    .limit(NOVELTY_QUERY_LIMIT);

  if (error) {
    if (!isMissingNoveltyTable(error)) {
      console.warn('Failed to load character novelty history:', error.message);
    }
    return EMPTY_CHARACTER_NOVELTY_CONTEXT;
  }

  const seenNames = new Set<string>();
  const recentCharacters: CharacterNoveltyContext['recentCharacters'] = [];
  for (const row of data || []) {
    const displayName = typeof row.display_name === 'string' ? row.display_name.trim() : '';
    const normalizedName = normalizeCharacterName(
      typeof row.normalized_name === 'string' ? row.normalized_name : displayName
    );
    if (!displayName || !normalizedName || seenNames.has(normalizedName)) continue;
    seenNames.add(normalizedName);
    recentCharacters.push({
      displayName,
      normalizedName,
      ...(typeof row.appearance_signature === 'string' && row.appearance_signature.trim()
        ? { appearanceSignature: row.appearance_signature.trim() }
        : {}),
    });
    if (recentCharacters.length >= CHARACTER_NAME_HISTORY_LIMIT) break;
  }

  return { recentCharacters };
}

export async function recordCharacterNoveltyUsageAction(
  input: RecordCharacterNoveltyInput
): Promise<void> {
  if (!input.storyId || input.characters.length === 0) return;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const rowsByCharacterId = new Map<string, Record<string, unknown>>();
  for (const character of input.characters) {
    if (!character.id?.trim() || !character.name?.trim()) continue;
    rowsByCharacterId.set(character.id, {
      user_id: user.id,
      story_id: input.storyId,
      character_id: character.id,
      display_name: character.name.trim().slice(0, 120),
      normalized_name: normalizeCharacterName(character.name).slice(0, 120),
      appearance_signature: character.appearanceSummary?.trim().slice(0, 300) || null,
      name_source: resolveCharacterNameSource(character),
      ...(input.storyConfig?.language?.trim()
        ? { language: input.storyConfig.language.trim().slice(0, 40) }
        : {}),
      ...(input.storyConfig?.settingCountry?.trim()
        ? { setting_country: input.storyConfig.settingCountry.trim().slice(0, 80) }
        : {}),
      last_used_at: new Date().toISOString(),
    });
  }
  const rows = Array.from(rowsByCharacterId.values());
  if (rows.length === 0) return;

  const { error } = await supabase
    .from('character_novelty_usage')
    .upsert(rows, { onConflict: 'user_id,story_id,character_id' });

  if (error && !isMissingNoveltyTable(error)) {
    console.warn('Failed to record character novelty history:', error.message);
  }
}
