'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { InlineImagePart } from '@/app/actions/gemini-proxy';
import { normalizeStoryConfig, deriveVisualStyleSummary } from '@/lib/ai/story-config';
import { generateCharacterPortraitServer } from '@/app/actions/portrait-server';
import { generateSelectedImage } from '@/app/actions/image-generation';
import {
  extractImageContinuityState,
  resolveImageContinuityStrategy,
  type ImageContinuityProviderState,
} from '@/lib/ai/image-continuity.shared';
import { getImageContinuitySettings } from '@/lib/ai/image-continuity-settings';
import { getStatefulRuntimePricing } from '@/lib/ai/image-continuity-settings.shared';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import { resolveImageModelSnapshot } from '@/lib/ai/image-models';
import {
  estimateImageProviderCostUsd,
  imageTaskForStoryKind,
  getImageModelMaxReferenceImages,
  coinsToBeatCost,
} from '@/lib/ai/image-models.shared';
import {
  authorizeBillableAction,
  finalizeBillableAction,
  releaseBillableAction,
} from '@/lib/pricing/enforcement';
import {
  pollImageBatchWithProvider,
  submitImageBatchWithProvider,
} from '@/lib/ai/image-providers/router';
import type { ImageBatchRequestItem } from '@/lib/ai/image-providers/types';
import {
  applyBatchDiscount,
  normalizeImageBatchScope,
  normalizeImageBatchScopeSettings,
  resolveBatchProvider,
  IMAGE_BATCH_DISCOUNT_MULTIPLIER,
  type ImageBatchScope,
  type ImageBatchScopeSettings,
} from '@/lib/ai/image-batch.shared';
import { compressImageDataUrlServer, mapWithConcurrency } from '@/lib/media/serverImageCompression';
import { extractStoragePath, normalizeStorageUrl } from '@/lib/supabase/storage';
import { getPathToNode } from '@/lib/utils/story-map';
import type { Character, StoryConfig, StoryMap, StoryNode } from '@/lib/types/story';

const STORY_ASSETS_BUCKET = 'story-assets';
const MATERIALIZE_CONCURRENCY = 4;
// Cap live portrait pre-generation so the submit action stays within serverless limits.
const MAX_LIVE_PORTRAITS = 4;
const PORTRAIT_CONCURRENCY = 2;
// Cap items processed per reconcile invocation so a large batch stays within
// serverless function time limits; remaining items are picked up next tick.
const MATERIALIZE_ITEMS_PER_RUN = 24;
const BATCH_RESULT_EXPIRY_HOURS = 48;

type AdminClient = ReturnType<typeof createAdminClient>;

interface StoryRow {
  id: string;
  user_id: string;
  story_map: StoryMap | null;
  story_config: Partial<StoryConfig> | null;
}

export interface SubmitStoryImageBatchResult {
  jobId: string | null;
  itemCount: number;
  estimatedCostUsd: number;
  provider: string;
  status: string;
  message: string;
}

function beatPrompt(node: StoryNode): string {
  const beat = node.data;
  return (beat.finalImagePromptText || beat.storyboardPromptText || beat.imagePrompt || '').trim();
}

function beatNeedsImage(node: StoryNode): boolean {
  const beat = node.data;
  if (beat.imageStatus === 'ready' && beat.imageUrl) return false;
  return beatPrompt(node).length > 0;
}

function findEndingNodeIds(map: StoryMap): string[] {
  return Object.values(map.nodes)
    .filter((node) => node.data.isEnding || node.children.length === 0)
    .map((node) => node.id);
}

/** Select the target beats for a batch according to the resolved scope. */
function selectScopeNodes(map: StoryMap, scope: ImageBatchScope): StoryNode[] {
  if (scope === 'current_path') {
    return getPathToNode(map, map.currentNodeId);
  }
  if (scope === 'all_existing' || scope === 'expand_branches') {
    // Eager branch expansion is not performed here (admin opt-in future work);
    // treat as "every beat that currently exists".
    return Object.values(map.nodes);
  }
  // path_to_completion: union of every root→ending path that currently exists.
  const endingIds = findEndingNodeIds(map);
  if (endingIds.length === 0) return Object.values(map.nodes);
  const seen = new Set<string>();
  const nodes: StoryNode[] = [];
  for (const endingId of endingIds) {
    for (const node of getPathToNode(map, endingId)) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        nodes.push(node);
      }
    }
  }
  return nodes;
}

export async function getImageBatchScopeSettings(): Promise<ImageBatchScopeSettings> {
  const raw = await getFeatureFlagValue('image_batch_scope').catch(() => null);
  if (!raw) return normalizeImageBatchScopeSettings(null);
  try {
    return normalizeImageBatchScopeSettings(JSON.parse(raw));
  } catch {
    return normalizeImageBatchScopeSettings(null);
  }
}

async function loadOwnedStory(admin: AdminClient, storyId: string, userId: string): Promise<StoryRow> {
  const { data, error } = await admin
    .from('stories')
    .select('id, user_id, story_map, story_config')
    .eq('id', storyId)
    .single();
  if (error || !data) throw new Error('Story not found.');
  if (data.user_id !== userId) throw new Error('Forbidden.');
  return data as StoryRow;
}

