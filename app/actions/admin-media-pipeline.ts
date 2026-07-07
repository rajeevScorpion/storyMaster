'use server';

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlagValue, setFeatureFlagValue } from '@/lib/ai/model-config';
import {
  MEDIA_PIPELINE_FLAG_KEYS,
  normalizeMediaPipelineSettings,
  normalizeMediaProcessingMode,
  type MediaPipelineAdminState,
  type MediaPipelineSettings,
  type MediaProcessingMode,
} from '@/lib/media/media-pipeline-settings';
import {
  getConfiguredProcessingMode,
  getMediaCanaryUserIds,
  getMediaPipelineSettings,
  getServerPipelineAvailability,
} from '@/lib/media/processing-mode';
import { cleanupExpiredOriginals, MEDIA_CLEANUP_LAST_RUN_FLAG, type CleanupResult } from '@/lib/media/cleanup';

export async function getMediaPipelineAdminState(): Promise<MediaPipelineAdminState> {
  await verifyAdmin();
  const [mode, canaryUserIds, settings, availability] = await Promise.all([
    getConfiguredProcessingMode(),
    getMediaCanaryUserIds(),
    getMediaPipelineSettings(),
    getServerPipelineAvailability(),
  ]);
  return {
    mode,
    canaryUserIds,
    settings,
    serverPipelineAvailable: availability.available,
    serverPipelineUnavailableReason: availability.reason,
  };
}

export async function setMediaProcessingMode(mode: MediaProcessingMode): Promise<MediaPipelineAdminState> {
  await verifyAdmin();
  const normalized = normalizeMediaProcessingMode(mode);
  if (normalized !== 'client_legacy') {
    const availability = await getServerPipelineAvailability();
    if (!availability.available) {
      throw new Error(
        `Cannot enable ${normalized}: ${availability.reason ?? 'server pipeline unavailable'}`
      );
    }
  }
  await setFeatureFlagValue(MEDIA_PIPELINE_FLAG_KEYS.processingMode, normalized);
  return getMediaPipelineAdminState();
}

export async function setMediaCanaryUserIds(userIds: string[]): Promise<MediaPipelineAdminState> {
  await verifyAdmin();
  const cleaned = userIds.map((id) => id.trim()).filter((id) => id.length > 0);
  await setFeatureFlagValue(MEDIA_PIPELINE_FLAG_KEYS.canaryUserIds, JSON.stringify(cleaned));
  return getMediaPipelineAdminState();
}

export async function saveMediaPipelineSettings(
  input: Partial<MediaPipelineSettings>
): Promise<MediaPipelineAdminState> {
  await verifyAdmin();
  const current = await getMediaPipelineSettings();
  const next = normalizeMediaPipelineSettings({ ...current, ...input });
  await setFeatureFlagValue(MEDIA_PIPELINE_FLAG_KEYS.settings, JSON.stringify(next));
  return getMediaPipelineAdminState();
}

// ============================================================
// Metrics & operator actions
// ============================================================

export interface MediaPipelineMetrics {
  jobs24h: Record<string, number>;
  jobs7d: Record<string, number>;
  activeJobs: number;
  failedJobs7d: number;
  originalsExpiring24h: number;
  originalsExpiring7d: number;
  assetCountsByVariant: Record<string, number>;
  lastCleanup: (CleanupResult & { ranAt: string }) | null;
  recentFailedJobs: Array<{
    id: string;
    storyId: string;
    nodeId: string;
    error: string | null;
    attemptCount: number;
    updatedAt: string;
  }>;
}

