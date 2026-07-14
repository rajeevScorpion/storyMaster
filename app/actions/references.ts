'use server';

import 'server-only';

import sharp from 'sharp';
import { randomUUID } from 'node:crypto';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getServerPipelineAvailability } from '@/lib/media/processing-mode';
import { putR2Object, createR2SignedGetUrl, deleteR2Object } from '@/lib/media/r2-server';
import { toR2Reference } from '@/lib/media/r2-reference';
import { getReferenceRuntimeContext } from '@/lib/references/reference-runtime';
import {
  buildReferenceSourceKey,
  decodeReferenceUpload,
  isReferenceKind,
} from '@/lib/references/reference-storage';
import { ReferenceError } from '@/lib/references/reference-errors';
import { authorizeBillableAction, releaseBillableAction } from '@/lib/pricing/enforcement';
import type { ImageModelSelection } from '@/lib/ai/image-models.shared';
import type { PricingActionKey } from '@/lib/types/pricing';
import type {
  DbReferenceSource,
  DbReferenceAdoption,
  ReferenceAdoptionMode,
  ReferenceKind,
  ReferenceSetupItemStatus,
  ReferenceSetupStatus,
} from '@/lib/types/references';

const PREVIEW_SIGNED_TTL_SECONDS = 600;
/** Cap the stored original's longest edge so private objects stay small. */
const SOURCE_MAX_DIMENSION = 1536;

async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) return null;
  return user?.id ?? null;
}

export interface UploadReferenceSourceInput {
  setupId: string;
  kind: ReferenceKind;
  slotIndex: number;
  displayName?: string | null;
  /** Client-compressed webp/jpg/png data URL. */
  dataUrl: string;
}

export interface UploadReferenceSourceResult {
  sourceId: string;
  kind: ReferenceKind;
  slotIndex: number;
  displayName: string | null;
  previewUrl: string | null;
}

/**
 * Validate + store a private original reference upload. Re-uploading to a slot
 * that already holds a live source replaces it (the old source + any live
 * adoption are retired). Nothing is charged here — coins are reserved at
 * adoption enqueue (P4).
 */