async function downloadStorageImageAsInlinePart(
  admin: AdminClient,
  url: string | undefined
): Promise<InlineImagePart | null> {
  if (!url) return null;
  const path = extractStoragePath(url, STORY_ASSETS_BUCKET);
  if (!path) return null;
  const { data, error } = await admin.storage.from(STORY_ASSETS_BUCKET).download(path);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  return { mimeType: data.type || 'image/png', data: buffer.toString('base64') };
}

async function uploadCharacterPortrait(
  admin: AdminClient,
  userId: string,
  storyId: string,
  characterId: string,
  dataUrl: string
): Promise<string> {
  const compressed = await compressImageDataUrlServer({ dataUrl, assetType: 'character_reference' });
  const path = `${userId}/${storyId}/characters/${characterId}.webp`;
  const { error } = await admin.storage
    .from(STORY_ASSETS_BUCKET)
    .upload(path, compressed.buffer, { contentType: 'image/webp', upsert: true });
  if (error) throw new Error(`Portrait upload failed: ${error.message}`);
  const { data } = admin.storage.from(STORY_ASSETS_BUCKET).getPublicUrl(path);
  return normalizeStorageUrl(data.publicUrl, STORY_ASSETS_BUCKET);
}

/**
 * "Live portraits now, batch beats": generate reference portraits for any
 * characters lacking one, immediately (full price), so batched beat images can
 * keep character continuity via resend_refs. Mutates the in-memory map and
 * persists it. Best-effort — a failed portrait doesn't block the batch.
 */
async function ensureCharacterPortraits(
  admin: AdminClient,
  userId: string,
  storyId: string,
  map: StoryMap,
  config: StoryConfig
): Promise<void> {
  const missing = new Map<string, Character>();
  for (const node of Object.values(map.nodes)) {
    for (const character of node.data.characters ?? []) {
      if (!missing.has(character.id) && !character.referenceSheetUrl && !character.portraitUrl) {
        missing.set(character.id, character);
      }
    }
  }
  const targets = [...missing.values()].slice(0, MAX_LIVE_PORTRAITS);
  if (targets.length === 0) return;

  const visualStyle = deriveVisualStyleSummary(config.visualSettings);
  const generated = new Map<string, string>();
  await mapWithConcurrency(targets, PORTRAIT_CONCURRENCY, async (character) => {
    try {
      const result = await generateCharacterPortraitServer({
        character,
        visualStyle,
        portraitReferenceConfig: config.portraitReferences,
        imageModelSelection: config.imageModelSelection ?? null,
        continuity: null,
      });
      if (result.dataUrl) {
        generated.set(character.id, await uploadCharacterPortrait(admin, userId, storyId, character.id, result.dataUrl));
      }
    } catch (error) {
      console.error(`Live portrait pre-generation failed for ${character.id}:`, error);
    }
  });
  if (generated.size === 0) return;

  for (const node of Object.values(map.nodes)) {
    node.data = {
      ...node.data,
      characters: (node.data.characters ?? []).map((character) =>
        generated.has(character.id)
          ? { ...character, portraitUrl: generated.get(character.id), referenceSheetUrl: generated.get(character.id) }
          : character
      ),
    };
  }
  await admin.from('stories').update({ story_map: map }).eq('id', storyId);
}

/** Gather up to `limit` character reference images so batched beats keep
 *  character continuity via resend_refs (batch cannot use stateful continuity). */
async function collectReferenceParts(
  admin: AdminClient,
  map: StoryMap,
  limit: number
): Promise<InlineImagePart[]> {
  if (limit <= 0) return [];
  const urls = new Set<string>();
  for (const node of Object.values(map.nodes)) {
    for (const character of node.data.characters ?? []) {
      const ref = character.referenceSheetUrl || character.portraitUrl;
      if (ref) urls.add(ref);
      if (urls.size >= limit) break;
    }
    if (urls.size >= limit) break;
  }
  const parts: InlineImagePart[] = [];
  for (const url of urls) {
    const part = await downloadStorageImageAsInlinePart(admin, url);
    if (part) parts.push(part);
  }
  return parts;
}

async function setBeatsPending(admin: AdminClient, storyId: string, nodeIds: string[]): Promise<void> {
  if (nodeIds.length === 0) return;
  await admin
    .from('beats')
    .update({ image_status: 'pending', image_error: null })
    .eq('story_id', storyId)
    .in('node_id', nodeIds);
}

/**
 * Submit a background image-generation batch for a story. Renders images at
 * ~50% of interactive cost with a ~24h turnaround. Uses the current image model
 * (falling back to Gemini if the selected provider has no batch endpoint) and
 * resend_refs continuity via existing character reference images.
 */
