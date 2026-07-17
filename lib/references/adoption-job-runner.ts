import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { generateSelectedImage } from '@/app/actions/image-generation';
import { finalizeBillableAction, releaseBillableAction } from '@/lib/pricing/enforcement';
import { getR2ObjectBuffer, putR2Object } from '@/lib/media/r2-server';
import { toR2Reference, parseR2Reference } from '@/lib/media/r2-reference';
import { compressImageDataUrlServer } from '@/lib/media/serverImageCompression';
import { analyzeCharacterReference, analyzeWorldReference } from '@/lib/ai/reference-analysis';
import {
  buildCanonicalCharacterAdoptionPrompt,
  buildCanonicalWorldAdoptionPrompt,
  compileCharacterAnchor,
  compileWorldAnchor,
} from '@/lib/ai/reference-adoption-prompts';
import { getReferenceSettings } from '@/lib/references/reference-runtime';
import { buildCanonicalReferenceKey } from '@/lib/references/reference-storage';
import type { InlineImagePart } from '@/app/actions/gemini-proxy';
import type { ImageModelSelection } from '@/lib/ai/image-models.shared';
import type { PlanKey } from '@/lib/types/pricing';
import type {
  CharacterReferenceDescription,
  DbReferenceAdoption,
  DbReferenceSource,
  WorldReferenceDescription,
} from '@/lib/types/references';

type AdminClient = ReturnType<typeof createAdminClient>;

const JOB_TIME_BUDGET_MS = Math.max(5_000, Number(process.env.WORKER_TIME_BUDGET_MS) || 20_000);

/** Snapshot of the locked style/model stored on the adoption row at enqueue. */
interface AdoptionModelSnapshot {
  selection: ImageModelSelection | null;
  planKey: PlanKey;
}

function baseUrl(): string {
  const raw =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return raw.replace(/\/$/, '');
}

