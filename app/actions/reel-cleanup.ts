'use server';

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { deleteR2Object } from '@/lib/media/r2-server';

export type ReelCleanupMode = 'dry_run' | 'execute';

export interface ReelCleanupStorySummary {
  storyId: string;
  title: string;
  userId: string;
  status: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  privateAssetCount: number;
  publicAssetCount: number;
  objectKeys: string[];
}

export interface ReelCleanupResult {
  mode: ReelCleanupMode;
  status: 'completed' | 'failed';
  message: string;
  runId: string | null;
  eligibleStoryCount: number;
  deletedStoryCount: number;
  deletedAssetCount: number;
  failedAssetCount: number;
  deletedObjectKeys: string[];
  errors: string[];
  stories: ReelCleanupStorySummary[];
}

interface ReelCleanupStoryRow {
  id: string;
  title: string | null;
  user_id: string;
  status: string | null;
  created_at: string | null;
  reel_expires_at: string | null;
}

interface ReelCleanupMediaAssetRow {
  id: string;
  story_id: string | null;
  storage_provider: 'supabase' | 'r2' | string;
  bucket: string;
  object_key: string;
  is_public: boolean | null;
}

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

function normalizeBatchSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.round(parsed)));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : 'Unknown error';
  }
  return String(error || 'Unknown error');
}

function isMissingMigrationError(error: unknown): boolean {
  const raw = error && typeof error === 'object' ? error as { code?: string; message?: string } : {};
  const message = (raw.message || '').toLowerCase();
  return raw.code === '42P01'
    || raw.code === '42703'
    || message.includes('reel_cleanup_runs')
    || message.includes('story_kind')
    || message.includes('reel_expires_at')
    || message.includes('media_assets');
}

async function assertCleanupMigrationReady(supabase: ReturnType<typeof createAdminClient>): Promise<void> {
  const { error } = await supabase
    .from('reel_cleanup_runs')
    .select('id')
    .limit(1);
  if (error) throw error;
}

