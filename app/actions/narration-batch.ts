'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import { getPathToNode } from '@/lib/utils/story-map';
import { resolveNarrationVoiceServer } from '@/app/actions/narration';
import { generateAndPersistStoryNarrationWithOverlay } from '@/app/actions/story-narration';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { StoryConfig, StoryMap, StoryNode, StoryTextParts } from '@/lib/types/story';

// ---------------------------------------------------------------------------
// Server-side background narration. "Generate all narration" used to be a
// browser loop that died when the tab closed. This runs it as a background job
// (kicked immediately, resumed by the reconcile cron / on story reopen) so the
// user can leave and come back — audio streams onto the beats as each is made.
//
// Per-beat audio state lives on public.beats (audio_status/audio_url) exactly
// like the interactive path, so there is no items table — the job row tracks the
// ordered target list, the locked narrator voice, and aggregate progress.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

// Stop a worker invocation before the serverless request budget; remaining beats
// are picked up by a self re-kick and, as a backstop, the reconcile cron. Kept
// BELOW the platform's function-duration cap so the worker finishes its current
// beat and re-kicks before it gets killed. Default 20s suits Vercel Hobby (~60s
// cap → roughly one beat per invocation, always making progress); raise via
// WORKER_TIME_BUDGET_MS on Pro / Cloud Run (e.g. 240000) to do more per run.
const NARRATION_TIME_BUDGET_MS = Math.max(5_000, Number(process.env.WORKER_TIME_BUDGET_MS) || 20_000);

interface NarrationJobRow {
  id: string;
  user_id: string;
  story_id: string;
  scope: string;
  status: string;
  node_ids: string[] | null;
  voice_id: string | null;
  voice_mode: string | null;
  voice_gender_bucket: string | null;
  language_code: string | null;
  accent: string | null;
  item_count: number;
  succeeded_count: number;
  failed_count: number;
}

const NARRATION_JOB_SELECT =
  'id, user_id, story_id, scope, status, node_ids, voice_id, voice_mode, voice_gender_bucket, language_code, accent, item_count, succeeded_count, failed_count';

interface NarrationStoryRow {
  id: string;
  user_id: string;
  story_map: StoryMap | null;
  story_config: Partial<StoryConfig> | null;
  genre: string | null;
  tone: string | null;
  target_age: string | null;
}

export interface SubmitStoryNarrationBatchResult {
  jobId: string | null;
  itemCount: number;
  status: 'submitted' | 'noop';
  message: string;
}

function beatNeedsNarration(node: StoryNode): boolean {
  const beat = node.data;
  if (beat.audioUrl) return false;
  return Boolean(beat.storyText && beat.storyText.trim().length > 0);
}

function narrationBaseUrl(): string {
  const raw = process.env.APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return raw.replace(/\/$/, '');
}

/** Trigger the narration worker route. Internal (not a server action): in a
 *  'use server' module only non-exported helpers may be sync/return non-promises.
 *
 *  MUST be awaited by callers. Re-kicks fire from inside the worker route's
 *  `after()` block, and on Vercel serverless the function instance freezes the
 *  moment that callback resolves — an un-awaited fetch whose handshake hasn't
 *  completed is dropped, silently killing the self-chain. Awaiting keeps the
 *  instance alive until the route returns its (immediate) 202, guaranteeing the
 *  next invocation is actually accepted before this one is allowed to freeze. */
async function kickNarrationWorker(jobId: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  // The worker route accepts the job and returns 202 immediately (it runs the
  // generation loop via `after()`), so this await resolves fast. Bound it anyway
  // so a slow/unreachable route can never wedge the caller.
  await fetch(`${narrationBaseUrl()}/api/batch/generate-narration`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ jobId }),
    signal: AbortSignal.timeout(15_000),
    keepalive: true,
  }).catch((error) => console.error('Failed to kick narration worker:', error));
}

async function loadOwnedStory(admin: AdminClient, storyId: string, userId: string): Promise<NarrationStoryRow> {
  const { data, error } = await admin
    .from('stories')
    .select('id, user_id, story_map, story_config, genre, tone, target_age')
    .eq('id', storyId)
    .single();
  if (error || !data) throw new Error('Story not found.');
  if ((data as NarrationStoryRow).user_id !== userId) throw new Error('Forbidden.');
  return data as NarrationStoryRow;
}

/**
 * Submit a background narration job for a story's current root→current-node path.
 * Resolves + locks the narrator voice now (while we have the user's auth session)
 * so the worker reproduces it exactly, then kicks the worker and returns.
 */
