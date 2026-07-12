import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import { parseReelStorySettingsValue } from '@/lib/reel/settings';
import {
  canUseReelVisualStyle,
  mapReelVisualStyleRow,
  normalizePlanKey,
  normalizeReelTextOverlayStyle,
  type ReelVisualStyleCard,
  type ReelVisualStyleRecord,
  type ReelVisualStyleStatus,
} from '@/lib/reel/styles';
import type { PlanKey } from '@/lib/types/pricing';

export type ReelStyleRow = Record<string, unknown>;

export async function listReelStyleRows(status?: ReelVisualStyleStatus): Promise<ReelStyleRow[]> {
  const admin = createAdminClient();
  let query = admin
    .from('reel_visual_styles')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    if (error.message.includes('reel_visual_styles')) return [];
    throw new Error(`Failed to load reel visual styles: ${error.message}`);
  }
  return (data ?? []) as ReelStyleRow[];
}

export async function buildSettingsFallbackStyleCards(): Promise<ReelVisualStyleCard[]> {
  const settings = parseReelStorySettingsValue(await getFeatureFlagValue('reel_story_settings'));
  return settings.visualStyles.map((style, index) => {
    const record: ReelVisualStyleRecord = {
      id: `settings:${style.key}`,
      name: style.label,
      slug: style.key,
      status: 'published',
      minPlan: 'free',
      promptDefiner: style.prompt,
      sampleImageUrl: null,
      sampleR2ObjectKey: null,
      sampleR2Bucket: null,
      thumbnailUrl: null,
      thumbnailR2ObjectKey: null,
      thumbnailR2Bucket: null,
      textOverlayStyle: normalizeReelTextOverlayStyle(null),
      noFaceDefault: true,
      sortOrder: index,
      createdAt: '',
      updatedAt: '',
      publishedAt: null,
    };
    return { ...record, isLocked: false };
  });
}

export async function buildReelVisualStyleCards(
  planKey: PlanKey | null | undefined
): Promise<ReelVisualStyleCard[]> {
  const rows = await listReelStyleRows('published');
  if (rows.length === 0) {
    return buildSettingsFallbackStyleCards();
  }

  const userPlan = normalizePlanKey(planKey ?? undefined);
  return rows.map((row) => {
    const record = mapReelVisualStyleRow(row);
    return {
      ...record,
      isLocked: !canUseReelVisualStyle(userPlan, record.minPlan),
    };
  });
}