export async function getMediaPipelineMetrics(): Promise<MediaPipelineMetrics> {
  await verifyAdmin();
  const admin = createAdminClient();
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
  const dayAhead = new Date(now + 24 * 3600 * 1000).toISOString();
  const weekAhead = new Date(now + 7 * 24 * 3600 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  const [jobsResult, expiring24Result, expiring7Result, failedJobsResult] = await Promise.all([
    admin
      .from('image_generation_jobs')
      .select('status, created_at')
      .gte('created_at', weekAgo),
    admin
      .from('media_assets')
      .select('id', { count: 'exact', head: true })
      .eq('variant', 'original')
      .gte('original_expires_at', nowIso)
      .lt('original_expires_at', dayAhead),
    admin
      .from('media_assets')
      .select('id', { count: 'exact', head: true })
      .eq('variant', 'original')
      .gte('original_expires_at', nowIso)
      .lt('original_expires_at', weekAhead),
    admin
      .from('image_generation_jobs')
      .select('id, story_id, node_id, error, attempt_count, updated_at')
      .eq('status', 'failed')
      .gte('updated_at', weekAgo)
      .order('updated_at', { ascending: false })
      .limit(20),
  ]);

  const jobs24h: Record<string, number> = {};
  const jobs7d: Record<string, number> = {};
  for (const row of jobsResult.data ?? []) {
    jobs7d[row.status] = (jobs7d[row.status] ?? 0) + 1;
    if (row.created_at >= dayAgo) jobs24h[row.status] = (jobs24h[row.status] ?? 0) + 1;
  }

  // Variant counts via cheap head-count queries (byte sums would need
  // PostgREST aggregates; counts are enough for rollout monitoring).
  const variants = ['original', 'display', 'thumbnail', 'share_low', 'share_high'] as const;
  const variantCounts = await Promise.all(
    variants.map((variant) =>
      admin
        .from('media_assets')
        .select('id', { count: 'exact', head: true })
        .eq('variant', variant)
        .then(({ count }) => [variant, count ?? 0] as const)
    )
  );

  let lastCleanup: MediaPipelineMetrics['lastCleanup'] = null;
  const lastCleanupRaw = await getFeatureFlagValue(MEDIA_CLEANUP_LAST_RUN_FLAG);
  if (lastCleanupRaw) {
    try {
      lastCleanup = JSON.parse(lastCleanupRaw) as MediaPipelineMetrics['lastCleanup'];
    } catch {
      lastCleanup = null;
    }
  }

  return {
    jobs24h,
    jobs7d,
    activeJobs: (jobs7d.pending ?? 0) + (jobs7d.processing ?? 0),
    failedJobs7d: jobs7d.failed ?? 0,
    originalsExpiring24h: expiring24Result.count ?? 0,
    originalsExpiring7d: expiring7Result.count ?? 0,
    assetCountsByVariant: Object.fromEntries(variantCounts),
    lastCleanup,
    recentFailedJobs: (failedJobsResult.data ?? []).map((row) => ({
      id: row.id,
      storyId: row.story_id,
      nodeId: row.node_id,
      error: row.error,
      attemptCount: row.attempt_count,
      updatedAt: row.updated_at,
    })),
  };
}

/** Requeue a failed image job: reset attempts, mark the beat pending again,
 *  and kick the worker. The reservation was already released on failure, so
 *  the retry is free for the user (admin remediation). */
export async function requeueImageJob(jobId: string): Promise<{ requeued: boolean }> {
  await verifyAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from('image_generation_jobs')
    .update({ status: 'pending', attempt_count: 0, error: null, claimed_at: null, completed_at: null })
    .eq('id', jobId)
    .eq('status', 'failed')
    .select('id, story_id, node_id')
    .maybeSingle();
  if (!data) return { requeued: false };

  await admin
    .from('beats')
    .update({ image_status: 'pending', image_error: null })
    .eq('story_id', data.story_id)
    .eq('node_id', data.node_id);

  const secret = process.env.CRON_SECRET;
  const base = (process.env.APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')).replace(/\/$/, '');
  await fetch(`${base}/api/media/jobs/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ jobId }),
    signal: AbortSignal.timeout(15_000),
    keepalive: true,
  }).catch((error) => console.error('Failed to kick worker after requeue:', error));

  return { requeued: true };
}

/** Run retention cleanup immediately, regardless of the cleanupEnabled flag. */
export async function forceCleanupExpiredOriginals(): Promise<CleanupResult> {
  await verifyAdmin();
  const settings = await getMediaPipelineSettings();
  return cleanupExpiredOriginals({ batchSize: settings.cleanupBatchSize });
}

/** Kill a storyline's unlisted share link (admin moderation action). */
export async function adminRevokeShareToken(storylineId: string): Promise<void> {
  await verifyAdmin();
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('storylines')
    .select('id, visibility')
    .eq('id', storylineId)
    .maybeSingle();
  if (!row) throw new Error('Storyline not found.');
  const update: Record<string, unknown> = { share_token: null };
  if (row.visibility === 'unlisted') {
    update.visibility = 'private';
    update.unpublished_at = new Date().toISOString();
  }
  const { error } = await admin.from('storylines').update(update).eq('id', storylineId);
  if (error) throw new Error(`Failed to revoke share token: ${error.message}`);
}