async function loadExpiredReelStories(
  supabase: ReturnType<typeof createAdminClient>,
  limit: number
): Promise<ReelCleanupStoryRow[]> {
  const { data, error } = await supabase
    .from('stories')
    .select('id, title, user_id, status, created_at, reel_expires_at')
    .eq('story_kind', 'reel')
    .eq('reel_cleanup_status', 'active')
    .not('reel_expires_at', 'is', null)
    .lte('reel_expires_at', new Date().toISOString())
    .order('reel_expires_at', { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data || []) as ReelCleanupStoryRow[];
}

async function loadPublicStorylineStoryIds(
  supabase: ReturnType<typeof createAdminClient>,
  storyIds: string[]
): Promise<Set<string>> {
  if (storyIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('storylines')
    .select('story_id')
    .in('story_id', storyIds)
    .eq('is_public', true);

  if (error) throw error;
  return new Set((data || []).map((row) => row.story_id).filter(Boolean));
}

async function loadMediaAssets(
  supabase: ReturnType<typeof createAdminClient>,
  storyIds: string[]
): Promise<ReelCleanupMediaAssetRow[]> {
  if (storyIds.length === 0) return [];
  const { data, error } = await supabase
    .from('media_assets')
    .select('id, story_id, storage_provider, bucket, object_key, is_public')
    .in('story_id', storyIds);

  if (error) throw error;
  return (data || []) as ReelCleanupMediaAssetRow[];
}

function buildStorySummaries(
  stories: ReelCleanupStoryRow[],
  assets: ReelCleanupMediaAssetRow[]
): ReelCleanupStorySummary[] {
  const assetsByStory = new Map<string, ReelCleanupMediaAssetRow[]>();
  for (const asset of assets) {
    if (!asset.story_id) continue;
    const list = assetsByStory.get(asset.story_id) || [];
    list.push(asset);
    assetsByStory.set(asset.story_id, list);
  }

  return stories.map((story) => {
    const storyAssets = assetsByStory.get(story.id) || [];
    const privateAssets = storyAssets.filter((asset) => !asset.is_public);
    return {
      storyId: story.id,
      title: story.title || 'Untitled reel',
      userId: story.user_id,
      status: story.status,
      createdAt: story.created_at,
      expiresAt: story.reel_expires_at,
      privateAssetCount: privateAssets.length,
      publicAssetCount: storyAssets.length - privateAssets.length,
      objectKeys: privateAssets.map((asset) => `${asset.storage_provider}:${asset.bucket}/${asset.object_key}`),
    };
  });
}

async function deleteMediaAsset(
  supabase: ReturnType<typeof createAdminClient>,
  asset: ReelCleanupMediaAssetRow
): Promise<void> {
  if (asset.storage_provider === 'r2') {
    await deleteR2Object(asset.bucket, asset.object_key);
    return;
  }

  if (asset.storage_provider === 'supabase') {
    const { error } = await supabase.storage
      .from(asset.bucket)
      .remove([asset.object_key]);
    if (error) throw error;
    return;
  }

  throw new Error(`Unsupported storage provider: ${asset.storage_provider}`);
}

async function markStoryCleanupFailed(
  supabase: ReturnType<typeof createAdminClient>,
  storyId: string,
  message: string
): Promise<void> {
  await supabase
    .from('stories')
    .update({
      reel_cleanup_status: 'failed',
      reel_cleanup_last_error: message.slice(0, 1000),
    })
    .eq('id', storyId)
    .eq('story_kind', 'reel');
}

async function recordCleanupRun(
  supabase: ReturnType<typeof createAdminClient>,
  input: {
    actorUserId: string;
    result: ReelCleanupResult;
  }
): Promise<string | null> {
  const { data, error } = await supabase
    .from('reel_cleanup_runs')
    .insert({
      actor_user_id: input.actorUserId,
      mode: input.result.mode,
      status: input.result.status,
      eligible_story_count: input.result.eligibleStoryCount,
      deleted_story_count: input.result.deletedStoryCount,
      deleted_asset_count: input.result.deletedAssetCount,
      failed_asset_count: input.result.failedAssetCount,
      deleted_object_keys: input.result.deletedObjectKeys,
      error_messages: input.result.errors,
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    input.result.errors.push(`Failed to write cleanup audit: ${error.message}`);
    input.result.status = 'failed';
    return null;
  }

  return data?.id || null;
}

export async function runReelCleanup(input: {
  mode: ReelCleanupMode;
  batchSize?: number;
}): Promise<ReelCleanupResult> {
  const mode: ReelCleanupMode = input.mode === 'execute' ? 'execute' : 'dry_run';
  const batchSize = normalizeBatchSize(input.batchSize);
  const { user } = await verifyAdmin();
  const supabase = createAdminClient();

  const result: ReelCleanupResult = {
    mode,
    status: 'completed',
    message: '',
    runId: null,
    eligibleStoryCount: 0,
    deletedStoryCount: 0,
    deletedAssetCount: 0,
    failedAssetCount: 0,
    deletedObjectKeys: [],
    errors: [],
    stories: [],
  };

  try {
    await assertCleanupMigrationReady(supabase);
    const candidates = await loadExpiredReelStories(supabase, batchSize);
    const publicStoryIds = await loadPublicStorylineStoryIds(supabase, candidates.map((story) => story.id));
    const eligibleStories = candidates.filter((story) => !publicStoryIds.has(story.id));
    const assets = await loadMediaAssets(supabase, eligibleStories.map((story) => story.id));
    const privateAssets = assets.filter((asset) => !asset.is_public);
    const assetsByStory = new Map<string, ReelCleanupMediaAssetRow[]>();

    for (const asset of privateAssets) {
      if (!asset.story_id) continue;
      const list = assetsByStory.get(asset.story_id) || [];
      list.push(asset);
      assetsByStory.set(asset.story_id, list);
    }

    result.stories = buildStorySummaries(eligibleStories, assets);
    result.eligibleStoryCount = eligibleStories.length;

    if (mode === 'dry_run') {
      result.message = eligibleStories.length === 0
        ? 'No expired unpublished reel drafts are eligible for cleanup.'
        : `${eligibleStories.length} expired unpublished reel draft(s) are eligible for cleanup.`;
      result.runId = await recordCleanupRun(supabase, { actorUserId: user.id, result });
      return result;
    }

    for (const story of eligibleStories) {
      const storyAssets = assetsByStory.get(story.id) || [];
      const summary = result.stories.find((item) => item.storyId === story.id);

      if (summary && summary.publicAssetCount > 0) {
        const message = 'Skipped because public media asset metadata is attached to this draft.';
        result.errors.push(`${story.id}: ${message}`);
        result.failedAssetCount += summary.publicAssetCount;
        await markStoryCleanupFailed(supabase, story.id, message);
        continue;
      }

      const storyErrors: string[] = [];
      for (const asset of storyAssets) {
        try {
          await deleteMediaAsset(supabase, asset);
          result.deletedAssetCount += 1;
          result.deletedObjectKeys.push(`${asset.storage_provider}:${asset.bucket}/${asset.object_key}`);
        } catch (error) {
          const message = `${asset.storage_provider}:${asset.bucket}/${asset.object_key} - ${errorMessage(error)}`;
          storyErrors.push(message);
          result.errors.push(`${story.id}: ${message}`);
          result.failedAssetCount += 1;
        }
      }

      if (storyErrors.length > 0) {
        await markStoryCleanupFailed(supabase, story.id, storyErrors.join('; '));
        continue;
      }

      const { error: deleteStoryError } = await supabase
        .from('stories')
        .delete()
        .eq('id', story.id)
        .eq('story_kind', 'reel');

      if (deleteStoryError) {
        const message = `Failed to delete story row: ${deleteStoryError.message}`;
        result.errors.push(`${story.id}: ${message}`);
        await markStoryCleanupFailed(supabase, story.id, message);
        continue;
      }

      result.deletedStoryCount += 1;
    }

    if (result.errors.length > 0) {
      result.status = result.deletedStoryCount > 0 ? 'completed' : 'failed';
    }
    result.message = `Deleted ${result.deletedStoryCount} reel draft(s) and ${result.deletedAssetCount} private asset(s).`;
    result.runId = await recordCleanupRun(supabase, { actorUserId: user.id, result });
    return result;
  } catch (error) {
    const message = isMissingMigrationError(error)
      ? 'Reel cleanup requires the manual Reel Story migration to be applied first.'
      : errorMessage(error);
    result.status = 'failed';
    result.message = message;
    result.errors.push(message);
    return result;
  }
}