export async function submitStoryImageBatch(input: {
  storyId: string;
  scope?: ImageBatchScope;
}): Promise<SubmitStoryImageBatchResult> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const admin = createAdminClient();
  const story = await loadOwnedStory(admin, input.storyId, user.id);
  const map = story.story_map;
  if (!map || !map.nodes || !map.rootNodeId) throw new Error('Story has no beats to visualise.');

  const config = normalizeStoryConfig(story.story_config);
  const scopeSettings = await getImageBatchScopeSettings();
  const scope = input.scope
    ? normalizeImageBatchScope(input.scope)
    : scopeSettings.defaultScope;

  const targetNodes = selectScopeNodes(map, scope).filter(beatNeedsImage);
  if (targetNodes.length === 0) {
    return {
      jobId: null,
      itemCount: 0,
      estimatedCostUsd: 0,
      provider: 'gemini',
      status: 'noop',
      message: 'All beats in scope already have images.',
    };
  }

  const task = imageTaskForStoryKind(config.storyKind);
  const snapshot = await resolveImageModelSnapshot({
    taskKey: task,
    selection: config.imageModelSelection ?? null,
    currentPlanKey: 'free',
  });
  const provider = resolveBatchProvider(snapshot.providerKey);
  // Re-resolve for the fallback provider if the selected one can't batch.
  const batchSnapshot = provider === snapshot.providerKey
    ? snapshot
    : await resolveImageModelSnapshot({ taskKey: task, selection: null, currentPlanKey: 'free' });

  // Generate any missing character portraits live now so batched beats keep
  // continuity (Gemini resend_refs). OpenAI /images/generations ignores refs.
  if (provider === 'gemini') {
    await ensureCharacterPortraits(admin, user.id, story.id, map, config).catch((error) =>
      console.error('ensureCharacterPortraits failed:', error)
    );
  }
  const maxRefs = getImageModelMaxReferenceImages(batchSnapshot.capabilities);
  const referenceParts = provider === 'gemini'
    ? await collectReferenceParts(admin, map, maxRefs)
    : []; // OpenAI /images/generations does not accept reference images.

  const aspectRatio = config.aspectRatio;
  const items: ImageBatchRequestItem[] = targetNodes.map((node, index) => ({
    requestKey: String(index),
    prompt: beatPrompt(node),
    referenceParts,
    aspectRatio,
    imageSize: '1K',
  }));

  // Full interactive (regular) per-image cost — the accounting basis. The batch
  // discount is applied on top for the reserved/charged amount.
  const regularPerImageUsd = estimateImageProviderCostUsd({
    snapshot: batchSnapshot,
    outputImageCount: 1,
    inputImageCount: referenceParts.length,
  });
  const perImageUsd = applyBatchDiscount(regularPerImageUsd);
  const estimatedCostUsd = Number((perImageUsd * items.length).toFixed(6));

  // Reserve coins up-front at the discounted batch rate. Graceful: if pricing
  // isn't configured (no `batch_image_generation` cost / hard enforcement off),
  // this yields a null reservation and we proceed; a genuine balance shortfall
  // blocks the submission.
  const discountedCoins = batchSnapshot.coinCostPerImage * items.length * IMAGE_BATCH_DISCOUNT_MULTIPLIER;
  let reservationId: string | null = null;
  try {
    const authorization = await authorizeBillableAction({
      userId: user.id,
      actionKey: 'batch_image_generation',
      idempotencyKey: `batch_image_generation:${story.id}:${Date.now()}`,
      relatedStoryId: story.id,
      requestedBeatCostOverride: coinsToBeatCost(discountedCoins),
      metadata: { scope, imageCount: items.length, provider, estimatedCostUsd },
    });
    if (authorization.status === 'denied') {
      throw new Error('NOT_ENOUGH_COINS');
    }
    if (authorization.status === 'allowed') {
      reservationId = authorization.reservationId ?? null;
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_ENOUGH_COINS') {
      throw new Error('You do not have enough coins to generate these visuals.');
    }
    console.warn('Batch coin authorization skipped:', error instanceof Error ? error.message : error);
  }

  // Create the job + item rows first so a submission failure is recoverable.
  const { data: jobRow, error: jobError } = await admin
    .from('image_batch_jobs')
    .insert({
      user_id: user.id,
      story_id: story.id,
      provider,
      scope,
      status: 'pending',
      display_name: `story-${story.id.slice(0, 8)}-${scope}`,
      item_count: items.length,
      estimated_cost_usd: estimatedCostUsd,
      provider_model_id: batchSnapshot.providerModelId,
      reservation_id: reservationId,
    })
    .select('id')
    .single();
  if (jobError || !jobRow) throw new Error(`Failed to create batch job: ${jobError?.message}`);
  const jobId = jobRow.id as string;

  const itemRows = targetNodes.map((node, index) => ({
    job_id: jobId,
    story_id: story.id,
    node_id: node.id,
    target_kind: task === 'reel_image_generation' ? 'reel_image' : 'beat_image',
    request_key: String(index),
    prompt: beatPrompt(node),
    aspect_ratio: aspectRatio,
    image_size: '1K',
    provider_cost_usd: perImageUsd,
    regular_cost_usd: regularPerImageUsd,
  }));
  const { error: itemsError } = await admin.from('image_batch_items').insert(itemRows);
  if (itemsError) throw new Error(`Failed to create batch items: ${itemsError.message}`);

  try {
    const submission = await submitImageBatchWithProvider(provider, {
      task,
      modelSnapshot: batchSnapshot,
      items,
      displayName: `story-${story.id.slice(0, 8)}`,
    });
    await admin
      .from('image_batch_jobs')
      .update({
        status: 'submitted',
        provider_batch_name: submission.providerBatchName,
        submitted_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + BATCH_RESULT_EXPIRY_HOURS * 3600 * 1000).toISOString(),
      })
      .eq('id', jobId);
    await setBeatsPending(admin, story.id, targetNodes.map((n) => n.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Batch submission failed.';
    await admin.from('image_batch_jobs').update({ status: 'failed', error: message }).eq('id', jobId);
    if (reservationId) {
      await releaseBillableAction({
        userId: user.id,
        reservationId,
        reason: 'batch_submission_failed',
      }).catch(() => {});
    }
    throw new Error(message);
  }

  return {
    jobId,
    itemCount: items.length,
    estimatedCostUsd,
    provider,
    status: 'submitted',
    message: `Submitted ${items.length} image${items.length === 1 ? '' : 's'} for background generation. Ready within ~24h.`,
  };
}

