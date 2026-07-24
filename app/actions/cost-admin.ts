'use server';

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { RECENT_BEAT_LIMIT_OPTIONS, DEFAULT_RECENT_BEAT_LIMIT } from '@/lib/admin/cost-config';
import type { DbAiCostEvent, DbBeat, DbStory } from '@/lib/types/database';

const INR_PER_USD = 93;
const DAILY_WINDOW_DAYS = 14;

interface CostBreakdownItem {
  taskKey: string;
  estimatedCostUsd: number;
  runtimeCostUsd: number;
  imageCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  imageCount: number;
  audioSeconds: number;
  models: string[];
  providers: string[];
  strategies: string[];
  fallbacks: string[];
  generationModes: string[];
}

export interface AdminCostBeatRow {
  beatId: string;
  storyId: string;
  nodeId: string;
  beatNumber: number;
  title: string;
  generatedAt: string;
  userId: string | null;
  userLabel: string;
  storyTitle: string;
  storyHref: string;
  storylineId: string | null;
  storylineTitle: string | null;
  storylineHref: string | null;
  totalCostUsd: number;
  totalCostInr: number;
  eventCount: number;
  breakdown: CostBreakdownItem[];
}

export interface AdminDailyActivityCostRow {
  day: string;
  activityKey: string;
  estimatedCostUsd: number;
  estimatedCostInr: number;
  eventCount: number;
  beatCount: number;
}

export interface AdminCostDashboardData {
  inrPerUsd: number;
  dailyWindowDays: number;
  userFilterId: string | null;
  recentBeatsLimit: number;
  totalWindowCostUsd: number;
  totalWindowCostInr: number;
  recentBeats: AdminCostBeatRow[];
  dailyActivity: AdminDailyActivityCostRow[];
}

type StorylineLinkRow = {
  beat_id: string;
  storyline_id: string;
  storylines?: {
    id: string;
    title: string;
    is_public: boolean;
  } | null;
};

function asCost(value: unknown): number {
  return Number(value) || 0;
}

function toInr(usd: number): number {
  return usd * INR_PER_USD;
}

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function groupBreakdown(events: DbAiCostEvent[]): CostBreakdownItem[] {
  const byTask = new Map<string, CostBreakdownItem>();
  for (const event of events) {
    const current = byTask.get(event.task_key) || {
      taskKey: event.task_key,
      estimatedCostUsd: 0,
      runtimeCostUsd: 0,
      imageCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      imageCount: 0,
      audioSeconds: 0,
      models: [],
      providers: [],
      strategies: [],
      fallbacks: [],
      generationModes: [],
    };
    const metadata = event.metadata || {};
    current.estimatedCostUsd += asCost(event.estimated_cost_usd);
    current.runtimeCostUsd += asCost(metadata.statefulRuntimeCostUsd);
    current.imageCostUsd += asCost(metadata.imageProviderCostUsd);
    current.inputTokens += event.input_tokens || 0;
    current.outputTokens += event.output_tokens || 0;
    current.cachedTokens += Number(metadata.cachedTokens) || 0;
    current.imageCount += event.image_count || 0;
    current.audioSeconds += asCost(event.audio_seconds);
    if (!current.models.includes(event.model_id)) {
      current.models.push(event.model_id);
    }
    const providerModelLabel = event.provider ? `${event.provider}:${event.model_id}` : event.model_id;
    if (!current.providers.includes(providerModelLabel)) {
      current.providers.push(providerModelLabel);
    }
    const strategy = typeof metadata.continuityStrategy === 'string'
      ? metadata.continuityStrategy
      : null;
    if (strategy && !current.strategies.includes(strategy)) {
      current.strategies.push(strategy);
    }
    const fallback = typeof metadata.fallbackReason === 'string' && metadata.fallbackReason
      ? metadata.fallbackReason
      : typeof metadata.fallbackStrategy === 'string' && metadata.fallbackStrategy
      ? metadata.fallbackStrategy
      : null;
    if (fallback && !current.fallbacks.includes(fallback)) {
      current.fallbacks.push(fallback);
    }
    const generationMode = typeof event.generation_mode === 'string' && event.generation_mode
      ? event.generation_mode
      : 'regular';
    if (!current.generationModes.includes(generationMode)) {
      current.generationModes.push(generationMode);
    }
    byTask.set(event.task_key, current);
  }

  return Array.from(byTask.values())
    .map((item) => ({
      ...item,
      estimatedCostUsd: Number(item.estimatedCostUsd.toFixed(6)),
      runtimeCostUsd: Number(item.runtimeCostUsd.toFixed(6)),
      imageCostUsd: Number(item.imageCostUsd.toFixed(6)),
    }))
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
}