export async function uploadReferenceSource(
  input: UploadReferenceSourceInput
): Promise<UploadReferenceSourceResult> {
  const userId = await getCurrentUserId();
  if (!userId) throw new ReferenceError('REFERENCE_SIGN_IN_REQUIRED');

  if (!isReferenceKind(input.kind)) throw new ReferenceError('REFERENCE_INVALID_FILE');
  const setupId = (input.setupId ?? '').trim();
  if (!setupId) throw new ReferenceError('REFERENCE_INVALID_FILE');

  const availability = await getServerPipelineAvailability();
  if (!availability.available) throw new ReferenceError('REFERENCE_STORAGE_UNAVAILABLE');

  const { entitlements, settings } = await getReferenceRuntimeContext(userId);
  if (!entitlements.enabled) throw new ReferenceError('REFERENCE_FEATURE_DISABLED');

  const kindEnabled = input.kind === 'character' ? entitlements.charactersEnabled : entitlements.worldsEnabled;
  if (!kindEnabled) throw new ReferenceError('REFERENCE_TIER_NOT_ALLOWED');

  const maxForKind =
    input.kind === 'character' ? entitlements.maxCharacterRefs : entitlements.maxWorldRefs;
  const slotIndex = Number.isInteger(input.slotIndex) ? input.slotIndex : 0;
  if (slotIndex < 0 || slotIndex >= maxForKind) {
    throw new ReferenceError('REFERENCE_LIMIT_REACHED');
  }

  const admin = createAdminClient();

  // Enforce the per-kind count ceiling against currently live sources, ignoring
  // the slot being (re)uploaded so a replace doesn't count twice.
  const { data: liveSources } = await admin
    .from('reference_sources')
    .select('id, slot_index')
    .eq('setup_id', setupId)
    .eq('user_id', userId)
    .eq('kind', input.kind)
    .neq('status', 'removed');
  const otherSlots = (liveSources ?? []).filter((row) => row.slot_index !== slotIndex);
  if (otherSlots.length >= maxForKind) {
    throw new ReferenceError('REFERENCE_LIMIT_REACHED');
  }

  // Decode + validate the payload.
  const decoded = decodeReferenceUpload({
    dataUrl: input.dataUrl,
    maxBytes: settings.maxFileSizeMb * 1024 * 1024,
  });
  if (!decoded.ok) throw new ReferenceError('REFERENCE_INVALID_FILE');

  // Re-encode to webp with sharp: normalizes format, strips EXIF, caps size, and
  // gives us reliable dimensions + a min-dimension gate.
  let normalized: { buffer: Buffer; width: number; height: number };
  try {
    const output = await sharp(decoded.value.buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: SOURCE_MAX_DIMENSION, height: SOURCE_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    normalized = { buffer: output.data, width: output.info.width, height: output.info.height };
  } catch {
    throw new ReferenceError('REFERENCE_INVALID_FILE');
  }

  if (Math.min(normalized.width, normalized.height) < settings.minDimensionPx) {
    throw new ReferenceError('REFERENCE_INVALID_FILE');
  }

  const sourceId = randomUUID();
  const objectKey = buildReferenceSourceKey({ userId, setupId, sourceId, mimeType: 'image/webp' });
  let bucket: string;
  try {
    const stored = await putR2Object({
      access: 'private',
      objectKey,
      body: normalized.buffer,
      contentType: 'image/webp',
      cacheControl: 'private, max-age=0, no-store',
    });
    bucket = stored.bucket;
  } catch {
    throw new ReferenceError('REFERENCE_STORAGE_UNAVAILABLE');
  }

  // Retire the previous live source at this slot (and its adoption), then insert
  // the new one. Do it in this order so the partial unique index never collides.
  await retireSlot(admin, { setupId, userId, kind: input.kind, slotIndex });

  const displayName = (input.displayName ?? '').trim() || null;
  const { error: insertError } = await admin.from('reference_sources').insert({
    id: sourceId,
    user_id: userId,
    setup_id: setupId,
    story_id: null,
    kind: input.kind,
    slot_index: slotIndex,
    display_name: displayName,
    r2_bucket: bucket,
    r2_object_key: objectKey,
    checksum_sha256: decoded.value.checksum,
    mime_type: 'image/webp',
    width: normalized.width,
    height: normalized.height,
    bytes: normalized.buffer.byteLength,
    status: 'uploaded',
  });
  if (insertError) {
    await deleteR2Object(toR2Reference(bucket, objectKey)).catch(() => {});
    throw new ReferenceError('REFERENCE_STORAGE_UNAVAILABLE', insertError.message);
  }

  const previewUrl = await createR2SignedGetUrl(toR2Reference(bucket, objectKey), undefined, PREVIEW_SIGNED_TTL_SECONDS);

  return {
    sourceId,
    kind: input.kind,
    slotIndex,
    displayName,
    previewUrl,
  };
}

/** Mark the live source at a slot removed, delete its object, and cancel/retire
 *  its live adoption. Used by both replace (internal) and explicit removal. */
async function retireSlot(
  admin: ReturnType<typeof createAdminClient>,
  input: { setupId: string; userId: string; kind: ReferenceKind; slotIndex: number }
): Promise<void> {
  const { data: existing } = await admin
    .from('reference_sources')
    .select('*')
    .eq('setup_id', input.setupId)
    .eq('user_id', input.userId)
    .eq('kind', input.kind)
    .eq('slot_index', input.slotIndex)
    .neq('status', 'removed')
    .maybeSingle();
  if (!existing) return;
  await retireSource(admin, existing as DbReferenceSource);
}

async function retireSource(
  admin: ReturnType<typeof createAdminClient>,
  source: DbReferenceSource
): Promise<void> {
  await admin.from('reference_sources').update({ status: 'removed' }).eq('id', source.id);
  // Cancel any not-yet-terminal adoption for this source so it stops being seeded.
  await admin
    .from('reference_adoptions')
    .update({ status: 'cancelled' })
    .eq('source_id', source.id)
    .in('status', ['pending', 'processing', 'ready']);
  await deleteR2Object(toR2Reference(source.r2_bucket, source.r2_object_key)).catch(() => {});
}

export async function removeReferenceSource(sourceId: string): Promise<{ removed: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new ReferenceError('REFERENCE_SIGN_IN_REQUIRED');

  const admin = createAdminClient();
  const { data: source } = await admin
    .from('reference_sources')
    .select('*')
    .eq('id', sourceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!source) return { removed: false };
  if ((source as DbReferenceSource).status === 'removed') return { removed: true };

  await retireSource(admin, source as DbReferenceSource);
  return { removed: true };
}

/**
 * Owner-scoped snapshot of a setup's uploads + adoptions, with freshly signed
 * preview/canonical URLs, for the story-creation panel to poll.
 */
export async function getReferenceSetupStatus(setupId: string): Promise<ReferenceSetupStatus> {
  const userId = await getCurrentUserId();
  if (!userId) throw new ReferenceError('REFERENCE_SIGN_IN_REQUIRED');

  const trimmed = (setupId ?? '').trim();
  if (!trimmed) return { setupId: trimmed, items: [], allResolved: true, hasPending: false };

  const admin = createAdminClient();
  const [sourcesResult, adoptionsResult] = await Promise.all([
    admin
      .from('reference_sources')
      .select('*')
      .eq('setup_id', trimmed)
      .eq('user_id', userId)
      .neq('status', 'removed')
      .order('kind', { ascending: true })
      .order('slot_index', { ascending: true }),
    admin
      .from('reference_adoptions')
      .select('*')
      .eq('setup_id', trimmed)
      .eq('user_id', userId)
      .neq('status', 'cancelled'),
  ]);

  const adoptionsBySource = new Map<string, DbReferenceAdoption>();
  for (const row of (adoptionsResult.data ?? []) as DbReferenceAdoption[]) {
    // Keep the most recent live adoption per source.
    const prev = adoptionsBySource.get(row.source_id);
    if (!prev || row.created_at > prev.created_at) adoptionsBySource.set(row.source_id, row);
  }

  const items: ReferenceSetupItemStatus[] = [];
  let hasPending = false;
  for (const source of (sourcesResult.data ?? []) as DbReferenceSource[]) {
    const adoption = adoptionsBySource.get(source.id) ?? null;
    const status = adoption ? adoption.status : 'uploaded';
    if (status === 'pending' || status === 'processing') hasPending = true;

    const previewUrl = await createR2SignedGetUrl(
      toR2Reference(source.r2_bucket, source.r2_object_key),
      undefined,
      PREVIEW_SIGNED_TTL_SECONDS
    );
    let canonicalUrl: string | null = null;
    if (adoption?.status === 'ready' && adoption.canonical_r2_bucket && adoption.canonical_r2_object_key) {
      canonicalUrl = await createR2SignedGetUrl(
        toR2Reference(adoption.canonical_r2_bucket, adoption.canonical_r2_object_key),
        undefined,
        PREVIEW_SIGNED_TTL_SECONDS
      );
    }

    items.push({
      sourceId: source.id,
      adoptionId: adoption?.id ?? null,
      kind: source.kind,
      slotIndex: source.slot_index,
      displayName: source.display_name,
      status,
      previewUrl,
      canonicalUrl,
      error: adoption?.error ?? null,
    });
  }

  const allResolved = items.every((item) => item.status === 'ready' || item.status === 'failed' || item.status === 'uploaded')
    && !hasPending;

  return { setupId: trimmed, items, allResolved, hasPending };
}

/**
 * Backfill story_id onto a setup's reference rows once the story row exists.
 * Called (fire-and-forget) from saveStoryToSupabase after insert. Idempotent and
 * scoped to the owner; only links rows that are still unlinked or already point
 * at this story.
 */
export async function linkReferenceSetupToStory(setupId: string, storyId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  const trimmed = (setupId ?? '').trim();
  if (!trimmed || !storyId) return;

  const admin = createAdminClient();
  try {
    for (const table of ['reference_sources', 'reference_adoptions'] as const) {
      await admin
        .from(table)
        .update({ story_id: storyId })
        .eq('setup_id', trimmed)
        .eq('user_id', userId)
        .is('story_id', null);
    }
  } catch (error) {
    console.error('linkReferenceSetupToStory failed:', error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------------------
// Adoption enqueue / retry (P4)
// ---------------------------------------------------------------------------

async function kickReferenceWorker(jobId?: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  const base = (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  ).replace(/\/$/, '');
  await fetch(`${base}/api/reference/jobs/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(jobId ? { jobId } : {}),
    signal: AbortSignal.timeout(15_000),
    keepalive: true,
  }).catch((error) => console.error('Failed to kick reference worker:', error));
}

/** Reserve coins for one adoption operation. Returns the reservation id (null in
 *  soft/shadow/bypass modes) or throws REFERENCE_INSUFFICIENT_COINS. */
async function reserveAdoptionCoins(input: {
  userId: string;
  actionKey: PricingActionKey;
  idempotencyKey: string;
}): Promise<string | null> {
  const auth = await authorizeBillableAction({
    userId: input.userId,
    actionKey: input.actionKey,
    idempotencyKey: input.idempotencyKey,
    metadata: { feature: 'reference_personalization' },
  });
  if (auth.status === 'denied') throw new ReferenceError('REFERENCE_INSUFFICIENT_COINS');
  return auth.status === 'allowed' ? auth.reservationId : null;
}

export interface EnqueueReferenceAdoptionInput {
  sourceId: string;
  /** Locked story visual style summary (deriveVisualStyleSummary) at enqueue. */
  visualStyle: string;
  /** Locked image model selection from the landing config, if any. */
  imageModelSelection?: ImageModelSelection | null;
}

export interface EnqueueReferenceAdoptionResult {
  adoptionId: string;
  status: 'pending' | 'processing' | 'ready';
  reused: boolean;
}

export async function enqueueReferenceAdoption(
  input: EnqueueReferenceAdoptionInput
): Promise<EnqueueReferenceAdoptionResult> {
  const userId = await getCurrentUserId();
  if (!userId) throw new ReferenceError('REFERENCE_SIGN_IN_REQUIRED');

  const { entitlements, settings, planKey } = await getReferenceRuntimeContext(userId);
  if (!entitlements.enabled) throw new ReferenceError('REFERENCE_FEATURE_DISABLED');
  if (settings.pauseNewAdoptions) throw new ReferenceError('REFERENCE_PROVIDER_UNAVAILABLE');

  const admin = createAdminClient();
  const { data: sourceRow } = await admin
    .from('reference_sources')
    .select('*')
    .eq('id', input.sourceId)
    .eq('user_id', userId)
    .maybeSingle();
  const source = sourceRow as DbReferenceSource | null;
  if (!source || source.status === 'removed') throw new ReferenceError('REFERENCE_SOURCE_NOT_FOUND');

  const kindEnabled = source.kind === 'character' ? entitlements.charactersEnabled : entitlements.worldsEnabled;
  if (!kindEnabled) throw new ReferenceError('REFERENCE_TIER_NOT_ALLOWED');

  // Idempotent: reuse an existing live adoption for this source.
  const { data: existing } = await admin
    .from('reference_adoptions')
    .select('id, status')
    .eq('source_id', source.id)
    .in('status', ['pending', 'processing', 'ready'])
    .maybeSingle();
  if (existing) {
    return {
      adoptionId: existing.id,
      status: existing.status as 'pending' | 'processing' | 'ready',
      reused: true,
    };
  }

  const adoptionId = randomUUID();
  const adoptionMode: ReferenceAdoptionMode =
    source.kind === 'character' ? 'canonical_visual' : entitlements.worldAdoptionMode;

  // Reserve coins. Character = one charge. World = analysis charge, plus a
  // separate visualization charge only when a canonical world visual is produced.
  let reservationId: string | null = null;
  let visualizationReservationId: string | null = null;
  if (source.kind === 'character') {
    reservationId = await reserveAdoptionCoins({
      userId,
      actionKey: 'adopt_character_reference',
      idempotencyKey: `refadopt:${adoptionId}`,
    });
  } else {
    reservationId = await reserveAdoptionCoins({
      userId,
      actionKey: 'adopt_world_reference',
      idempotencyKey: `refadopt:${adoptionId}`,
    });
    if (adoptionMode === 'description_plus_canonical_visual') {
      try {
        visualizationReservationId = await reserveAdoptionCoins({
          userId,
          actionKey: 'visualize_world_reference',
          idempotencyKey: `refworldviz:${adoptionId}`,
        });
      } catch (error) {
        // Release the analysis reservation so we don't strand a hold.
        if (reservationId) {
          await releaseReservationSafely(userId, reservationId);
        }
        throw error;
      }
    }
  }

  const imageModelSnapshot = {
    selection: input.imageModelSelection ?? null,
    planKey,
  };

  const { error: insertError } = await admin.from('reference_adoptions').insert({
    id: adoptionId,
    user_id: userId,
    setup_id: source.setup_id,
    story_id: source.story_id,
    source_id: source.id,
    kind: source.kind,
    adoption_mode: adoptionMode,
    status: 'pending',
    display_name: source.display_name,
    structured_json: {},
    visual_style: input.visualStyle || null,
    image_model_snapshot: imageModelSnapshot,
    reservation_id: reservationId,
    visualization_reservation_id: visualizationReservationId,
    max_attempts: settings.maxAttempts,
  });
  if (insertError) {
    if (reservationId) await releaseReservationSafely(userId, reservationId);
    if (visualizationReservationId) await releaseReservationSafely(userId, visualizationReservationId);
    throw new ReferenceError('REFERENCE_ADOPTION_FAILED', insertError.message);
  }

  await kickReferenceWorker(adoptionId);
  return { adoptionId, status: 'pending', reused: false };
}

async function releaseReservationSafely(userId: string, reservationId: string): Promise<void> {
  await releaseBillableAction({ userId, reservationId, reason: 'reference_enqueue_aborted' }).catch(() => {});
}

export async function retryReferenceAdoption(adoptionId: string): Promise<{ status: 'pending' }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new ReferenceError('REFERENCE_SIGN_IN_REQUIRED');

  const { settings } = await getReferenceRuntimeContext(userId);
  if (settings.pauseNewAdoptions) throw new ReferenceError('REFERENCE_PROVIDER_UNAVAILABLE');

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('reference_adoptions')
    .select('*')
    .eq('id', adoptionId)
    .eq('user_id', userId)
    .maybeSingle();
  const adoption = row as DbReferenceAdoption | null;
  if (!adoption) throw new ReferenceError('REFERENCE_SOURCE_NOT_FOUND');
  if (adoption.status !== 'failed') {
    // Nothing to retry for non-failed states.
    return { status: 'pending' };
  }

  // Fresh reservation for the retry (the previous one was released on failure);
  // a distinct idempotency key so it is a new hold.
  const attemptSuffix = `:retry${adoption.attempt_count}`;
  let reservationId: string | null = null;
  let visualizationReservationId: string | null = null;
  if (adoption.kind === 'character') {
    reservationId = await reserveAdoptionCoins({
      userId,
      actionKey: 'adopt_character_reference',
      idempotencyKey: `refadopt:${adoptionId}${attemptSuffix}`,
    });
  } else {
    reservationId = await reserveAdoptionCoins({
      userId,
      actionKey: 'adopt_world_reference',
      idempotencyKey: `refadopt:${adoptionId}${attemptSuffix}`,
    });
    if (adoption.adoption_mode === 'description_plus_canonical_visual') {
      visualizationReservationId = await reserveAdoptionCoins({
        userId,
        actionKey: 'visualize_world_reference',
        idempotencyKey: `refworldviz:${adoptionId}${attemptSuffix}`,
      });
    }
  }

  await admin
    .from('reference_adoptions')
    .update({
      status: 'pending',
      error: null,
      attempt_count: 0,
      claimed_at: null,
      completed_at: null,
      reservation_id: reservationId,
      visualization_reservation_id: visualizationReservationId,
    })
    .eq('id', adoptionId)
    .eq('status', 'failed');

  await kickReferenceWorker(adoptionId);
  return { status: 'pending' };
}
