'use server';

import { createAdminClient, verifyAdmin } from '@/lib/supabase/admin';
import { mapReelMoodRow, slugifyMoodName, type ReelMoodRecord } from '@/lib/reel/moods';

type MoodRow = Record<string, unknown>;

async function getCurrentUserId(): Promise<string | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function listMoodRows(status?: string): Promise<MoodRow[]> {
  const admin = createAdminClient();
  let query = admin
    .from('reel_moods')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    if (error.message.includes('reel_moods')) return [];
    throw new Error(`Failed to load reel moods: ${error.message}`);
  }
  return (data ?? []) as MoodRow[];
}

export async function listReelMoodsForAdminAction(): Promise<ReelMoodRecord[]> {
  await verifyAdmin();
  const rows = await listMoodRows();
  return rows.map(mapReelMoodRow);
}

export async function listPublishedReelMoodsAction(): Promise<ReelMoodRecord[]> {
  const rows = await listMoodRows('published');
  return rows.map(mapReelMoodRow);
}

export async function getPublishedReelMoodsForRuntime(): Promise<Array<{ slug: string; name: string; promptDefiner: string }>> {
  const rows = await listMoodRows('published');
  return rows.map((row) => ({
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    promptDefiner: String(row.prompt_definer ?? ''),
  }));
}

export async function saveReelMoodAction(input: {
  name: string;
  slug?: string;
  promptDefiner: string;
  sortOrder?: number;
}): Promise<ReelMoodRecord> {
  await verifyAdmin();
  const name = input.name.trim();
  if (!name) throw new Error('Mood name is required.');

  const slug = (input.slug?.trim() || slugifyMoodName(name));
  if (!slug) throw new Error('Mood slug is required.');

  const promptDefiner = input.promptDefiner.trim();
  if (!promptDefiner) throw new Error('Prompt definer is required.');

  const userId = await getCurrentUserId();
  const admin = createAdminClient();

  const row: MoodRow = {
    name,
    slug,
    prompt_definer: promptDefiner,
    status: 'draft',
    sort_order: Number.isFinite(Number(input.sortOrder)) ? Math.round(Number(input.sortOrder)) : 0,
    created_by: userId,
    updated_by: userId,
  };

  const { data, error } = await admin
    .from('reel_moods')
    .upsert(row, { onConflict: 'slug' })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to save reel mood: ${error.message}`);
  return mapReelMoodRow(data as MoodRow);
}

export async function publishReelMoodAction(id: string): Promise<ReelMoodRecord> {
  await verifyAdmin();
  const userId = await getCurrentUserId();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('reel_moods')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to publish reel mood: ${error.message}`);
  return mapReelMoodRow(data as MoodRow);
}

export async function setReelMoodStatusAction(
  id: string,
  status: 'draft' | 'archived'
): Promise<ReelMoodRecord> {
  await verifyAdmin();
  const userId = await getCurrentUserId();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('reel_moods')
    .update({
      status,
      published_at: status === 'archived' ? null : undefined,
      updated_by: userId,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to update reel mood status: ${error.message}`);
  return mapReelMoodRow(data as MoodRow);
}
