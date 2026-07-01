'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { InlineImagePart } from '@/app/actions/gemini-proxy';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import { getFeatureFlagValue } from '@/lib/ai/model-config';
import { resolveImageModelSnapshot } from '@/lib/ai/image-models';
import {
  estimateImageProviderCostUsd,
  imageTaskForStoryKind,
  getImageModelMaxReferenceImages,
} from '@/lib/ai/image-models.shared';
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
  type ImageBatchScope,
  type ImageBatchScopeSettings,
} from '@/lib/ai/image-batch.shared';
import { compressImageDataUrlServer, mapWithConcurrency } from '@/lib/media/serverImageCompression';
import { extractStoragePath, normalizeStorageUrl } from '@/lib/supabase/storage';
import { getPathToNode } from '@/lib/utils/story-map';
import type { StoryConfig, StoryMap, StoryNode } from '@/lib/types/story';

const STORY_ASSETS_BUCKET = 'story-assets';
const MATERIALIZE_CONCURRENCY = 4;
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

  const perImageUsd = applyBatchDiscount(
    estimateImageProviderCostUsd({
      snapshot: batchSnapshot,
      outputImageCount: 1,
      inputImageCount: referenceParts.length,
    })
  );
  const estimatedCostUsd = Number((perImageUsd * items.length).toFixed(6));

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
  item_count: number;
}

interface BatchItemRow {
  id: string;
  node_id: string;
  request_key: string;
  aspect_ratio: string | null;
  provider_cost_usd: number;
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
  await admin.from('ai_cost_events').insert({
    user_id: job.user_id,
    story_id: job.story_id,
    node_id: item.node_id,
    activity_key: 'batch_image_generation',
    task_key: 'image_generation',
    provider: job.provider === 'gemini' ? 'google_gemini' : job.provider,
    model_id: null,
    status: 'success',
    image_count: 1,
    estimated_cost_usd: item.provider_cost_usd,
    metadata: {
      batchId: job.id,
      batchProvider: job.provider,
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
    return;
  }

  // Succeeded: materialize a bounded number of not-yet-ready items this run.
  const { data: pendingItems } = await admin
    .from('image_batch_items')
    .select('id, node_id, request_key, aspect_ratio, provider_cost_usd, status')
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
  await admin.from('image_batch_jobs').update({
    succeeded_count: succeeded,
    failed_count: failed,
    ...(remaining === 0
      ? { status: failed > 0 ? 'partial' : 'succeeded', completed_at: new Date().toISOString() }
      : { status: 'running' }),
  }).eq('id', job.id);
}

/** Poll & materialize a single story's in-flight batch (used on story reopen). */
export async function reconcileStoryBatch(storyId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('image_batch_jobs')
    .select('id, user_id, story_id, provider, provider_batch_name, item_count')
    .eq('story_id', storyId)
    .in('status', ['submitted', 'running'])
    .order('created_at', { ascending: false });
  for (const job of (data ?? []) as BatchJobRow[]) {
    await reconcileJob(admin, job).catch((error) =>
      console.error(`reconcileStoryBatch failed for job ${job.id}:`, error)
    );
  }
}

/** Scan all in-flight jobs and materialize ready results. Called by the cron route. */
export async function reconcileActiveImageBatches(limit = 10): Promise<{ processed: number }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('image_batch_jobs')
    .select('id, user_id, story_id, provider, provider_batch_name, item_count')
    .in('status', ['submitted', 'running'])
    .order('created_at', { ascending: true })
    .limit(limit);
  const jobs = (data ?? []) as BatchJobRow[];
  for (const job of jobs) {
    await reconcileJob(admin, job).catch((error) =>
      console.error(`reconcileActiveImageBatches failed for job ${job.id}:`, error)
    );
  }
  return { processed: jobs.length };
}
