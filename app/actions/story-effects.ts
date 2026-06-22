'use server';

import { createClient } from '@/lib/supabase/server';
import type { StoryEffectPreset } from '@/lib/story-effects/presets';
import {
  STORY_EFFECT_SCHEMA_VERSION,
  normalizeStoryEffectConfig,
  type StoryEffectConfig,
} from '@/lib/story-effects/settings';

interface StoryEffectPresetRow {
  id: string;
  name: string;
  description: string | null;
  effect_config: unknown;
  created_at: string;
  updated_at: string;
}

function presetFromRow(row: StoryEffectPresetRow): StoryEffectPreset {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    isSystem: false,
    config: normalizeStoryEffectConfig(row.effect_config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Sign in to manage reusable effect presets.');
  return { supabase, user };
}

function normalizePresetText(name: string, description = '') {
  const normalizedName = name.trim().slice(0, 80);
  if (!normalizedName) throw new Error('Preset name is required.');
  return { name: normalizedName, description: description.trim().slice(0, 240) };
}

export async function listStoryEffectPresetsAction(): Promise<StoryEffectPreset[]> {
  const { supabase, user } = await authenticatedClient();
  const { data, error } = await supabase
    .from('story_effect_presets')
    .select('id, name, description, effect_config, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Unable to load effect presets: ${error.message}`);
  return ((data || []) as StoryEffectPresetRow[]).map(presetFromRow);
}

export async function createStoryEffectPresetAction(input: {
  name: string;
  description?: string;
  config: StoryEffectConfig;
}): Promise<StoryEffectPreset> {
  const { supabase, user } = await authenticatedClient();
  const text = normalizePresetText(input.name, input.description);
  const { data, error } = await supabase
    .from('story_effect_presets')
    .insert({ user_id: user.id, ...text, schema_version: STORY_EFFECT_SCHEMA_VERSION, effect_config: normalizeStoryEffectConfig(input.config) })
    .select('id, name, description, effect_config, created_at, updated_at')
    .single();
  if (error || !data) throw new Error(`Unable to save effect preset: ${error?.message || 'No preset returned.'}`);
  return presetFromRow(data as StoryEffectPresetRow);
}

export async function updateStoryEffectPresetAction(input: {
  id: string;
  name: string;
  description?: string;
  config: StoryEffectConfig;
}): Promise<StoryEffectPreset> {
  const { supabase, user } = await authenticatedClient();
  const text = normalizePresetText(input.name, input.description);
  const { data, error } = await supabase
    .from('story_effect_presets')
    .update({ ...text, schema_version: STORY_EFFECT_SCHEMA_VERSION, effect_config: normalizeStoryEffectConfig(input.config) })
    .eq('id', input.id)
    .eq('user_id', user.id)
    .select('id, name, description, effect_config, created_at, updated_at')
    .single();
  if (error || !data) throw new Error(`Unable to update effect preset: ${error?.message || 'Preset not found.'}`);
  return presetFromRow(data as StoryEffectPresetRow);
}

export async function deleteStoryEffectPresetAction(id: string): Promise<void> {
  const { supabase, user } = await authenticatedClient();
  const { error } = await supabase.from('story_effect_presets').delete().eq('id', id).eq('user_id', user.id);
  if (error) throw new Error(`Unable to delete effect preset: ${error.message}`);
}
