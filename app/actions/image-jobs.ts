'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveEffectiveProcessingMode, getConfiguredProcessingMode, getMediaPipelineSettings } from '@/lib/media/processing-mode';
import { putR2Object } from '@/lib/media/r2-server';
import { signMixedUrls } from '@/lib/media/storage-url-signing';
import { getPricingRuntimeContext } from '@/app/actions/pricing-runtime';
import { getFeatureFlag } from '@/lib/ai/model-config';
import type { ReferenceImage } from '@/app/actions/story-runtime';
import type {
  BeatImageJobReference,
  BeatImageJobRequestPayload,
  ImageGenerationJobKind,
  ImageGenerationJobStatus,
  StoryImageJobStatus,
} from '@/lib/types/image-jobs';

export type EnqueueBeatImageJobResult =
  /** Job created; the reservation now belongs to the worker. */
  | { status: 'queued'; jobId: string }
  /** Admin flipped the mode between the client's check and the enqueue call —
   *  caller should continue on the legacy path (its reservation stays valid). */
  | { status: 'legacy_mode' }
  /** An active job already exists for this beat — no duplicate created.
   *  Caller should release its reservation. */
  | { status: 'duplicate' }
  /** Nothing was created. Caller should release its reservation. */
  | { status: 'error'; message: string };

export interface EnqueueBeatImageJobInput {
  storyId: string;
  nodeId: string;
  kind: ImageGenerationJobKind;
  beatNumber?: number;
  /** Hard reservation made by the caller before prep (legacy billing order).
   *  On 'queued' the worker takes over finalize/release. */
  reservationId: string | null;
  /** Raw generateImage() args; data-URL references are staged out to R2 here. */
  payload: Omit<BeatImageJobRequestPayload, 'references'> & { references: ReferenceImage[] };
}

/** Thin wrapper so the client store can route before doing any billing work. */
export async function resolveImageProcessingModeAction(): Promise<'client_legacy' | 'server_pipeline'> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return resolveEffectiveProcessingMode(user?.id ?? null);
}

function splitDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  return 'webp';
}

export async function enqueueBeatImageJob(input: EnqueueBeatImageJobInput): Promise<EnqueueBeatImageJobResult> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { status: 'error', message: 'Not authenticated' };

  // Re-resolve server-side: the admin may have flipped the mode since the
  // client checked, and the client's answer is never trusted.
  const effectiveMode = await resolveEffectiveProcessingMode(user.id);
  if (effectiveMode !== 'server_pipeline') return { status: 'legacy_mode' };
  const requestedMode = await getConfiguredProcessingMode();

  // Pack 1 flag enforcement: user-driven regenerations are rejected when the
  // feature is disabled, and panel suggestions are stripped when their flag
  // is off. UI gating alone is never trusted.
  if (input.payload.regeneration) {
    if (!(await getFeatureFlag('beat_image_regen_enabled', false))) {
      return { status: 'error', message: 'Image regeneration is currently disabled.' };
    }
    if (
      input.payload.regeneration.panelSuggestions &&
      !(await getFeatureFlag('beat_panel_suggestions_enabled', false))
    ) {
      input.payload.regeneration = { ...input.payload.regeneration, panelSuggestions: undefined };
    }
  }

  const admin = createAdminClient();
  const { data: story, error: storyError } = await admin
    .from('stories')
    .select('id, user_id')
    .eq('id', input.storyId)
    .single();
  if (storyError || !story) return { status: 'error', message: 'Story not found.' };
  if (story.user_id !== user.id) return { status: 'error', message: 'Forbidden.' };

  // Refuse duplicates up-front (the partial unique index below is authoritative;
  // this just avoids staging references for a doomed insert).
  const { data: activeJob } = await admin
    .from('image_generation_jobs')
    .select('id')
    .eq('story_id', input.storyId)
    .eq('node_id', input.nodeId)
    .in('status', ['pending', 'processing'])
    .maybeSingle();
  if (activeJob) return { status: 'duplicate' };

  const jobId = crypto.randomUUID();

  try {
    // Stage inline base64 references privately so job rows stay small and the
    // worker can replay retries deterministically.
    const references: BeatImageJobReference[] = [];
    const referenceKeys: string[] = [];
    const maxAttempts = (await getMediaPipelineSettings()).maxAttempts;
    for (let i = 0; i < input.payload.references.length; i += 1) {
      const ref = input.payload.references[i];
      if (ref.dataUrl?.startsWith('data:')) {
        const parsed = splitDataUrl(ref.dataUrl);
        if (!parsed) continue;
        const objectKey = `media-jobs/${jobId}/refs/${i}.${extensionForMime(parsed.mimeType)}`;
        const stored = await putR2Object({
          access: 'private',
          objectKey,
          body: parsed.buffer,
          contentType: parsed.mimeType,
        });
        references.push({ type: ref.type, r2Reference: stored.urlOrReference });
        referenceKeys.push(stored.urlOrReference);
      } else if (ref.url || ref.dataUrl) {
        references.push({ type: ref.type, url: ref.url ?? ref.dataUrl });
      }
    }

    // Snapshot the owner's plan so the cookieless worker resolves tier-gated
    // models and retention exactly as the interactive request would have.
    const planKey = await getPricingRuntimeContext()
      .then((pricing) => pricing.snapshot.planKey)
      .catch(() => 'free' as const);

    const payload: BeatImageJobRequestPayload = {
      ...input.payload,
      references,
      currentPlanKey: planKey,
    };

    const { error: insertError } = await admin
      .from('image_generation_jobs')
      .insert({
        id: jobId,
        user_id: user.id,
        story_id: input.storyId,
        node_id: input.nodeId,
        kind: input.kind,
        status: 'pending',
        processing_mode: 'server_pipeline',
        requested_mode: requestedMode,
        request_payload_json: payload,
        reference_keys: referenceKeys,
        reservation_id: input.reservationId,
        max_attempts: maxAttempts,
      });
    if (insertError) {
      // 23505 = unique violation on the active-node index (double-click race).
      if (insertError.code === '23505') return { status: 'duplicate' };
      return { status: 'error', message: `Failed to create generation job: ${insertError.message}` };
    }

    // Durable queued state: written server-side so a tab closed immediately
    // after this action returns still shows the correct status on reopen.
    await admin
      .from('beats')
      .update({ image_status: 'pending', image_error: null })
      .eq('story_id', input.storyId)
      .eq('node_id', input.nodeId);

    await kickImageJobWorker(jobId);

    return { status: 'queued', jobId };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to start image generation.',
    };
  }
}

