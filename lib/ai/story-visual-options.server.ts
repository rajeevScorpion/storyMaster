import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  normalizeStoryVisualCatalog,
  type StoryVisualCatalog,
  type StoryVisualOption,
  type StoryVisualOptionStatus,
} from '@/lib/ai/story-visual-options.shared';

export type StoryVisualOptionRow = Record<string, unknown>;

function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '42P01' || Boolean(error?.message?.includes('story_visual_options'));
}

export function mapStoryVisualOptionRow(row: StoryVisualOptionRow): StoryVisualOption {
  const status: StoryVisualOptionStatus = row.status === 'published' || row.status === 'archived'
    ? row.status
    : 'draft';
  return {
    id: String(row.id ?? ''),
    category: row.category === 'mood' || row.category === 'palette' || row.category === 'detail'
      ? row.category
      : 'style',
    key: String(row.option_key ?? ''),
    label: String(row.label ?? ''),
    description: String(row.description ?? ''),
    visualPromptDefiner: String(row.visual_prompt_definer ?? ''),
    narrativePromptDefiner: typeof row.narrative_prompt_definer === 'string' && row.narrative_prompt_definer.trim()
      ? row.narrative_prompt_definer
      : null,
    status,
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Math.round(Number(row.sort_order)) : 0,
    isDefault: row.is_default === true,
  };
}

export async function listStoryVisualOptionRows(
  status?: StoryVisualOptionStatus
): Promise<StoryVisualOptionRow[]> {
  const admin = createAdminClient();
  let query = admin
    .from('story_visual_options')
    .select('*')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(`Failed to load story visual options: ${error.message}`);
  }
  return (data ?? []) as StoryVisualOptionRow[];
}

export async function getPublishedStoryVisualCatalog(): Promise<StoryVisualCatalog> {
  const rows = await listStoryVisualOptionRows('published');
  return normalizeStoryVisualCatalog(rows.map(mapStoryVisualOptionRow));
}