// ---- Reconcile (materialize provider results) ---------------------------

interface BatchJobRow {
  id: string;
  user_id: string;
  story_id: string;
  provider: 'gemini' | 'openai';
  provider_batch_name: string | null;
  provider_model_id: string | null;
  generation_mode: 'batch_api' | 'stateful';
  episodic: boolean;
  last_state: ImageContinuityProviderState | null;
  item_count: number;
  reservation_id: string | null;
}

const BATCH_JOB_SELECT = 'id, user_id, story_id, provider, provider_batch_name, provider_model_id, generation_mode, episodic, last_state, item_count, reservation_id';

interface BatchItemRow {
  id: string;
  node_id: string;
  request_key: string;
  aspect_ratio: string | null;
  provider_cost_usd: number;
  regular_cost_usd: number | null;
  status: string;
}

async function uploadBeatImage(
  admin: AdminClient,
  userId: string,
  storyId: string,
  nodeId: string,
  buffer: Buffer
): Promise<string> {
  const path = `${userId}/${storyId}/${nodeId}/image.webp`;
  const { error } = await admin.storage
    .from(STORY_ASSETS_BUCKET)
    .upload(path, buffer, { contentType: 'image/webp', upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data } = admin.storage.from(STORY_ASSETS_BUCKET).getPublicUrl(path);
  return normalizeStorageUrl(data.publicUrl, STORY_ASSETS_BUCKET);
}

async function applyReadyImagesToStoryMap(
  admin: AdminClient,
  storyId: string,
  readyByNode: Map<string, string>
): Promise<void> {
  if (readyByNode.size === 0) return;
  const { data, error } = await admin.from('stories').select('story_map').eq('id', storyId).single();
  if (error || !data?.story_map) return;
  const map = data.story_map as StoryMap;
  let changed = false;
  for (const [nodeId, url] of readyByNode) {
    const node = map.nodes[nodeId];
    if (!node) continue;
    node.data = { ...node.data, imageUrl: url, imageStatus: 'ready', imageError: undefined };
    changed = true;
  }
  if (changed) {
    await admin.from('stories').update({ story_map: map }).eq('id', storyId);
  }
}

async function recordBatchImageCost(
  admin: AdminClient,
  job: BatchJobRow,
  item: BatchItemRow,
  providerUsage: Record<string, unknown> | undefined
): Promise<void> {
  // Accounting basis is the FULL regular cost; the batch discount is customer-facing.
  // `regular_cost_usd` is persisted per item; fall back to un-discounting the charged
  // amount for older rows created before that column existed.
  const regularCostUsd = item.regular_cost_usd
    ?? Number((item.provider_cost_usd / IMAGE_BATCH_DISCOUNT_MULTIPLIER).toFixed(6));
  const discountedCostUsd = item.provider_cost_usd;
  await admin.from('ai_cost_events').insert({
    user_id: job.user_id,
    story_id: job.story_id,
    node_id: item.node_id,
    activity_key: 'batch_image_generation',
    generation_mode: 'batch',
    task_key: 'image_generation',
    provider: job.provider === 'gemini' ? 'google_gemini' : job.provider,
    model_id: job.provider_model_id ?? `${job.provider}-batch`,
    status: 'success',
    image_count: 1,
    estimated_cost_usd: regularCostUsd,
    metadata: {
      batchId: job.id,
      batchProvider: job.provider,
      discountedCostUsd,
      savingsUsd: Number((regularCostUsd - discountedCostUsd).toFixed(6)),
      imageProviderCostUsd: regularCostUsd,
      ...(providerUsage ? { providerUsage } : {}),
    },
  }).then(({ error }) => {
    if (error) console.error('Failed to record batch image cost event:', error.message);
  });
}

async function reconcileJob(admin: AdminClient, job: BatchJobRow): Promise<void> {
  if (!job.provider_batch_name) return;
  const poll = await pollImageBatchWithProvider(job.provider, job.provider_batch_name);

  if (poll.state === 'running' || poll.state === 'pending') {
    await admin.from('image_batch_jobs').update({ status: 'running' }).eq('id', job.id);
    return;
  }

  if (poll.state === 'failed' || poll.state === 'expired' || poll.state === 'cancelled') {
    await admin.from('image_batch_items')
      .update({ status: 'failed', error: poll.error ?? poll.state })
      .eq('job_id', job.id)
      .in('status', ['pending', 'processing']);
    await admin.from('image_batch_jobs')
      .update({ status: poll.state === 'expired' ? 'expired' : 'failed', error: poll.error ?? poll.state, completed_at: new Date().toISOString() })
      .eq('id', job.id);
    if (job.reservation_id) {
      await releaseBillableAction({
        userId: job.user_id,
        reservationId: job.reservation_id,
        reason: `batch_${poll.state}`,
      }).catch(() => {});
    }
    return;
  }

  // Succeeded: materialize a bounded number of not-yet-ready items this run.
  const { data: pendingItems } = await admin
    .from('image_batch_items')
    .select('id, node_id, request_key, aspect_ratio, provider_cost_usd, regular_cost_usd, status')
    .eq('job_id', job.id)
    .in('status', ['pending', 'processing'])
    .limit(MATERIALIZE_ITEMS_PER_RUN);
  const items = (pendingItems ?? []) as BatchItemRow[];
  const resultByKey = new Map(poll.items.map((r) => [r.requestKey, r]));

  const readyByNode = new Map<string, string>();
  await mapWithConcurrency(items, MATERIALIZE_CONCURRENCY, async (item) => {
    const result = resultByKey.get(item.request_key);
    if (!result || (!result.dataUrl && result.error)) {
      await admin.from('image_batch_items')
        .update({ status: 'failed', error: result?.error ?? 'No result for item.' })
        .eq('id', item.id);
      await admin.from('beats')
        .update({ image_status: 'failed', image_error: result?.error ?? 'Batch produced no image.' })
        .eq('story_id', job.story_id).eq('node_id', item.node_id);
      return;
    }
    if (!result.dataUrl) return;
    try {
      const compressed = await compressImageDataUrlServer({
        dataUrl: result.dataUrl,
        assetType: 'beat_image',
        aspectRatio: item.aspect_ratio ?? undefined,
      });
      const url = await uploadBeatImage(admin, job.user_id, job.story_id, item.node_id, compressed.buffer);
      await admin.from('image_batch_items')
        .update({ status: 'ready', image_url: url, image_storage_key: `${job.user_id}/${job.story_id}/${item.node_id}/image.webp` })
        .eq('id', item.id);
      await admin.from('beats')
        .update({ image_url: url, image_status: 'ready', image_error: null, image_synced_at: new Date().toISOString() })
        .eq('story_id', job.story_id).eq('node_id', item.node_id);
      readyByNode.set(item.node_id, url);
      await recordBatchImageCost(admin, job, item, result.providerUsage);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Materialization failed.';
      await admin.from('image_batch_items').update({ status: 'failed', error: message }).eq('id', item.id);
    }
  });

  await applyReadyImagesToStoryMap(admin, job.story_id, readyByNode);

  // Recompute job rollups; finalize when nothing is left pending.
  const { data: counts } = await admin
    .from('image_batch_items')
    .select('status')
    .eq('job_id', job.id);
  const rows = (counts ?? []) as Array<{ status: string }>;
  const succeeded = rows.filter((r) => r.status === 'ready').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const remaining = rows.length - succeeded - failed;
  const isComplete = remaining === 0;
  await admin.from('image_batch_jobs').update({
    succeeded_count: succeeded,
    failed_count: failed,
    ...(isComplete
      ? { status: failed > 0 ? 'partial' : 'succeeded', completed_at: new Date().toISOString() }
      : { status: 'running' }),
  }).eq('id', job.id);

  // Settle the coin reservation once the job reaches a terminal state.
  if (isComplete && job.reservation_id) {
    if (succeeded > 0) {
      await finalizeBillableAction({
        userId: job.user_id,
        reservationId: job.reservation_id,
        storyId: job.story_id,
        metadata: { succeeded, failed },
      }).catch((error) => console.error('Batch reservation finalize failed:', error));
    } else {
      await releaseBillableAction({
        userId: job.user_id,
        reservationId: job.reservation_id,
        reason: 'batch_no_images',
      }).catch(() => {});
    }
  }
}

/** Poll & materialize a single story's in-flight batch (used on story reopen). */
export async function reconcileStoryBatch(storyId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('image_batch_jobs')
    .select(BATCH_JOB_SELECT)
    .eq('story_id', storyId)
    .in('status', ['submitted', 'running'])
    .order('created_at', { ascending: false });
  for (const job of (data ?? []) as BatchJobRow[]) {
    const runner = job.generation_mode === 'stateful' ? processStatefulJob : reconcileJob;
    await runner(admin, job).catch((error) =>
      console.error(`reconcileStoryBatch failed for job ${job.id}:`, error)
    );
  }
}

/** Scan all in-flight jobs and materialize ready results. Called by the cron route. */
export async function reconcileActiveImageBatches(limit = 10): Promise<{ processed: number }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('image_batch_jobs')
    .select(BATCH_JOB_SELECT)
    .in('status', ['submitted', 'running'])
    .order('created_at', { ascending: true })
    .limit(limit);
  const jobs = (data ?? []) as BatchJobRow[];
  for (const job of jobs) {
    const runner = job.generation_mode === 'stateful' ? processStatefulJob : reconcileJob;
    await runner(admin, job).catch((error) =>
      console.error(`reconcileActiveImageBatches failed for job ${job.id}:`, error)
    );
  }
  return { processed: jobs.length };
}

