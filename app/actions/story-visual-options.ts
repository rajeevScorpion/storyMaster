'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import {
  isStoryVisualCategory,
  slugifyStoryVisualOption,
  type StoryVisualCategory,
  type StoryVisualOption,
  type StoryVisualOptionStatus,
} from '@/lib/ai/story-visual-options.shared';
import {
  listStoryVisualOptionRows,
  mapStoryVisualOptionRow,
  type StoryVisualOptionRow,
} from '@/lib/ai/story-visual-options.server';

export interface SaveStoryVisualOptionInput {
  id?: string;
  category: StoryVisualCategory;
  key?: string;
  label: string;
  description: string;
  visualPromptDefiner: string;
  narrativePromptDefiner?: string | null;
  sortOrder?: number;
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function revalidateStoryVisualSurfaces(): void {
  revalidatePath('/');
  revalidatePath('/admin/settings');
  revalidatePath('/admin/settings/story-visuals');
}

function validatePrompt(value: string, label: string, required = true): string | null {
  const clean = value.trim();
  if (required && !clean) throw new Error(`${label} is required.`);
  if (!clean) return null;
  if (countWords(clean) > 150) throw new Error(`${label} must be 150 words or fewer.`);
  return clean;
}

export async function listStoryVisualOptionsForAdminAction(): Promise<StoryVisualOption[]> {
  await verifyAdmin();
  const rows = await listStoryVisualOptionRows();
  return rows.map(mapStoryVisualOptionRow);
}

export async function saveStoryVisualOptionAction(
  input: SaveStoryVisualOptionInput
): Promise<StoryVisualOption> {
  const { user } = await verifyAdmin();
  if (!isStoryVisualCategory(input.category)) throw new Error('A valid option category is required.');
  const label = input.label.trim();
  if (!label) throw new Error('Label is required.');
  const optionKey = slugifyStoryVisualOption(input.key || label);
  if (!optionKey) throw new Error('Option key is required.');
  const description = input.description.trim();
  if (!description) throw new Error('A short user-facing description is required.');
  if (description.length > 240) throw new Error('Description must be 240 characters or fewer.');
  const visualPromptDefiner = validatePrompt(input.visualPromptDefiner, 'Visual prompt definer')!;
  const narrativePromptDefiner = validatePrompt(
    input.narrativePromptDefiner || '',
    'Narrative prompt definer',
    false
  );
  if (input.category === 'mood' && !narrativePromptDefiner) {
    throw new Error('Mood options need a narrative prompt definer.');
  }

  const admin = createAdminClient();
  const row: StoryVisualOptionRow = {
    category: input.category,
    option_key: optionKey,
    label,
    description,
    visual_prompt_definer: visualPromptDefiner,
    narrative_prompt_definer: input.category === 'mood' ? narrativePromptDefiner : null,
    status: 'draft',
    is_default: false,
    sort_order: Number.isFinite(Number(input.sortOrder)) ? Math.round(Number(input.sortOrder)) : 0,
    updated_by: user.id,
  };

  let query;
  if (input.id) {
    query = admin
      .from('story_visual_options')
      .update(row)
      .eq('id', input.id)
      .select('*')
      .single();
  } else {
    query = admin
      .from('story_visual_options')
      .upsert({ ...row, created_by: user.id }, { onConflict: 'category,option_key' })
      .select('*')
      .single();
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to save story visual option: ${error.message}`);
  revalidateStoryVisualSurfaces();
  return mapStoryVisualOptionRow(data as StoryVisualOptionRow);
}

export async function publishStoryVisualOptionAction(id: string): Promise<StoryVisualOption> {
  const { user } = await verifyAdmin();
  const admin = createAdminClient();
  const { data: existing, error: loadError } = await admin
    .from('story_visual_options')
    .select('*')
    .eq('id', id)
    .single();
  if (loadError || !existing) throw new Error(`Failed to load story visual option: ${loadError?.message || 'not found'}`);
  const current = mapStoryVisualOptionRow(existing as StoryVisualOptionRow);
  const { count } = await admin
    .from('story_visual_options')
    .select('*', { count: 'exact', head: true })
    .eq('category', current.category)
    .eq('status', 'published');
  const makeDefault = (count ?? 0) === 0;
  const { data, error } = await admin
    .from('story_visual_options')
    .update({
      status: 'published',
      is_default: makeDefault,
      published_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to publish story visual option: ${error.message}`);
  revalidateStoryVisualSurfaces();
  return mapStoryVisualOptionRow(data as StoryVisualOptionRow);
}

export async function setStoryVisualOptionStatusAction(
  id: string,
  status: Exclude<StoryVisualOptionStatus, 'published'>
): Promise<StoryVisualOption> {
  const { user } = await verifyAdmin();
  const admin = createAdminClient();
  const { data: existing, error: loadError } = await admin
    .from('story_visual_options')
    .select('*')
    .eq('id', id)
    .single();
  if (loadError || !existing) throw new Error(`Failed to load story visual option: ${loadError?.message || 'not found'}`);
  const current = mapStoryVisualOptionRow(existing as StoryVisualOptionRow);
  if (current.status === 'published') {
    if (current.isDefault) throw new Error('Choose another default before removing this option.');
    const { count } = await admin
      .from('story_visual_options')
      .select('*', { count: 'exact', head: true })
      .eq('category', current.category)
      .eq('status', 'published');
    if ((count ?? 0) <= 1) throw new Error('At least one published option must remain in each category.');
  }
  const { data, error } = await admin
    .from('story_visual_options')
    .update({
      status,
      is_default: false,
      published_at: null,
      updated_by: user.id,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to update story visual option: ${error.message}`);
  revalidateStoryVisualSurfaces();
  return mapStoryVisualOptionRow(data as StoryVisualOptionRow);
}

export async function setDefaultStoryVisualOptionAction(id: string): Promise<StoryVisualOption> {
  const { user } = await verifyAdmin();
  const admin = createAdminClient();
  const { data: existing, error: loadError } = await admin
    .from('story_visual_options')
    .select('*')
    .eq('id', id)
    .single();
  if (loadError || !existing) throw new Error(`Failed to load story visual option: ${loadError?.message || 'not found'}`);
  const current = mapStoryVisualOptionRow(existing as StoryVisualOptionRow);
  if (current.status !== 'published') throw new Error('Only published options can be the default.');
  const { error: clearError } = await admin
    .from('story_visual_options')
    .update({ is_default: false, updated_by: user.id })
    .eq('category', current.category)
    .eq('is_default', true);
  if (clearError) throw new Error(`Failed to clear the previous default: ${clearError.message}`);
  const { data, error } = await admin
    .from('story_visual_options')
    .update({ is_default: true, updated_by: user.id })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`Failed to set story visual default: ${error.message}`);
  revalidateStoryVisualSurfaces();
  return mapStoryVisualOptionRow(data as StoryVisualOptionRow);
}

export async function deleteStoryVisualOptionDraftAction(id: string): Promise<void> {
  await verifyAdmin();
  const admin = createAdminClient();
  const { data: existing, error: loadError } = await admin
    .from('story_visual_options')
    .select('status,is_default')
    .eq('id', id)
    .single();
  if (loadError || !existing) throw new Error(`Failed to load story visual option: ${loadError?.message || 'not found'}`);
  if (existing.status !== 'draft' || existing.is_default === true) {
    throw new Error('Only non-default drafts can be permanently deleted. Archive published options instead.');
  }
  const { error } = await admin.from('story_visual_options').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete story visual option: ${error.message}`);
  revalidateStoryVisualSurfaces();
}