async function rekickWorker(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  await fetch(`${baseUrl()}/api/reference/jobs/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15_000),
    keepalive: true,
  }).catch((error) => console.error('Failed to re-kick reference adoption worker:', error));
}

export async function reclaimStaleAdoptionJobs(admin: AdminClient): Promise<number> {
  const settings = await getReferenceSettings();
  const cutoff = new Date(Date.now() - settings.staleReclaimMinutes * 60 * 1000).toISOString();
  const { data } = await admin
    .from('reference_adoptions')
    .update({ status: 'pending' })
    .eq('status', 'processing')
    .lt('claimed_at', cutoff)
    .select('id');
  return data?.length ?? 0;
}

async function claimJob(admin: AdminClient, jobId: string, attemptCount: number): Promise<boolean> {
  const { data } = await admin
    .from('reference_adoptions')
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

async function settleReservation(
  reservationId: string | null,
  userId: string,
  outcome: 'finalize' | 'release',
  reason: string,
  metadata: Record<string, unknown>
): Promise<void> {
  if (!reservationId) return;
  if (outcome === 'finalize') {
    await finalizeBillableAction({ userId, reservationId, metadata }).catch((error) =>
      console.error('Adoption reservation finalize failed:', error)
    );
  } else {
    await releaseBillableAction({ userId, reservationId, reason }).catch(() => {});
  }
}

/** Settle both reservations (analysis + optional visualization) on the outcome. */
async function settleAllReservations(
  job: DbReferenceAdoption,
  outcome: 'finalize' | 'release',
  reason: string
): Promise<void> {
  await settleReservation(job.reservation_id, job.user_id, outcome, reason, {
    action: 'reference_adoption',
    adoptionId: job.id,
    kind: job.kind,
  });
  await settleReservation(job.visualization_reservation_id, job.user_id, outcome, reason, {
    action: 'reference_world_visualization',
    adoptionId: job.id,
  });
}

async function markFailed(admin: AdminClient, job: DbReferenceAdoption, message: string): Promise<void> {
  await admin
    .from('reference_adoptions')
    .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
    .eq('id', job.id);
  await settleAllReservations(job, 'release', 'reference_adoption_failed');
}

async function retryOrFail(admin: AdminClient, job: DbReferenceAdoption, message: string): Promise<void> {
  if (job.attempt_count < job.max_attempts) {
    await admin
      .from('reference_adoptions')
      .update({ status: 'pending', error: message })
      .eq('id', job.id)
      .eq('status', 'processing');
    return;
  }
  await markFailed(admin, job, message);
}

async function loadSourcePart(
  source: DbReferenceSource
): Promise<InlineImagePart | null> {
  const object = await getR2ObjectBuffer(toR2Reference(source.r2_bucket, source.r2_object_key)).catch(() => null);
  if (!object) return null;
  return { mimeType: object.contentType ?? 'image/webp', data: object.buffer.toString('base64') };
}

async function persistCanonical(
  job: DbReferenceAdoption,
  dataUrl: string
): Promise<string> {
  const compressed = await compressImageDataUrlServer({ dataUrl, assetType: 'character_reference' });
  const objectKey = buildCanonicalReferenceKey({
    userId: job.user_id,
    setupId: job.setup_id,
    adoptionId: job.id,
  });
  const stored = await putR2Object({
    access: 'private',
    objectKey,
    body: compressed.buffer,
    contentType: 'image/webp',
    cacheControl: 'private, max-age=0, no-store',
  });
  return toR2Reference(stored.bucket, objectKey);
}

async function generateCanonical(
  job: DbReferenceAdoption,
  prompt: string,
  sourcePart: InlineImagePart,
  task: 'portrait_generation' | 'image_generation'
): Promise<string> {
  const snapshot = (job.image_model_snapshot ?? {}) as Partial<AdoptionModelSnapshot>;
  const result = await generateSelectedImage({
    task,
    prompt,
    referenceParts: [sourcePart],
    selection: snapshot.selection ?? null,
    currentPlanKey: snapshot.planKey ?? 'free',
  });
  if (!result.dataUrl) {
    throw new Error(result.fallbackText || 'Provider returned no image.');
  }
  return result.dataUrl;
}

async function processCharacter(
  admin: AdminClient,
  job: DbReferenceAdoption,
  sourcePart: InlineImagePart
): Promise<void> {
  const description = await analyzeCharacterReference({ referencePart: sourcePart });
  if (description.unusableReason) {
    await admin
      .from('reference_adoptions')
      .update({
        status: 'failed',
        error: description.unusableReason,
        structured_json: description,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    await settleAllReservations(job, 'release', 'reference_subject_unclear');
    return;
  }

  const anchor = compileCharacterAnchor(description);
  const prompt = buildCanonicalCharacterAdoptionPrompt({
    description,
    visualStyle: job.visual_style ?? '',
    displayName: job.display_name,
  });
  const dataUrl = await generateCanonical(job, prompt, sourcePart, 'portrait_generation');
  const canonicalRef = await persistCanonical(job, dataUrl);

  await finalizeReady(admin, job, {
    structured: description,
    anchor,
    canonicalRef,
  });
}

async function processWorld(
  admin: AdminClient,
  job: DbReferenceAdoption,
  sourcePart: InlineImagePart
): Promise<void> {
  const settings = await getReferenceSettings();
  const description = await analyzeWorldReference({ referencePart: sourcePart });
  if (description.unusableReason) {
    await admin
      .from('reference_adoptions')
      .update({
        status: 'failed',
        error: description.unusableReason,
        structured_json: description,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    await settleAllReservations(job, 'release', 'reference_world_unclear');
    return;
  }

  const anchor = compileWorldAnchor(description);
  const wantsVisual =
    job.adoption_mode === 'description_plus_canonical_visual' && settings.worldVisualizationEnabled;

  let canonicalRef: string | null = null;
  if (wantsVisual) {
    try {
      const prompt = buildCanonicalWorldAdoptionPrompt({
        description,
        visualStyle: job.visual_style ?? '',
        displayName: job.display_name,
      });
      const dataUrl = await generateCanonical(job, prompt, sourcePart, 'image_generation');
      canonicalRef = await persistCanonical(job, dataUrl);
    } catch (error) {
      // Visualization failed. If fallback is enabled, degrade to description-only:
      // release ONLY the visualization reservation and finish ready. Otherwise
      // rethrow so the whole job retries/fails.
      if (!settings.descriptionOnlyFallbackEnabled) throw error;
      await settleReservation(
        job.visualization_reservation_id,
        job.user_id,
        'release',
        'reference_world_visualization_failed',
        { action: 'reference_world_visualization', adoptionId: job.id }
      );
      await admin
        .from('reference_adoptions')
        .update({ adoption_mode: 'description_only', visualization_reservation_id: null })
        .eq('id', job.id);
      job.visualization_reservation_id = null;
    }
  }

  await finalizeReady(admin, job, { structured: description, anchor, canonicalRef });
}

async function finalizeReady(
  admin: AdminClient,
  job: DbReferenceAdoption,
  input: {
    structured: CharacterReferenceDescription | WorldReferenceDescription;
    anchor: string;
    canonicalRef: string | null;
  }
): Promise<void> {
  const canonical = input.canonicalRef ? parseR2Reference(input.canonicalRef) : null;
  await admin
    .from('reference_adoptions')
    .update({
      status: 'ready',
      structured_json: input.structured,
      prompt_anchor: input.anchor,
      canonical_r2_bucket: canonical?.bucket ?? null,
      canonical_r2_object_key: canonical?.objectKey ?? null,
      error: null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', job.id);
  await settleAllReservations(job, 'finalize', 'reference_adoption_ready');
}

async function processJob(admin: AdminClient, job: DbReferenceAdoption): Promise<void> {
  // Load the source; a removed/expired source fails the job permanently.
  const { data: sourceRow } = await admin
    .from('reference_sources')
    .select('*')
    .eq('id', job.source_id)
    .maybeSingle();
  const source = sourceRow as DbReferenceSource | null;
  if (!source || source.status === 'removed') {
    await markFailed(admin, job, 'This upload is no longer available.');
    return;
  }

  const sourcePart = await loadSourcePart(source);
  if (!sourcePart) {
    await retryOrFail(admin, job, 'Could not read the uploaded image.');
    return;
  }

  if (job.kind === 'character') {
    await processCharacter(admin, job, sourcePart);
  } else {
    await processWorld(admin, job, sourcePart);
  }
}

export interface AdoptionRunResult {
  processed: number;
  failed: number;
  remaining: number;
}

/** Drain pending adoption jobs within a time budget, self re-kicking if work
 *  remains. Mirrors runImageGenerationJobs. */
export async function runReferenceAdoptionJobs(input: { jobId?: string } = {}): Promise<AdoptionRunResult> {
  const admin = createAdminClient();
  const deadline = Date.now() + JOB_TIME_BUDGET_MS;
  let processed = 0;
  let failed = 0;

  await reclaimStaleAdoptionJobs(admin).catch(() => 0);

  async function claimNext(): Promise<DbReferenceAdoption | null> {
    let query = admin
      .from('reference_adoptions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);
    if (input.jobId) query = query.eq('id', input.jobId);
    const { data } = await query;
    return ((data?.[0] as DbReferenceAdoption | undefined) ?? null);
  }

  while (Date.now() < deadline) {
    const job = await claimNext();
    if (!job) break;
    const claimed = await claimJob(admin, job.id, job.attempt_count);
    if (!claimed) continue; // another worker won it
    const claimedJob: DbReferenceAdoption = { ...job, attempt_count: job.attempt_count + 1 };
    try {
      await processJob(admin, claimedJob);
      const { data: after } = await admin
        .from('reference_adoptions')
        .select('status')
        .eq('id', claimedJob.id)
        .maybeSingle();
      if (after?.status === 'failed') failed += 1;
      else processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Adoption failed.';
      await retryOrFail(admin, claimedJob, message);
    }
    if (input.jobId) break;
  }

  const { count } = await admin
    .from('reference_adoptions')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'processing']);
  const remaining = count ?? 0;
  if (remaining > 0 && !input.jobId) await rekickWorker();

  return { processed, failed, remaining };
}
