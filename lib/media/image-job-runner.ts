import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { generateSelectedImage } from '@/app/actions/image-generation';
import type { InlineImagePart } from '@/app/actions/gemini-proxy';
import { finalizeBillableAction, releaseBillableAction } from '@/lib/pricing/enforcement';
import { deleteR2Object, getR2ObjectBuffer, r2ObjectExists } from '@/lib/media/r2-server';
import { parseR2Reference } from '@/lib/media/r2-reference';
import { processAndStoreImageVariants, R2PipelineUnavailableError } from '@/lib/media/variant-pipeline';
import type { BeatImageJobRequestPayload, ImageGenerationJobRow } from '@/lib/types/image-jobs';
import type { StoryMap } from '@/lib/types/story';

type AdminClient = ReturnType<typeof createAdminClient>;

// Same budget contract as the stateful bulk worker: stop before the
// serverless duration cap and re-kick for whatever is left.
const JOB_TIME_BUDGET_MS = Math.max(5_000, Number(process.env.WORKER_TIME_BUDGET_MS) || 20_000);
const STALE_CLAIM_MINUTES = 5;

const FRIENDLY_FAILURE = 'Image generation failed. Please try again.';

function baseUrl(): string {
  const raw = process.env.APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return raw.replace(/\/$/, '');
}

/** Re-kick the worker route for remaining jobs. MUST be awaited (see
 *  kickStatefulWorker in image-batch.ts for the Vercel freeze rationale). */