export async function submitStoryNarrationBatch(input: {
  storyId: string;
}): Promise<SubmitStoryNarrationBatchResult> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const admin = createAdminClient();
  const story = await loadOwnedStory(admin, input.storyId, user.id);
  const map = story.story_map;
  if (!map || !map.nodes || !map.currentNodeId) throw new Error('Story has no beats to narrate.');

  const config = normalizeStoryConfig(story.story_config);
  const genre = story.genre || 'adventure';
  const tone = story.tone || 'playful';
  const targetAge = story.target_age || 'all_ages';

  // Narrate the current path, in beat order. Beats that already have audio are skipped.
  const targetNodes = getPathToNode(map, map.currentNodeId)
    .filter(beatNeedsNarration)
    .sort((a, b) => a.data.beatNumber - b.data.beatNumber);
  if (targetNodes.length === 0) {
    return { jobId: null, itemCount: 0, status: 'noop', message: 'All beats on this path already have narration.' };
  }

  // Lock the narrator voice now (mirrors the interactive resolveNarratorVoice).
  const voice = await resolveNarrationVoiceServer({
    savedStoryId: story.id,
    requestedMode: config.narrationVoice?.mode ?? null,
    requestedVoiceId: config.narrationVoice?.voiceId ?? null,
    requestedGenderBucket: config.narrationVoice?.genderBucket ?? null,
    requestedAccent: config.narrationVoice?.accent ?? null,
    language: config.language,
    genre,
    tone,
    targetAge,
  });

  const nodeIds = targetNodes.map((node) => node.id);
  const { data: jobRow, error: jobError } = await admin
    .from('narration_batch_jobs')
    .insert({
      user_id: user.id,
      story_id: story.id,
      scope: 'current_path',
      status: 'running',
      node_ids: nodeIds,
      voice_id: voice.voiceId,
      voice_mode: voice.mode,
      voice_gender_bucket: voice.genderBucket,
      language_code: voice.languageCode,
      accent: voice.accent,
      item_count: nodeIds.length,
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (jobError || !jobRow) throw new Error(`Failed to create narration job: ${jobError?.message}`);
  const jobId = jobRow.id as string;

  // Reflect pending state on the beats so the client shows "generating".
  await admin
    .from('beats')
    .update({ audio_status: 'pending', audio_error: null })
    .eq('story_id', story.id)
    .in('node_id', nodeIds);

  await kickNarrationWorker(jobId);

  return {
    jobId,
    itemCount: nodeIds.length,
    status: 'submitted',
    message: 'Narration is generating on our servers.',
  };
}

/**
 * Process one narration job's beats sequentially. Bounded by the time budget;
 * re-kicks itself if beats remain. Persists per-beat so the client's poll streams
 * audio in. Resilient: a single beat's failure marks that beat failed and continues.
 */
async function processNarrationJob(admin: AdminClient, job: NarrationJobRow): Promise<void> {
  const startedAt = Date.now();
  const nodeIds = Array.isArray(job.node_ids) ? job.node_ids : [];
  if (nodeIds.length === 0) {
    await admin.from('narration_batch_jobs')
      .update({ status: 'succeeded', completed_at: new Date().toISOString() })
      .eq('id', job.id);
    return;
  }

  const { data: storyRow } = await admin
    .from('stories')
    .select('story_map, story_config, genre, tone')
    .eq('id', job.story_id)
    .single();
  const map = storyRow?.story_map as StoryMap | undefined;
  if (!map || !map.nodes) return;
  const config = normalizeStoryConfig((storyRow?.story_config as Partial<StoryConfig> | null) ?? null);
  const genre = (storyRow?.genre as string | null) || 'adventure';
  const tone = (storyRow?.tone as string | null) || 'playful';

  if (!job.voice_id) {
    await admin.from('narration_batch_jobs')
      .update({ status: 'failed', error: 'No narrator voice was resolved for this job.', completed_at: new Date().toISOString() })
      .eq('id', job.id);
    return;
  }

  // Which beats already have audio (skip them — handles resume after a re-kick).
  const { data: beatRows } = await admin
    .from('beats')
    .select('node_id, audio_url, audio_status')
    .eq('story_id', job.story_id)
    .in('node_id', nodeIds);
  const audioByNode = new Map<string, { url: string | null; status: string | null }>();
  for (const row of (beatRows ?? []) as Array<{ node_id: string; audio_url: string | null; audio_status: string | null }>) {
    audioByNode.set(row.node_id, { url: row.audio_url, status: row.audio_status });
  }

  let interrupted = false;
  for (const nodeId of nodeIds) {
    const existing = audioByNode.get(nodeId);
    if (existing?.url) continue; // already narrated
    if (Date.now() - startedAt > NARRATION_TIME_BUDGET_MS) {
      interrupted = true;
      break;
    }
    const node = map.nodes[nodeId];
    const storyText = node?.data.storyText?.trim();
    if (!node || !storyText) continue;

    const costTelemetry: CostTelemetryContext = {
      activityKey: 'regenerate_narration',
      storyId: job.story_id,
      nodeId,
      beatNumber: node.data.beatNumber,
      metadata: { language: config.language, narrationBatch: true },
    };

    try {
      await generateAndPersistStoryNarrationWithOverlay(
        storyText,
        tone,
        genre,
        job.voice_id,
        job.language_code || config.language,
        job.story_id,
        nodeId,
        costTelemetry,
        {
          accent: job.accent,
          storyTextParts: node.data.storyTextParts as StoryTextParts | undefined,
          overlayConfig: config.storyTextOverlay,
          serverAuth: { userId: job.user_id },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Narration failed.';
      console.error(`[narration:batch] beat ${nodeId} failed:`, error instanceof Error ? error.stack ?? message : error);
      await admin.from('beats')
        .update({ audio_status: 'failed', audio_error: message })
        .eq('story_id', job.story_id)
        .eq('node_id', nodeId);
    }
  }

  // Recompute rollups from the source of truth (beats.audio_status).
  const { data: finalRows } = await admin
    .from('beats')
    .select('node_id, audio_url, audio_status')
    .eq('story_id', job.story_id)
    .in('node_id', nodeIds);
  const rows = (finalRows ?? []) as Array<{ node_id: string; audio_url: string | null; audio_status: string | null }>;
  const succeeded = rows.filter((r) => Boolean(r.audio_url)).length;
  const failed = rows.filter((r) => !r.audio_url && r.audio_status === 'failed').length;
  const remaining = nodeIds.length - succeeded - failed;

  if (remaining > 0 && interrupted) {
    // More work to do and we hit the budget — keep running and re-kick.
    await admin.from('narration_batch_jobs')
      .update({ status: 'running', succeeded_count: succeeded, failed_count: failed })
      .eq('id', job.id);
    await kickNarrationWorker(job.id);
    return;
  }

  const isComplete = remaining <= 0;
  await admin.from('narration_batch_jobs').update({
    succeeded_count: succeeded,
    failed_count: failed,
    ...(isComplete
      ? { status: failed > 0 ? 'partial' : 'succeeded', completed_at: new Date().toISOString() }
      : { status: 'running' }),
  }).eq('id', job.id);

  // Anything still pending (not interrupted, but a transient miss) — re-kick once.
  if (!isComplete) await kickNarrationWorker(job.id);
}

/** Entry point invoked by the worker route (POST /api/batch/generate-narration). */
export async function runNarrationJob(jobId: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('narration_batch_jobs')
    .select(NARRATION_JOB_SELECT)
    .eq('id', jobId)
    .single();
  if (error || !data) throw new Error(`Narration job ${jobId} not found: ${error?.message}`);
  const job = data as NarrationJobRow;
  if (job.status !== 'running' && job.status !== 'pending') return;
  await processNarrationJob(admin, job);
}

// Only a job whose heartbeat (updated_at, touched after every beat) has gone
// stale is treated as stalled and resumed — this keeps the reconcile backstop
// from double-processing a job that a kicked worker is actively running.
const NARRATION_STALE_MS = 3 * 60_000;

/** Resume a single story's stalled narration job (used on story reopen). */
export async function reconcileStoryNarration(storyId: string): Promise<void> {
  const admin = createAdminClient();
  const staleCutoff = new Date(Date.now() - NARRATION_STALE_MS).toISOString();
  const { data } = await admin
    .from('narration_batch_jobs')
    .select(NARRATION_JOB_SELECT)
    .eq('story_id', storyId)
    .in('status', ['pending', 'running'])
    .lt('updated_at', staleCutoff)
    .order('created_at', { ascending: false });
  for (const job of (data ?? []) as NarrationJobRow[]) {
    await processNarrationJob(admin, job).catch((err) =>
      console.error(`reconcileStoryNarration failed for job ${job.id}:`, err)
    );
  }
}

/** Scan all in-flight narration jobs (called by the reconcile cron backstop). */
export async function reconcileActiveNarrationJobs(limit = 10): Promise<{ processed: number }> {
  const admin = createAdminClient();
  const staleCutoff = new Date(Date.now() - NARRATION_STALE_MS).toISOString();
  const { data } = await admin
    .from('narration_batch_jobs')
    .select(NARRATION_JOB_SELECT)
    .in('status', ['pending', 'running'])
    .lt('updated_at', staleCutoff)
    .order('created_at', { ascending: true })
    .limit(limit);
  const jobs = (data ?? []) as NarrationJobRow[];
  for (const job of jobs) {
    await processNarrationJob(admin, job).catch((err) =>
      console.error(`reconcileActiveNarrationJobs failed for job ${job.id}:`, err)
    );
  }
  return { processed: jobs.length };
}