export async function getCostDashboardData(input?: { userId?: string | null; limit?: number }): Promise<AdminCostDashboardData> {
  await verifyAdmin();
  const admin = createAdminClient();

  const since = new Date(Date.now() - DAILY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const userFilterId = input?.userId?.trim() || null;
  const requestedLimit = input?.limit ?? DEFAULT_RECENT_BEAT_LIMIT;
  const beatLimit = (RECENT_BEAT_LIMIT_OPTIONS as readonly number[]).includes(requestedLimit)
    ? requestedLimit
    : DEFAULT_RECENT_BEAT_LIMIT;

  let beatsQuery = admin
    .from('beats')
    .select('id, story_id, node_id, beat_number, title, generated_by, created_at')
    .order('created_at', { ascending: false })
    .limit(beatLimit);

  let dailyEventsQuery = admin
    .from('ai_cost_events')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (userFilterId) {
    beatsQuery = beatsQuery.eq('generated_by', userFilterId);
    dailyEventsQuery = dailyEventsQuery.eq('user_id', userFilterId);
  }

  const [{ data: beatRows, error: beatError }, { data: dailyEvents, error: dailyError }] = await Promise.all([
    beatsQuery,
    dailyEventsQuery,
  ]);

  if (beatError) throw new Error(`Failed to load recent beats: ${beatError.message}`);
  if (dailyError) throw new Error(`Failed to load cost events: ${dailyError.message}`);

  const beats = (beatRows || []) as Pick<DbBeat, 'id' | 'story_id' | 'node_id' | 'beat_number' | 'title' | 'generated_by' | 'created_at'>[];
  const events = (dailyEvents || []) as DbAiCostEvent[];
  const storyIds = Array.from(new Set(beats.map((beat) => beat.story_id).filter(Boolean)));
  const beatIds = beats.map((beat) => beat.id);
  const userIds = Array.from(new Set(beats.map((beat) => beat.generated_by).filter(Boolean))) as string[];
  const nodeIds = Array.from(new Set(beats.map((beat) => beat.node_id).filter(Boolean)));

  const [storiesResult, profilesResult, linksResult, beatCostResult] = await Promise.all([
    storyIds.length
      ? admin.from('stories').select('id, title, user_id').in('id', storyIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? admin.from('profiles').select('id, display_name').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    beatIds.length
      ? admin
          .from('storyline_beats')
          .select('beat_id, storyline_id, storylines(id, title, is_public)')
          .in('beat_id', beatIds)
      : Promise.resolve({ data: [], error: null }),
    storyIds.length && nodeIds.length
      ? admin
          .from('ai_cost_events')
          .select('*')
          .in('story_id', storyIds)
          .in('node_id', nodeIds)
          .order('created_at', { ascending: false })
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (storiesResult.error) throw new Error(`Failed to load story links: ${storiesResult.error.message}`);
  if (profilesResult.error) throw new Error(`Failed to load users: ${profilesResult.error.message}`);
  if (linksResult.error) throw new Error(`Failed to load storyline links: ${linksResult.error.message}`);
  if (beatCostResult.error) throw new Error(`Failed to load beat costs: ${beatCostResult.error.message}`);

  const storiesById = new Map(
    ((storiesResult.data || []) as Pick<DbStory, 'id' | 'title' | 'user_id'>[]).map((story) => [story.id, story])
  );
  const profileById = new Map(
    ((profilesResult.data || []) as { id: string; display_name: string | null }[]).map((profile) => [profile.id, profile])
  );
  const storylineByBeatId = new Map<string, StorylineLinkRow>();
  for (const row of (linksResult.data || []) as StorylineLinkRow[]) {
    if (!storylineByBeatId.has(row.beat_id)) {
      storylineByBeatId.set(row.beat_id, row);
    }
  }

  const costEvents = ((beatCostResult.data || []) as DbAiCostEvent[])
    .filter((event) => event.story_id && event.node_id);
  const costsByBeatKey = new Map<string, DbAiCostEvent[]>();
  for (const event of costEvents) {
    const key = `${event.story_id}:${event.node_id}`;
    const current = costsByBeatKey.get(key) || [];
    current.push(event);
    costsByBeatKey.set(key, current);
  }

  const recentBeats = beats.map((beat) => {
    const story = storiesById.get(beat.story_id);
    const userId = beat.generated_by || story?.user_id || null;
    const profile = userId ? profileById.get(userId) : null;
    const beatEvents = costsByBeatKey.get(`${beat.story_id}:${beat.node_id}`) || [];
    const totalCostUsd = beatEvents.reduce((sum, event) => sum + asCost(event.estimated_cost_usd), 0);
    const storyline = storylineByBeatId.get(beat.id);

    return {
      beatId: beat.id,
      storyId: beat.story_id,
      nodeId: beat.node_id,
      beatNumber: beat.beat_number,
      title: beat.title,
      generatedAt: beat.created_at,
      userId,
      userLabel: profile?.display_name || userId || 'Unknown user',
      storyTitle: story?.title || 'Untitled story',
      storyHref: `/story/${beat.story_id}`,
      storylineId: storyline?.storyline_id || null,
      storylineTitle: storyline?.storylines?.title || null,
      storylineHref: storyline?.storyline_id ? `/storyline/${storyline.storyline_id}` : null,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      totalCostInr: Number(toInr(totalCostUsd).toFixed(2)),
      eventCount: beatEvents.length,
      breakdown: groupBreakdown(beatEvents),
    };
  });

  const dailyByKey = new Map<string, AdminDailyActivityCostRow & { beatKeys: Set<string> }>();
  for (const event of events) {
    const day = dayKey(event.created_at);
    const key = `${day}:${event.activity_key}`;
    const current = dailyByKey.get(key) || {
      day,
      activityKey: event.activity_key,
      estimatedCostUsd: 0,
      estimatedCostInr: 0,
      eventCount: 0,
      beatCount: 0,
      beatKeys: new Set<string>(),
    };
    current.estimatedCostUsd += asCost(event.estimated_cost_usd);
    current.eventCount += 1;
    if (event.story_id && event.node_id) {
      current.beatKeys.add(`${event.story_id}:${event.node_id}`);
    }
    dailyByKey.set(key, current);
  }

  const dailyActivity = Array.from(dailyByKey.values())
    .map((row) => ({
      day: row.day,
      activityKey: row.activityKey,
      estimatedCostUsd: Number(row.estimatedCostUsd.toFixed(6)),
      estimatedCostInr: Number(toInr(row.estimatedCostUsd).toFixed(2)),
      eventCount: row.eventCount,
      beatCount: row.beatKeys.size,
    }))
    .sort((a, b) => (a.day === b.day ? b.estimatedCostUsd - a.estimatedCostUsd : b.day.localeCompare(a.day)));

  const totalWindowCostUsd = events.reduce((sum, event) => sum + asCost(event.estimated_cost_usd), 0);

  return {
    inrPerUsd: INR_PER_USD,
    dailyWindowDays: DAILY_WINDOW_DAYS,
    userFilterId,
    recentBeatsLimit: beatLimit,
    totalWindowCostUsd: Number(totalWindowCostUsd.toFixed(6)),
    totalWindowCostInr: Number(toInr(totalWindowCostUsd).toFixed(2)),
    recentBeats,
    dailyActivity,
  };
}