function jobStatusToBeatImageStatus(status: ImageGenerationJobStatus): StoryImageJobStatus['beatImageStatus'] {
  if (status === 'ready') return 'ready';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'pending';
}

/**
 * Owner-scoped polling snapshot: all active jobs for the story plus anything
 * that finished in the last 15 minutes so the client catches transitions.
 */
export async function getStoryImageJobStatuses(storyId: string): Promise<StoryImageJobStatus[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const recentCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  // Cookie client: the owner-SELECT RLS policy scopes rows to this user.
  const { data, error } = await supabase
    .from('image_generation_jobs')
    .select('id, node_id, status, error, updated_at, created_at')
    .eq('story_id', storyId)
    .or(`status.in.(pending,processing),updated_at.gte.${recentCutoff}`)
    .order('created_at', { ascending: false });
  if (error || !data) return [];

  // Newest job per node wins.
  const byNode = new Map<string, StoryImageJobStatus>();
  for (const row of data) {
    if (byNode.has(row.node_id)) continue;
    byNode.set(row.node_id, {
      jobId: row.id,
      nodeId: row.node_id,
      status: row.status as ImageGenerationJobStatus,
      beatImageStatus: jobStatusToBeatImageStatus(row.status as ImageGenerationJobStatus),
      error: row.error,
      updatedAt: row.updated_at,
    });
  }
  return Array.from(byNode.values());
}

/**
 * Story-reopen backstop: reclaim this story's stale claims and kick the
 * worker for any pending jobs so an interrupted generation resumes without
 * waiting for the cron. Returns the number of in-flight jobs so the client
 * knows whether to poll.
 */
export async function reconcileStoryImageJobs(storyId: string): Promise<{ inFlight: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { inFlight: 0 };

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await admin
    .from('image_generation_jobs')
    .update({ status: 'pending' })
    .eq('story_id', storyId)
    .eq('user_id', user.id)
    .eq('status', 'processing')
    .lt('claimed_at', cutoff);

  const { count } = await admin
    .from('image_generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('story_id', storyId)
    .eq('user_id', user.id)
    .in('status', ['pending', 'processing']);
  const inFlight = count ?? 0;

  if (inFlight > 0) {
    await kickImageJobWorker(null);
  }
  return { inFlight };
}

export interface ReadyBeatImage {
  nodeId: string;
  imageUrl: string | null;
  imageStatus: string | null;
  imageError: string | null;
}

/**
 * Fetch (and sign) the persisted beat image URLs for specific nodes — used by
 * the client poller to merge worker-completed images into the live session.
 */
export async function getReadyBeatImages(storyId: string, nodeIds: string[]): Promise<ReadyBeatImage[]> {
  if (nodeIds.length === 0) return [];
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const admin = createAdminClient();
  const { data: story } = await admin
    .from('stories')
    .select('id, user_id')
    .eq('id', storyId)
    .single();
  if (!story || story.user_id !== user.id) return [];

  const { data: beats, error } = await admin
    .from('beats')
    .select('node_id, image_url, image_status, image_error')
    .eq('story_id', storyId)
    .in('node_id', nodeIds);
  if (error || !beats) return [];

  const urls = beats.map((beat) => beat.image_url).filter((url): url is string => Boolean(url));
  const signed = await signMixedUrls(supabase, urls, 'story-assets', 3600);

  return beats.map((beat) => ({
    nodeId: beat.node_id,
    imageUrl: beat.image_url ? (signed.get(beat.image_url) ?? beat.image_url) : null,
    imageStatus: beat.image_status,
    imageError: beat.image_error,
  }));
}

function mediaJobsBaseUrl(): string {
  const raw = process.env.APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return raw.replace(/\/$/, '');
}

/** Trigger the image-job worker route. Internal (not a server action).
 *
 *  MUST be awaited by callers — same rationale as kickStatefulWorker in
 *  image-batch.ts: on Vercel an un-awaited fetch fired from a finishing
 *  invocation gets dropped, which would strand pending jobs until the
 *  reconcile backstop. */
async function kickImageJobWorker(jobId: string | null): Promise<void> {
  const secret = process.env.CRON_SECRET;
  await fetch(`${mediaJobsBaseUrl()}/api/media/jobs/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ jobId }),
    signal: AbortSignal.timeout(15_000),
    keepalive: true,
  }).catch((error) => console.error('Failed to kick image job worker:', error));
}