// ---------------------------------------------------------------------------
// Fast stateful (Path 2): a server-side SEQUENTIAL bulk-visual job. Beats render
// in a provider-stateful thread (Gemini interactions / OpenAI responses) at
// regular price; each image inherits the prior turn's state so characters stay
// consistent without resending references. Runs as a background job (kicked
// immediately, resumed by the reconcile cron) with per-beat streaming.
// ---------------------------------------------------------------------------

// Stop a worker invocation before the serverless request budget; remaining items
// are picked up by a self re-kick and, as a backstop, the reconcile cron.
const STATEFUL_TIME_BUDGET_MS = 240_000;

function bulkVisualBaseUrl(): string {
  const raw = process.env.APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return raw.replace(/\/$/, '');
}

/** Fire-and-forget trigger for the stateful worker route. */
export function kickStatefulWorker(jobId: string): void {
  const secret = process.env.CRON_SECRET;
  void fetch(`${bulkVisualBaseUrl()}/api/batch/generate-stateful`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ jobId }),
  }).catch((error) => console.error('Failed to kick stateful worker:', error));
}

/**
 * Submit a fast stateful sequential bulk-visual job for a story. Regular price
 * (no batch discount); provider-stateful continuity keeps characters consistent.
 */
export async function submitStoryStatefulVisuals(input: {
  storyId: string;
  scope?: ImageBatchScope;
  episodic?: boolean;
}): Promise<SubmitStoryImageBatchResult> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const admin = createAdminClient();
  const story = await loadOwnedStory(admin, input.storyId, user.id);
  const map = story.story_map;
  if (!map || !map.nodes || !map.rootNodeId) throw new Error('Story has no beats to visualise.');

  const config = normalizeStoryConfig(story.story_config);
  const episodic = input.episodic ?? config.episodicCharacters === true;
  const scopeSettings = await getImageBatchScopeSettings();
  const scope = input.scope ? normalizeImageBatchScope(input.scope) : scopeSettings.defaultScope;

  // Stateful chaining is sequential, so process beats in a stable linear order.
  const targetNodes = selectScopeNodes(map, scope)
    .filter(beatNeedsImage)
    .sort((a, b) => a.data.beatNumber - b.data.beatNumber);
  if (targetNodes.length === 0) {
    return {
      jobId: null,
      itemCount: 0,
      estimatedCostUsd: 0,
      provider: 'gemini',
      status: 'noop',
      message: 'All beats in scope already have images.',
    };
  }

  const task = imageTaskForStoryKind(config.storyKind);
  const snapshot = await resolveImageModelSnapshot({
    taskKey: task,
    selection: config.imageModelSelection ?? null,
    currentPlanKey: 'free',
  });
  // Stateful continuity only exists on gemini/openai; other providers still run
  // sequentially but generateSelectedImage will fall back to resend_refs.
  const provider: 'gemini' | 'openai' = snapshot.providerKey === 'openai' ? 'openai' : 'gemini';

  const regularPerImageUsd = estimateImageProviderCostUsd({
    snapshot,
    outputImageCount: 1,
    inputImageCount: 0,
  });
  const estimatedCostUsd = Number((regularPerImageUsd * targetNodes.length).toFixed(6));

  // Reserve coins at the FULL regular rate (stateful gets no batch discount).
  const regularCoins = snapshot.coinCostPerImage * targetNodes.length;
  let reservationId: string | null = null;
  try {
    const authorization = await authorizeBillableAction({
      userId: user.id,
      actionKey: 'batch_image_generation',
      idempotencyKey: `stateful_image_generation:${story.id}:${Date.now()}`,
      relatedStoryId: story.id,
      requestedBeatCostOverride: coinsToBeatCost(regularCoins),
      metadata: { scope, imageCount: targetNodes.length, provider, estimatedCostUsd, generationMode: 'stateful' },
    });
    if (authorization.status === 'denied') {
      throw new Error('NOT_ENOUGH_COINS');
    }
    if (authorization.status === 'allowed') {
      reservationId = authorization.reservationId ?? null;
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_ENOUGH_COINS') {
      throw new Error('You do not have enough coins to generate these visuals.');
    }
    console.warn('Stateful coin authorization skipped:', error instanceof Error ? error.message : error);
  }

  const { data: jobRow, error: jobError } = await admin
    .from('image_batch_jobs')
    .insert({
      user_id: user.id,
      story_id: story.id,
      provider,
      scope,
      // Start as 'running' so the reconcile cron treats it as an in-flight backstop.
      status: 'running',
      generation_mode: 'stateful',
      episodic,
      provider_model_id: snapshot.providerModelId,
      display_name: `story-${story.id.slice(0, 8)}-stateful-${scope}`,
      item_count: targetNodes.length,
      estimated_cost_usd: estimatedCostUsd,
      reservation_id: reservationId,
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (jobError || !jobRow) throw new Error(`Failed to create stateful job: ${jobError?.message}`);
  const jobId = jobRow.id as string;

  const itemRows = targetNodes.map((node, index) => ({
    job_id: jobId,
    story_id: story.id,
    node_id: node.id,
    target_kind: task === 'reel_image_generation' ? 'reel_image' : 'beat_image',
    request_key: String(index),
    sequence_index: index,
    prompt: beatPrompt(node),
    aspect_ratio: config.aspectRatio,
    image_size: '1K',
    provider_cost_usd: regularPerImageUsd,
    regular_cost_usd: regularPerImageUsd,
  }));
  const { error: itemsError } = await admin.from('image_batch_items').insert(itemRows);
  if (itemsError) throw new Error(`Failed to create stateful items: ${itemsError.message}`);

  await setBeatsPending(admin, story.id, targetNodes.map((node) => node.id));
  kickStatefulWorker(jobId);

  return {
    jobId,
    itemCount: targetNodes.length,
    estimatedCostUsd,
    provider,
    status: 'submitted',
    message: 'Fast stateful visuals are generating now.',
  };
}

interface StatefulItemRow {
  id: string;
  node_id: string;
  sequence_index: number | null;
  aspect_ratio: string | null;
  provider_cost_usd: number;
  status: string;
}

/**
 * Process a stateful job's pending beats sequentially, threading provider state
 * from each turn into the next. Bounded by STATEFUL_TIME_BUDGET_MS; re-kicks
 * itself if items remain. Persists per-beat so the client's auto-poll streams.
 */
async function processStatefulJob(admin: AdminClient, job: BatchJobRow): Promise<void> {
  const startedAt = Date.now();
  const { data: storyRow } = await admin
    .from('stories')
    .select('story_map, story_config')
    .eq('id', job.story_id)
    .single();
  const map = storyRow?.story_map as StoryMap | undefined;
  if (!map || !map.nodes) return;
  const config = normalizeStoryConfig((storyRow?.story_config as Partial<StoryConfig> | null) ?? null);
  const task = imageTaskForStoryKind(config.storyKind);
  const visualStyle = deriveVisualStyleSummary(config.visualSettings);

  // Resolve whether the selected model can actually thread state. Providers without
  // stateful support (e.g. groq, and future integrations) resolve to resend_refs —
  // for those we keep continuity by generating character portraits up front and
  // attaching them as references to every beat, just like the batch path.
  const snapshot = await resolveImageModelSnapshot({
    taskKey: task,
    selection: config.imageModelSelection ?? null,
    currentPlanKey: 'free',
  });
  const continuitySettings = await getImageContinuitySettings().catch(() => null);
  const runtimePricing = continuitySettings
    ? getStatefulRuntimePricing(continuitySettings, snapshot.providerKey)
    : null;
  const continuityResolution = resolveImageContinuityStrategy({
    requestedStrategy: 'provider_stateful',
    providerKey: snapshot.providerKey,
    providerStatefulEnabled: runtimePricing?.enabled ?? false,
  });
  const usingResendRefs = continuityResolution.strategy === 'resend_refs';

  // In the resend_refs fallback, ensure portraits exist (needed for continuity on a
  // non-stateful provider) and gather them once to attach to every beat.
  let fallbackReferenceParts: InlineImagePart[] = [];
  if (usingResendRefs) {
    await ensureCharacterPortraits(admin, job.user_id, job.story_id, map, config).catch((error) =>
      console.error('Stateful fallback portrait prep failed:', error)
    );
    const maxRefs = getImageModelMaxReferenceImages(snapshot.capabilities);
    fallbackReferenceParts = await collectReferenceParts(admin, map, maxRefs);
  }

  const { data: pending } = await admin
    .from('image_batch_items')
    .select('id, node_id, sequence_index, aspect_ratio, provider_cost_usd, status')
    .eq('job_id', job.id)
    .in('status', ['pending', 'processing'])
    .order('sequence_index', { ascending: true });
  const items = (pending ?? []) as StatefulItemRow[];

  let previousState: ImageContinuityProviderState | null = job.last_state ?? null;
  const generatedPortraits = new Set<string>();

  for (const item of items) {
    if (Date.now() - startedAt > STATEFUL_TIME_BUDGET_MS) {
      // Ran out of budget; hand off to a fresh invocation.
      kickStatefulWorker(job.id);
      return;
    }
    // Claim the item (pending -> processing) so a concurrent worker/cron pass
    // can't generate the same beat twice. If the claim matches no row, another
    // runner already owns it.
    const { data: claimed } = await admin.from('image_batch_items')
      .update({ status: 'processing' })
      .eq('id', item.id)
      .eq('status', 'pending')
      .select('id');
    if (!claimed || claimed.length === 0) continue;

    const node = map.nodes[item.node_id];
    if (!node) {
      await admin.from('image_batch_items').update({ status: 'failed', error: 'Node missing from story map.' }).eq('id', item.id);
      continue;
    }

    try {
      // Episodic (stateful path only): portrait turns seed the thread and persist
      // reusable refs. In the resend_refs fallback, portraits were already prepared
      // up front and are attached as references instead.
      if (!usingResendRefs && job.episodic) {
        for (const character of node.data.characters ?? []) {
          if (character.referenceSheetUrl || character.portraitUrl || generatedPortraits.has(character.id)) continue;
          const portrait = await generateCharacterPortraitServer({
            character,
            visualStyle,
            portraitReferenceConfig: config.portraitReferences,
            imageModelSelection: config.imageModelSelection ?? null,
            telemetry: {
              activityKey: 'stateful_image_generation',
              generationMode: 'stateful',
              storyId: job.story_id,
              nodeId: item.node_id,
            },
            continuity: { requestedStrategy: 'provider_stateful', previousState, allowRuntimeFallback: true },
          });
          generatedPortraits.add(character.id);
          if (portrait.dataUrl) {
            const refUrl = await uploadCharacterPortrait(admin, job.user_id, job.story_id, character.id, portrait.dataUrl);
            for (const other of Object.values(map.nodes)) {
              other.data = {
                ...other.data,
                characters: (other.data.characters ?? []).map((c) =>
                  c.id === character.id ? { ...c, portraitUrl: refUrl, referenceSheetUrl: refUrl } : c
                ),
              };
            }
          }
          previousState = extractImageContinuityState(portrait.metadata) ?? previousState;
        }
      }

      const result = await generateSelectedImage({
        task,
        prompt: beatPrompt(node),
        aspectRatio: config.aspectRatio,
        imageSize: '1K',
        selection: config.imageModelSelection ?? null,
        // Non-stateful providers keep continuity via these references; on a
        // stateful provider they're ignored in favour of the thread state.
        ...(usingResendRefs ? { referenceParts: fallbackReferenceParts } : {}),
        telemetry: {
          activityKey: 'stateful_image_generation',
          generationMode: 'stateful',
          storyId: job.story_id,
          nodeId: item.node_id,
        },
        continuity: { requestedStrategy: 'provider_stateful', previousState, allowRuntimeFallback: true },
      });
      previousState = extractImageContinuityState(result.metadata) ?? previousState;

      if (!result.dataUrl) {
        await admin.from('image_batch_items').update({ status: 'failed', error: result.fallbackText ?? 'No image generated.' }).eq('id', item.id);
        await admin.from('beats').update({ image_status: 'failed', image_error: 'Stateful generation produced no image.' })
          .eq('story_id', job.story_id).eq('node_id', item.node_id);
        continue;
      }

      const compressed = await compressImageDataUrlServer({
        dataUrl: result.dataUrl,
        assetType: 'beat_image',
        aspectRatio: item.aspect_ratio ?? config.aspectRatio,
      });
      const url = await uploadBeatImage(admin, job.user_id, job.story_id, item.node_id, compressed.buffer);
      await admin.from('image_batch_items')
        .update({ status: 'ready', image_url: url, image_storage_key: `${job.user_id}/${job.story_id}/${item.node_id}/image.webp` })
        .eq('id', item.id);
      await admin.from('beats')
        .update({ image_url: url, image_status: 'ready', image_error: null, image_synced_at: new Date().toISOString() })
        .eq('story_id', job.story_id).eq('node_id', item.node_id);

      // Mutate the map node (image + rolling continuity state) and persist so the
      // client's auto-poll streams this beat immediately.
      node.data = {
        ...node.data,
        imageUrl: url,
        imageStatus: 'ready',
        imageError: undefined,
        imageGenerationMetadata: {
          ...(node.data.imageGenerationMetadata ?? {}),
          ...(previousState ? { statefulContinuity: previousState } : {}),
        },
      };
      await admin.from('stories').update({ story_map: map }).eq('id', job.story_id);
      await admin.from('image_batch_jobs').update({ last_state: previousState }).eq('id', job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stateful beat failed.';
      console.error(`Stateful beat ${item.node_id} failed:`, message);
      await admin.from('image_batch_items').update({ status: 'failed', error: message }).eq('id', item.id);
      await admin.from('beats').update({ image_status: 'failed', image_error: message })
        .eq('story_id', job.story_id).eq('node_id', item.node_id);
    }
  }

  // Roll up and finalize when nothing is left pending.
  const { data: counts } = await admin.from('image_batch_items').select('status').eq('job_id', job.id);
  const rows = (counts ?? []) as Array<{ status: string }>;
  const succeeded = rows.filter((r) => r.status === 'ready').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const pendingLeft = rows.filter((r) => r.status === 'pending').length;
  const processingLeft = rows.filter((r) => r.status === 'processing').length;
  if (pendingLeft > 0) {
    // Real claimable work remains (budget exhausted mid-run); hand off to a fresh pass.
    kickStatefulWorker(job.id);
    return;
  }
  if (processingLeft > 0) {
    // Only items owned by a concurrent runner remain — let that runner finalize;
    // avoid a self-kick loop that would spin on items we can't claim.
    return;
  }
  await admin.from('image_batch_jobs').update({
    succeeded_count: succeeded,
    failed_count: failed,
    status: failed > 0 ? 'partial' : 'succeeded',
    completed_at: new Date().toISOString(),
  }).eq('id', job.id);

  if (job.reservation_id) {
    if (succeeded > 0) {
      await finalizeBillableAction({
        userId: job.user_id,
        reservationId: job.reservation_id,
        storyId: job.story_id,
        metadata: { succeeded, failed, generationMode: 'stateful' },
      }).catch((error) => console.error('Stateful reservation finalize failed:', error));
    } else {
      await releaseBillableAction({
        userId: job.user_id,
        reservationId: job.reservation_id,
        reason: 'stateful_no_images',
      }).catch(() => {});
    }
  }
}

/** Process a single stateful job by id (used by the worker route). */
export async function runStatefulImageJob(jobId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('image_batch_jobs')
    .select(BATCH_JOB_SELECT)
    .eq('id', jobId)
    .eq('generation_mode', 'stateful')
    .in('status', ['pending', 'running'])
    .single();
  if (!data) return;
  await processStatefulJob(admin, data as BatchJobRow);
}
