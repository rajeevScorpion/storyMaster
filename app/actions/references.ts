'use server';

import 'server-only';

import sharp from 'sharp';
import { randomUUID } from 'node:crypto';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getServerPipelineAvailability } from '@/lib/media/processing-mode';
import { putR2Object, createR2SignedGetUrl, deleteR2Object, getR2ObjectBuffer } from '@/lib/media/r2-server';
import { toR2Reference, isR2Reference, parseR2Reference } from '@/lib/media/r2-reference';
import { getReferenceRuntimeContext } from '@/lib/references/reference-runtime';
import {
  buildReferenceSourceKey,
  decodeReferenceUpload,
  isReferenceKind,
} from '@/lib/references/reference-storage';
import { ReferenceError } from '@/lib/references/reference-errors';
import { authorizeBillableAction, finalizeBillableAction, releaseBillableAction } from '@/lib/pricing/enforcement';
import { buildSeedCharacters, type SeedCharacterInput } from '@/lib/references/seed';
import { buildDirectSeed, type DirectSeedInput } from '@/lib/references/direct-seed';
import { analyzeCharacterReference, analyzeWorldReference } from '@/lib/ai/reference-analysis';
import { compileCharacterAnchor, compileWorldAnchor } from '@/lib/ai/reference-adoption-prompts';
import type { ImageModelSelection } from '@/lib/ai/image-models.shared';
import { COINS_PER_BEAT, type PricingActionKey } from '@/lib/types/pricing';
import type { Character } from '@/lib/types/story';
import type { ReferenceInputMode, WorldAdoptionMode } from '@/lib/types/references';
import type {
  DbReferenceSource,
  DbReferenceAdoption,
  ReferenceAdoptionMode,
  ReferenceKind,
  ReferenceSetupItemStatus,
  ReferenceSetupStatus,
  StoryConfigCharacterReference,
  StoryConfigWorldReference,
  WorldReferenceDescription,
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

/**
 * Resolve private r2:// reference keys to base64 data URLs for the client image
 * pipeline (which runs in the browser and cannot read the private bucket). Only
 * keys under the caller's own path segment (`/{userId}/`) are resolved — this
 * covers both direct-input source keys (references/{userId}/...) and adopted
 * canonical keys (stories/references/{userId}/...). Anything else resolves to
 * null so a foreign or malformed key is silently skipped, not leaked.
 *
 * Keys are used immediately at generation time, so returning inline base64 (vs a
 * TTL'd signed URL that could expire mid-session) is deliberate — it is what
 * makes durable keys immune to the v1 expired-URL bug.
 */
export async function resolveReferenceImageKeys(
  keys: string[]
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const userId = await getCurrentUserId();
  const unique = Array.from(new Set(keys.filter((k) => typeof k === 'string' && k.length > 0)));
  await Promise.all(
    unique.map(async (key) => {
      out[key] = null;
      if (!userId || !isR2Reference(key)) return;
      const parsed = parseR2Reference(key);
      if (!parsed || !parsed.objectKey.includes(`/${userId}/`)) return;
      const object = await getR2ObjectBuffer(key).catch(() => null);
      if (!object) return;
      out[key] = `data:${object.contentType ?? 'image/webp'};base64,${object.buffer.toString('base64')}`;
    })
  );
  return out;
}

export interface ReferenceCreationContext {
  enabled: boolean;
  /** Which UI/pipeline the story-creation surface should render. */
  inputMode: ReferenceInputMode;
  charactersEnabled: boolean;
  worldsEnabled: boolean;
  maxCharacterRefs: number;
  maxWorldRefs: number;
  worldAdoptionMode: WorldAdoptionMode;
  maxFileSizeMb: number;
  costs: { character: number; world: number; worldVisualization: number; analysis: number };
}

async function loadActionCoinCost(
  admin: ReturnType<typeof createAdminClient>,
  actionKey: PricingActionKey
): Promise<number> {
  const { data } = await admin
    .from('pricing_action_costs')
    .select('beat_cost')
    .eq('action_key', actionKey)
    .eq('is_active', true)
    .maybeSingle();
  const beats = Number(data?.beat_cost ?? 0);
  return Number.isFinite(beats) ? Math.round(beats * COINS_PER_BEAT) : 0;
}

/**
 * Everything the story-creation panel needs to render: resolved entitlements and
 * per-operation coin costs. Returns a disabled context (enabled=false) when the
 * feature is off, the tier is not allowed, or the private R2 pipeline is
 * unavailable — the panel renders nothing in that case.
 */
export async function getReferenceCreationContext(): Promise<ReferenceCreationContext> {
  const disabled: ReferenceCreationContext = {
    enabled: false,
    inputMode: 'direct',
    charactersEnabled: false,
    worldsEnabled: false,
    maxCharacterRefs: 0,
    maxWorldRefs: 0,
    worldAdoptionMode: 'description_only',
    maxFileSizeMb: 8,
    costs: { character: 0, world: 0, worldVisualization: 0, analysis: 0 },
  };

  const userId = await getCurrentUserId();
  if (!userId) return disabled;

  const availability = await getServerPipelineAvailability();
  if (!availability.available) return disabled;

  const { entitlements, settings, inputMode } = await getReferenceRuntimeContext(userId);
  if (!entitlements.enabled) return disabled;

  const admin = createAdminClient();
  const [character, world, worldVisualization, analysis] = await Promise.all([
    loadActionCoinCost(admin, 'adopt_character_reference'),
    loadActionCoinCost(admin, 'adopt_world_reference'),
    loadActionCoinCost(admin, 'visualize_world_reference'),
    loadActionCoinCost(admin, 'analyze_direct_reference'),
  ]);

  return {
    enabled: entitlements.enabled,
    inputMode,
    charactersEnabled: entitlements.charactersEnabled,
    worldsEnabled: entitlements.worldsEnabled,
    maxCharacterRefs: entitlements.maxCharacterRefs,
    maxWorldRefs: entitlements.maxWorldRefs,
    worldAdoptionMode: entitlements.worldAdoptionMode,
    maxFileSizeMb: settings.maxFileSizeMb,
    costs: { character, world, worldVisualization, analysis },
  };
}

export interface UploadReferenceSourceInput {
  setupId: string;
  kind: ReferenceKind;
  slotIndex: number;
  displayName?: string | null;
  /** v2 direct input: optional free-text description (character detail / world notes). */
  description?: string | null;
  /** Client-compressed webp/jpg/png data URL. */
  dataUrl: string;
}

export interface UploadReferenceSourceResult {
  sourceId: string;
  kind: ReferenceKind;
  slotIndex: number;
  displayName: string | null;
  description: string | null;
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
  const description = (input.description ?? '').trim() || null;
  const { error: insertError } = await admin.from('reference_sources').insert({
    id: sourceId,
    user_id: userId,
    setup_id: setupId,
    story_id: null,
    kind: input.kind,
    slot_index: slotIndex,
    display_name: displayName,
    description,
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
    description,
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
      description: source.description ?? null,
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

export interface DirectReferenceSeed {
  seedCharacters: Character[];
  references: {
    characters: StoryConfigCharacterReference[];
    worlds: StoryConfigWorldReference[];
  };
}

const EMPTY_DIRECT_SEED: DirectReferenceSeed = {
  seedCharacters: [],
  references: { characters: [], worlds: [] },
};

/**
 * v2 direct input: turn a setup's raw uploads into seed characters + config
 * references (raw keys) at story start. When `analyze` is set (prompt_only
 * stories), each reference is run through the multimodal analyzer to enrich its
 * description so text prompts match the upload closely; that analysis is the one
 * billable step in direct mode (idempotent per source, released on failure).
 */
export async function loadDirectReferenceSeed(
  setupId: string,
  opts?: { analyze?: boolean }
): Promise<DirectReferenceSeed> {
  const userId = await getCurrentUserId();
  if (!userId) return EMPTY_DIRECT_SEED;

  const trimmed = (setupId ?? '').trim();
  if (!trimmed) return EMPTY_DIRECT_SEED;

  const { masterEnabled, inputMode, entitlements } = await getReferenceRuntimeContext(userId);
  if (!masterEnabled || inputMode !== 'direct' || !entitlements.enabled) return EMPTY_DIRECT_SEED;

  const admin = createAdminClient();
  const { data: sourceRows } = await admin
    .from('reference_sources')
    .select('*')
    .eq('setup_id', trimmed)
    .eq('user_id', userId)
    .eq('status', 'uploaded')
    .order('kind', { ascending: true })
    .order('slot_index', { ascending: true });

  const sources = (sourceRows ?? []) as DbReferenceSource[];
  // Defensive cap against tier limits (upload already enforces per-kind slots).
  const perKindCount: Record<ReferenceKind, number> = { character: 0, world: 0 };
  const inputs: DirectSeedInput[] = [];
  for (const source of sources) {
    const cap = source.kind === 'character' ? entitlements.maxCharacterRefs : entitlements.maxWorldRefs;
    if (perKindCount[source.kind] >= cap) continue;
    perKindCount[source.kind] += 1;
    inputs.push({
      sourceId: source.id,
      kind: source.kind,
      displayName: source.display_name,
      description: source.description,
      storageKey: toR2Reference(source.r2_bucket, source.r2_object_key),
    });
  }

  if (opts?.analyze) {
    await Promise.all(
      inputs.map(async (input) => {
        const enriched = await analyzeDirectReference(userId, input).catch(() => null);
        if (enriched) input.description = enriched;
      })
    );
  }

  return buildDirectSeed(inputs);
}

/**
 * Reserve → analyze → finalize one direct reference (prompt_only enrichment).
 * Returns the merged description (user text + compiled anchor) or null when the
 * analysis is skipped/fails (the reservation is released, and the caller keeps
 * the user's own description). Never throws — enrichment must not block Start.
 */
async function analyzeDirectReference(userId: string, input: DirectSeedInput): Promise<string | null> {
  let reservationId: string | null = null;
  try {
    const auth = await authorizeBillableAction({
      userId,
      actionKey: 'analyze_direct_reference',
      idempotencyKey: `refanalyze:${input.sourceId}`,
      metadata: { feature: 'reference_direct_input' },
    });
    if (auth.status === 'denied') return null;
    reservationId = auth.status === 'allowed' ? auth.reservationId : null;

    const object = await getR2ObjectBuffer(input.storageKey);
    if (!object) throw new Error('reference object unavailable');
    const referencePart = { mimeType: object.contentType ?? 'image/webp', data: object.buffer.toString('base64') };

    const userText = (input.description ?? '').trim();
    let anchor = '';
    if (input.kind === 'character') {
      const description = await analyzeCharacterReference({ referencePart });
      if (description.unusableReason) throw new Error(description.unusableReason);
      anchor = compileCharacterAnchor(description);
    } else {
      const description = await analyzeWorldReference({ referencePart });
      if (description.unusableReason) throw new Error(description.unusableReason);
      anchor = compileWorldAnchor(description);
    }

    if (reservationId) {
      await finalizeBillableAction({ userId, reservationId }).catch(() => {});
    }
    return [userText, anchor].filter((part) => part.length > 0).join('\n\n') || null;
  } catch {
    if (reservationId) {
      await releaseBillableAction({ userId, reservationId, reason: 'direct_reference_analysis_failed' }).catch(() => {});
    }
    return null;
  }
}

/**
 * v2 direct input: persist name/description edits made after upload (no image
 * change). Owner-scoped; only updates the provided fields. Empty strings clear
 * the field.
 */
export async function updateReferenceSourceDetails(
  sourceId: string,
  patch: { displayName?: string | null; description?: string | null }
): Promise<{ ok: true }> {
  const userId = await getCurrentUserId();
  if (!userId) throw new ReferenceError('REFERENCE_SIGN_IN_REQUIRED');

  const update: Record<string, string | null> = {};
  if (patch.displayName !== undefined) update.display_name = (patch.displayName ?? '').trim() || null;
  if (patch.description !== undefined) update.description = (patch.description ?? '').trim() || null;
  if (Object.keys(update).length === 0) return { ok: true };

  const admin = createAdminClient();
  await admin
    .from('reference_sources')
    .update(update)
    .eq('id', sourceId)
    .eq('user_id', userId)
    .neq('status', 'removed');
  return { ok: true };
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

// ---------------------------------------------------------------------------
// Seed assembly for story creation (P6)
// ---------------------------------------------------------------------------

export interface ReferenceSeed {
  seedCharacters: Character[];
  worlds: StoryConfigWorldReference[];
}

/**
 * Assemble the ready adoptions of a setup into StorySeedOptions.seedCharacters
 * (adopted characters as ordinary roster entries) plus resolved world references
 * for the story config. Only READY adoptions are included; pending/failed ones
 * are skipped (the UI gates Start on resolution). Canonical assets are referenced
 * as durable r2:// keys that the load-time signers re-sign on every read.
 */
export async function loadReadyReferenceSeed(setupId: string): Promise<ReferenceSeed> {
  const userId = await getCurrentUserId();
  if (!userId) return { seedCharacters: [], worlds: [] };
  const trimmed = (setupId ?? '').trim();
  if (!trimmed) return { seedCharacters: [], worlds: [] };

  const admin = createAdminClient();
  const { data } = await admin
    .from('reference_adoptions')
    .select('*')
    .eq('setup_id', trimmed)
    .eq('user_id', userId)
    .eq('status', 'ready')
    .order('created_at', { ascending: true });

  const adoptions = (data ?? []) as DbReferenceAdoption[];

  const characterInputs: SeedCharacterInput[] = [];
  const worlds: StoryConfigWorldReference[] = [];

  for (const adoption of adoptions) {
    const canonicalRef =
      adoption.canonical_r2_bucket && adoption.canonical_r2_object_key
        ? toR2Reference(adoption.canonical_r2_bucket, adoption.canonical_r2_object_key)
        : null;

    if (adoption.kind === 'character') {
      if (!canonicalRef) continue; // a ready character must have a canonical image
      // Sign the canonical for immediate client-side beat-1 generation; the
      // durable r2:// ref is kept as the storage key and re-signed on later loads.
      const signedUrl = await createR2SignedGetUrl(canonicalRef, undefined, PREVIEW_SIGNED_TTL_SECONDS);
      if (!signedUrl) continue;
      characterInputs.push({
        adoptionId: adoption.id,
        displayName: adoption.display_name,
        anchor: adoption.prompt_anchor ?? '',
        canonicalSignedUrl: signedUrl,
        canonicalReference: canonicalRef,
        completedAt: adoption.completed_at,
      });
    } else {
      const structured = adoption.structured_json as WorldReferenceDescription;
      worlds.push({
        adoptionId: adoption.id,
        worldId: `world_${adoption.id}`,
        label: adoption.display_name || structured?.summary || 'World',
        anchor: adoption.prompt_anchor ?? '',
        keywords: Array.isArray(structured?.keywords) ? structured.keywords : [],
        adoptionMode:
          adoption.adoption_mode === 'description_plus_canonical_visual'
            ? 'description_plus_canonical_visual'
            : 'description_only',
        ...(canonicalRef ? { canonicalStorageKey: canonicalRef } : {}),
      });
    }
  }

  return { seedCharacters: buildSeedCharacters(characterInputs), worlds };
}