async function rekickWorker(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  await fetch(`${baseUrl()}/api/media/jobs/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15_000),
    keepalive: true,
  }).catch((error) => console.error('Failed to re-kick image job worker:', error));
}

/** Reclaim jobs whose worker died mid-run so they become claimable again. */
export async function reclaimStaleImageJobs(admin: AdminClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60 * 1000).toISOString();
  const { data } = await admin
    .from('image_generation_jobs')
    .update({ status: 'pending' })
    .eq('status', 'processing')
    .lt('claimed_at', cutoff)
    .select('id');
  return data?.length ?? 0;
}

async function loadJob(admin: AdminClient, jobId: string): Promise<ImageGenerationJobRow | null> {
  const { data } = await admin
    .from('image_generation_jobs')
    .select('*')
    .eq('id', jobId)
    .single();
  return (data as ImageGenerationJobRow | null) ?? null;
}

/** Atomic claim: only one worker wins the pending→processing transition. */
async function claimJob(admin: AdminClient, jobId: string, attemptCount: number): Promise<boolean> {
  const { data } = await admin
    .from('image_generation_jobs')
    .update({
      status: 'processing',
      claimed_at: new Date().toISOString(),
      attempt_count: attemptCount + 1,
    })
    .eq('id', jobId)
    .eq('status', 'pending')
    .select('id');
  return Boolean(data && data.length > 0);
}

/** Resolve staged r2:// references and plain URLs into the inline image
 *  parts the provider call expects. Unfetchable refs (e.g. a signed URL that
 *  expired before a late retry) are dropped gracefully — same degradation the
 *  interactive runtime applies. */
async function resolveJobReferenceParts(payload: BeatImageJobRequestPayload): Promise<InlineImagePart[]> {
  const parts: InlineImagePart[] = [];
  for (const ref of payload.references ?? []) {
    if (ref.r2Reference) {
      const object = await getR2ObjectBuffer(ref.r2Reference).catch(() => null);
      if (object) {
        parts.push({ mimeType: object.contentType ?? 'image/webp', data: object.buffer.toString('base64') });
      }
    } else if (ref.url) {
      try {
        const response = await fetch(ref.url);
        if (!response.ok) continue;
        const arrayBuffer = await response.arrayBuffer();
        parts.push({
          mimeType: response.headers.get('content-type') ?? 'image/webp',
          data: Buffer.from(arrayBuffer).toString('base64'),
        });
      } catch {
        // Dropped reference — generation proceeds without it.
      }
    }
  }
  return parts;
}

/** Delete the staged reference objects once a job reaches a terminal state. */
async function cleanupJobReferences(job: ImageGenerationJobRow): Promise<void> {
  for (const reference of job.reference_keys ?? []) {
    await deleteR2Object(reference).catch(() => {});
  }
}

async function settleReservation(
  admin: AdminClient,
  job: ImageGenerationJobRow,
  outcome: 'finalize' | 'release',
  reason: string
): Promise<void> {
  if (!job.reservation_id) return;
  if (outcome === 'finalize') {
    await finalizeBillableAction({
      userId: job.user_id,
      reservationId: job.reservation_id,
      storyId: job.story_id,
      relatedEntityId: job.node_id,
      metadata: { action: 'image_generation_job', jobId: job.id, nodeId: job.node_id },
    }).catch((error) => console.error('Image job reservation finalize failed:', error));
  } else {
    await releaseBillableAction({
      userId: job.user_id,
      reservationId: job.reservation_id,
      reason,
    }).catch(() => {});
  }
}

async function markJobFailed(admin: AdminClient, job: ImageGenerationJobRow, message: string): Promise<void> {
  await admin
    .from('image_generation_jobs')
    .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
    .eq('id', job.id);
  await admin
    .from('beats')
    .update({ image_status: 'failed', image_error: FRIENDLY_FAILURE })
    .eq('story_id', job.story_id)
    .eq('node_id', job.node_id);
  await settleReservation(admin, job, 'release', 'image_job_failed');
  await cleanupJobReferences(job);
}

/** Return the job to pending for another attempt, or fail it terminally when
 *  attempts are exhausted. Callers pass jobs whose attempt_count already
 *  includes the current attempt (incremented at claim time). */
async function retryOrFail(admin: AdminClient, job: ImageGenerationJobRow, message: string): Promise<void> {
  if (job.attempt_count < job.max_attempts) {
    await admin
      .from('image_generation_jobs')
      .update({ status: 'pending', error: message })
      .eq('id', job.id)
      .eq('status', 'processing');
    return;
  }
  await markJobFailed(admin, job, message);
}

/** Patch the story_map node after the beats row (beats are the source of
 *  truth; the map patch makes the client's next poll/load render immediately).
 *  Mirrors applyReadyImagesToStoryMap in image-batch.ts, plus generation
 *  metadata so continuity chains keep working for child beats. */
async function applyReadyImageToStoryMap(
  admin: AdminClient,
  storyId: string,
  nodeId: string,
  displayReference: string,
  finalPromptText: string | undefined,
  generationMetadata: Record<string, unknown> | undefined
): Promise<void> {
  const { data, error } = await admin.from('stories').select('story_map').eq('id', storyId).single();
  if (error || !data?.story_map) return;
  const map = data.story_map as StoryMap;
  const node = map.nodes[nodeId];
  if (!node) return;
  node.data = {
    ...node.data,
    imageUrl: displayReference,
    imageStatus: 'ready',
    imageError: undefined,
    ...(finalPromptText ? { finalImagePromptText: finalPromptText } : {}),
    ...(generationMetadata
      ? {
          imageGenerationMetadata: {
            ...(node.data.imageGenerationMetadata ?? {}),
            ...generationMetadata,
          },
        }
      : {}),
  };
  await admin.from('stories').update({ story_map: map }).eq('id', storyId);
}

/** Idempotency resume: if a previous attempt already stored the original for
 *  this job's media group, return its bytes instead of re-calling the
 *  provider (no double provider cost, deterministic variants). */
async function loadExistingOriginal(
  admin: AdminClient,
  job: ImageGenerationJobRow
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (!job.media_group_id) return null;
  const { data } = await admin
    .from('media_assets')
    .select('bucket, object_key, mime_type')
    .eq('media_group_id', job.media_group_id)
    .eq('variant', 'original')
    .maybeSingle();
  if (!data) return null;
  const reference = `r2://${data.bucket}/${data.object_key}`;
  if (!parseR2Reference(reference)) return null;
  const exists = await r2ObjectExists({ bucket: data.bucket, objectKey: data.object_key });
  if (!exists) return null;
  const object = await getR2ObjectBuffer(reference);
  if (!object) return null;
  return { buffer: object.buffer, mimeType: data.mime_type ?? object.contentType ?? 'image/png' };
}

async function processJob(admin: AdminClient, job: ImageGenerationJobRow): Promise<void> {
  const payload = job.request_payload_json;
  const planKey = payload.currentPlanKey ?? 'free';

  // Persist the media group BEFORE any uploads so a retry after a partial
  // failure resumes the same deterministic object keys.
  let mediaGroupId = job.media_group_id;
  if (!mediaGroupId) {
    mediaGroupId = crypto.randomUUID();
    await admin.from('image_generation_jobs').update({ media_group_id: mediaGroupId }).eq('id', job.id);
  }

  const existingOriginal = await loadExistingOriginal(admin, { ...job, media_group_id: mediaGroupId });

  let generationDataUrl: string | null = null;
  let finalPromptText: string | undefined;
  let generationMetadata: Record<string, unknown> | undefined;

  if (!existingOriginal) {
    // Same server entry point the interactive request and bulk workers use;
    // the final prompt was built client-side at enqueue time.
    const referenceParts = await resolveJobReferenceParts(payload);
    const result = await generateSelectedImage({
      task: payload.imageTask,
      prompt: payload.finalPrompt,
      referenceParts: referenceParts.length > 0 ? referenceParts : undefined,
      aspectRatio: payload.aspectRatio,
      imageSize: payload.imageSize,
      telemetry: payload.costTelemetry,
      selection: payload.imageModelSelection ?? null,
      currentPlanKey: planKey,
      continuity: payload.imageContinuity ?? null,
    });

    if (!result.dataUrl) {
      await retryOrFail(admin, job, result.fallbackText ?? 'Provider returned no image.');
      return;
    }
    generationDataUrl = result.dataUrl;
    finalPromptText = payload.finalPrompt;
    generationMetadata = {
      ...(result.metadata ?? {}),
      ...(result.modelSnapshot ? { imageModelSnapshot: result.modelSnapshot } : {}),
      processingMode: 'server_pipeline',
      jobId: job.id,
    };
  }

  const variants = await processAndStoreImageVariants({
    ...(existingOriginal
      ? { buffer: existingOriginal.buffer, mimeType: existingOriginal.mimeType }
      : { dataUrl: generationDataUrl! }),
    userId: job.user_id,
    storyId: job.story_id,
    nodeId: job.node_id,
    assetType: 'beat_image',
    processingMode: 'server_pipeline',
    planKey,
    sourceJobId: job.id,
    mediaGroupId,
  });

  // Beats table first (durable source of truth), story_map second.
  await admin
    .from('beats')
    .update({
      image_url: variants.displayReference,
      image_status: 'ready',
      image_error: null,
      image_synced_at: new Date().toISOString(),
    })
    .eq('story_id', job.story_id)
    .eq('node_id', job.node_id);

  await applyReadyImageToStoryMap(
    admin,
    job.story_id,
    job.node_id,
    variants.displayReference,
    finalPromptText,
    generationMetadata
  );

  // Terminal transition guarded on status so a concurrent duplicate run can
  // never double-finalize the reservation.
  const { data: completed } = await admin
    .from('image_generation_jobs')
    .update({ status: 'ready', error: null, completed_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'processing')
    .select('id');
  if (completed && completed.length > 0) {
    await settleReservation(admin, job, 'finalize', 'image_job_ready');
    await cleanupJobReferences(job);
  }
}

export interface RunImageJobsResult {
  processed: number;
  failed: number;
  remaining: number;
}

/**
 * Claim-and-process loop for interactive image generation jobs. Runs inside
 * the worker route's after() with a time budget; re-kicks itself when jobs
 * remain. Safe to run concurrently — claims are atomic.
 */
export async function runImageGenerationJobs(options: { jobId?: string | null } = {}): Promise<RunImageJobsResult> {
  const admin = createAdminClient();
  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;

  await reclaimStaleImageJobs(admin).catch(() => 0);

  while (Date.now() - startedAt < JOB_TIME_BUDGET_MS) {
    // Targeted job first (direct kick), then oldest pending work.
    let candidate: ImageGenerationJobRow | null = null;
    if (options.jobId && processed === 0 && failed === 0) {
      const targeted = await loadJob(admin, options.jobId);
      if (targeted && targeted.status === 'pending') candidate = targeted;
    }
    if (!candidate) {
      const { data } = await admin
        .from('image_generation_jobs')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      candidate = (data as ImageGenerationJobRow | null) ?? null;
    }
    if (!candidate) break;

    const claimed = await claimJob(admin, candidate.id, candidate.attempt_count);
    if (!claimed) continue;
    const job = { ...candidate, attempt_count: candidate.attempt_count + 1, status: 'processing' as const };

    try {
      await processJob(admin, job);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image job failed.';
      console.error(`Image generation job ${job.id} failed:`, error instanceof Error ? error.stack ?? message : error);
      if (error instanceof R2PipelineUnavailableError) {
        // Storage got turned off mid-flight: fail fast and refund — retrying
        // cannot succeed until an admin re-enables R2, and the user can
        // regenerate via the legacy path meanwhile.
        await markJobFailed(admin, job, message);
        failed += 1;
      } else {
        await retryOrFail(admin, job, message.slice(0, 500));
        if (job.attempt_count >= job.max_attempts) failed += 1;
      }
    }
  }

  const { count } = await admin
    .from('image_generation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  const remaining = count ?? 0;

  if (remaining > 0) {
    await rekickWorker();
  }

  return { processed, failed, remaining };
}
