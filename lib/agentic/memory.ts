import 'server-only';

// ── Agentic Creator: story memory, server half ─────────────────────────
//
// Reads and writes agent_story_memory / agent_novelty_checks (migration 105)
// and agent_persona_memory (migration 103). All scoring lives in the pure
// sibling memory.shared.ts; this file fetches candidates, calls the adjudicator
// when the deterministic score is ambiguous, and records what was decided.
//
// FAILS CLOSED. While migration 105 is unapplied, every read here returns empty
// and runNoveltyCheck() degrades to a `clear` verdict carrying an explanatory
// reason. Memory being unavailable must never block story generation — a
// missing novelty check is a lost safeguard, not a broken pipeline, and the
// human review gate still stands behind it.

import { createAdminClient } from '@/lib/supabase/admin';
import { getModelConfig, getFeatureFlagValue, setFeatureFlagValue } from '@/lib/ai/model-config';
import { callGeminiAgenticJson } from '@/app/actions/gemini-proxy';
import { CHARACTER_NAME_HISTORY_LIMIT } from '@/lib/ai/character-novelty.shared';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import {
  NOVELTY_PRIOR_FETCH_LIMIT,
  buildNoveltyAdjudicationPrompt,
  isMissingMemorySchemaError,
  applyAdjudication,
  needsModelAdjudication,
  scoreNovelty,
  type NoveltyCandidate,
  type NoveltyPrior,
  type NoveltyScoreResult,
  type NoveltyStage,
  type NoveltyVerdict,
} from '@/lib/agentic/memory.shared';

/** Cursor for the resumable backfill. A flag value row, not a new table. */
const BACKFILL_CURSOR_FLAG = 'agentic_memory_backfill_cursor';

/** Caps on the persona memory arrays. Reuses the proven character cap. */
const PERSONA_TITLE_HISTORY_LIMIT = 50;
const PERSONA_THEME_HISTORY_LIMIT = 50;

// One latch per migration group (GOTCHAS). Logged once, then quiet: an
// unapplied migration is a steady state, not an incident to log per request.
let memorySchemaUnavailable = false;
function latchMemorySchemaUnavailable(context: string): void {
  if (!memorySchemaUnavailable) {
    memorySchemaUnavailable = true;
    console.warn(
      `[agentic-memory] agent_story_memory/agent_novelty_checks unavailable (${context}); ` +
        'migration 105 is not applied on this database. Novelty checks will report `clear` until it is.'
    );
  }
}

export interface StoryMemoryEntry {
  storyId?: string | null;
  storylineId?: string | null;
  personaId?: string | null;
  title: string;
  premise?: string;
  summary?: string;
  language?: string | null;
  ageGroup?: string | null;
  genre?: string | null;
  themes?: string[];
  characterNames?: string[];
  settingSummary?: string | null;
  seriesId?: string | null;
  episodeNumber?: number | null;
  origin?: 'agent' | 'human_backfill';
}

interface MemoryRow {
  id: string;
  title: string | null;
  premise: string | null;
  themes: string[] | null;
  character_names: string[] | null;
  setting_summary: string | null;
  series_id: string | null;
  episode_number: number | null;
}

function rowToPrior(row: MemoryRow): NoveltyPrior {
  return {
    id: row.id,
    title: row.title ?? '',
    premise: row.premise ?? '',
    themes: row.themes ?? [],
    characterNames: row.character_names ?? [],
    settingSummary: row.setting_summary,
    seriesId: row.series_id,
    episodeNumber: row.episode_number,
  };
}

/**
 * Fetches the priors a candidate is scored against: one query, scoped to the
 * same language and age group, newest first.
 *
 * Scope note: narrowing by language and age group is what keeps this to a
 * single indexed read (idx_agent_story_memory_scope) instead of scanning the
 * whole catalogue. It also matches the editorial question being asked — a Hindi
 * story for three-year-olds is not made derivative by an English teen thriller.
 * Sibling episodes of the candidate's own series are fetched too, because
 * scoreNovelty needs to see them in order to suppress the right signals.
 */
export async function findSimilarStories(
  candidate: NoveltyCandidate,
  limit: number = NOVELTY_PRIOR_FETCH_LIMIT
): Promise<NoveltyPrior[]> {
  if (memorySchemaUnavailable) return [];

  try {
    const supabase = createAdminClient();
    let query = supabase
      .from('agent_story_memory')
      .select('id, title, premise, themes, character_names, setting_summary, series_id, episode_number')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (candidate.language) query = query.eq('language', candidate.language);
    if (candidate.ageGroup) query = query.eq('age_group', candidate.ageGroup);

    const { data, error } = await query;
    if (error) {
      if (isMissingMemorySchemaError(error)) {
        latchMemorySchemaUnavailable('findSimilarStories');
        return [];
      }
      throw new Error(`Failed to read story memory: ${error.message}`);
    }

    return (data ?? []).map((row) => rowToPrior(row as MemoryRow));
  } catch (error) {
    if (isMissingMemorySchemaError(error as { code?: string })) {
      latchMemorySchemaUnavailable('findSimilarStories');
      return [];
    }
    throw error;
  }
}

/** Appends one story to global memory. Silently no-ops when 105 is unapplied. */
export async function recordStoryMemory(entry: StoryMemoryEntry): Promise<void> {
  if (memorySchemaUnavailable) return;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('agent_story_memory').insert({
      story_id: entry.storyId ?? null,
      storyline_id: entry.storylineId ?? null,
      persona_id: entry.personaId ?? null,
      title: entry.title,
      premise: entry.premise ?? '',
      summary: entry.summary ?? '',
      language: entry.language ?? null,
      age_group: entry.ageGroup ?? null,
      genre: entry.genre ?? null,
      themes: entry.themes ?? [],
      character_names: entry.characterNames ?? [],
      setting_summary: entry.settingSummary ?? null,
      series_id: entry.seriesId ?? null,
      episode_number: entry.episodeNumber ?? null,
      origin: entry.origin ?? 'agent',
    });

    if (error) {
      if (isMissingMemorySchemaError(error)) {
        latchMemorySchemaUnavailable('recordStoryMemory');
        return;
      }
      throw new Error(`Failed to record story memory: ${error.message}`);
    }
  } catch (error) {
    if (isMissingMemorySchemaError(error as { code?: string })) {
      latchMemorySchemaUnavailable('recordStoryMemory');
      return;
    }
    throw error;
  }
}

function appendCapped(existing: string[] | null, incoming: string[], cap: number): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...incoming, ...(existing ?? [])]) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
    if (merged.length >= cap) break;
  }
  return merged;
}

/**
 * Folds one story into a persona's own memory. Newest entries lead, duplicates
 * collapse, and each array is capped so the row cannot grow without bound.
 * The character-name cap reuses CHARACTER_NAME_HISTORY_LIMIT rather than
 * inventing a second number for the same idea.
 */
export async function updatePersonaMemory(personaId: string, entry: StoryMemoryEntry): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { data, error: readError } = await supabase
      .from('agent_persona_memory')
      .select('recent_titles, recent_premises, character_names, settings_used, themes_used, story_count')
      .eq('persona_id', personaId)
      .maybeSingle();

    if (readError) {
      if (isMissingMemorySchemaError(readError)) return;
      throw new Error(`Failed to read persona memory: ${readError.message}`);
    }
    if (!data) return; // Trigger from migration 103 creates this row; nothing to do if the persona is gone.

    const { error: writeError } = await supabase
      .from('agent_persona_memory')
      .update({
        recent_titles: appendCapped(data.recent_titles, [entry.title], PERSONA_TITLE_HISTORY_LIMIT),
        recent_premises: appendCapped(data.recent_premises, entry.premise ? [entry.premise] : [], PERSONA_TITLE_HISTORY_LIMIT),
        character_names: appendCapped(data.character_names, entry.characterNames ?? [], CHARACTER_NAME_HISTORY_LIMIT),
        settings_used: appendCapped(data.settings_used, entry.settingSummary ? [entry.settingSummary] : [], PERSONA_THEME_HISTORY_LIMIT),
        themes_used: appendCapped(data.themes_used, entry.themes ?? [], PERSONA_THEME_HISTORY_LIMIT),
        story_count: (data.story_count ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('persona_id', personaId);

    if (writeError) {
      if (isMissingMemorySchemaError(writeError)) return;
      throw new Error(`Failed to update persona memory: ${writeError.message}`);
    }
  } catch (error) {
    if (isMissingMemorySchemaError(error as { code?: string })) return;
    throw error;
  }
}

export interface NoveltyCheckContext {
  taskId?: string | null;
  runId?: string | null;
  personaId?: string | null;
  telemetry?: CostTelemetryContext;
}

export interface NoveltyCheckResult extends NoveltyScoreResult {
  stage: NoveltyStage;
  /** True when the economy-tier model was consulted for this verdict. */
  adjudicated: boolean;
}

async function adjudicate(
  candidate: NoveltyCandidate,
  scored: NoveltyScoreResult,
  telemetry?: CostTelemetryContext
): Promise<{ verdict: NoveltyVerdict; reason: string } | null> {
  try {
    const config = await getModelConfig('agent_novelty_assessment');
    const raw = await callGeminiAgenticJson({
      task: 'agent_novelty_assessment',
      model: config.model,
      prompt: buildNoveltyAdjudicationPrompt(candidate, scored.topCandidates),
      temperature: config.temperature ?? 0.2,
      telemetry,
    });

    const parsed = JSON.parse(raw) as { verdict?: string; reason?: string };
    if (parsed.verdict === 'clear' || parsed.verdict === 'warn' || parsed.verdict === 'block') {
      return { verdict: parsed.verdict, reason: parsed.reason?.trim() || 'Model adjudication returned no reason.' };
    }
    return null;
  } catch {
    // An adjudication failure must never fail the run. The deterministic
    // verdict already stands on its own; this call only refines it.
    return null;
  }
}

/**
 * Runs a novelty check and records it.
 *
 * Deterministic scoring decides first. The model is consulted only when the
 * score lands in the ambiguous band, and its answer can move the verdict in
 * either direction — it exists to rescue a legitimate story the thresholds
 * were about to flag, as much as to catch a duplicate they were about to pass.
 *
 * Every verdict is written to agent_novelty_checks, `clear` included. A reviewer
 * asking "why was this allowed through" deserves an answer as much as one
 * asking why something was blocked.
 */
export async function runNoveltyCheck(
  stage: NoveltyStage,
  candidate: NoveltyCandidate,
  context: NoveltyCheckContext = {}
): Promise<NoveltyCheckResult> {
  const priors = await findSimilarStories(candidate);

  if (memorySchemaUnavailable) {
    return {
      stage,
      adjudicated: false,
      verdict: 'clear',
      score: 0,
      reasons: ['Story memory is unavailable (migration 105 not applied); novelty could not be checked.'],
      topCandidates: [],
    };
  }

  const scored = scoreNovelty({ candidate, priors });
  let verdict = scored.verdict;
  const reasons = [...scored.reasons];
  let adjudicated = false;

  if (needsModelAdjudication(scored.score)) {
    const judgement = await adjudicate(candidate, scored, context.telemetry);
    if (judgement) {
      adjudicated = true;
      // applyAdjudication lets the model DOWNGRADE the deterministic verdict but
      // never escalate it -- see its doc comment for the measured behaviour that
      // forced this. When it tries to escalate we keep the deterministic verdict
      // and say so in `reasons`, so the record shows both what the model claimed
      // and that it did not decide the outcome.
      verdict = applyAdjudication(scored.verdict, judgement.verdict);
      reasons.push(`Model adjudication (${judgement.verdict}): ${judgement.reason}`);
      if (verdict !== judgement.verdict) {
        reasons.push(
          `Adjudication not applied: a model may soften the deterministic verdict ('${scored.verdict}'), never harden it.`
        );
      }
    }
  }

  const result: NoveltyCheckResult = { ...scored, stage, adjudicated, verdict, reasons };

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('agent_novelty_checks').insert({
      task_id: context.taskId ?? null,
      run_id: context.runId ?? null,
      persona_id: context.personaId ?? null,
      stage,
      verdict,
      top_score: Number(scored.score.toFixed(4)),
      reasons,
      candidates: scored.topCandidates,
    });
    if (error && isMissingMemorySchemaError(error)) latchMemorySchemaUnavailable('runNoveltyCheck');
    else if (error) console.warn(`[agentic-memory] failed to record novelty check: ${error.message}`);
  } catch (error) {
    // Recording is an audit concern; losing the row must not fail the check.
    console.warn('[agentic-memory] failed to record novelty check', error);
  }

  return result;
}

// ── Backfill ───────────────────────────────────────────────────────────

export interface BackfillResult {
  processed: number;
  inserted: number;
  cursor: string | null;
  done: boolean;
}

/**
 * Seeds global memory from already-published storylines, so the very first
 * agent story is checked against the real catalogue rather than an empty table.
 *
 * Resumable: the cursor is the last processed created_at, kept in a feature-flag
 * value row rather than a new table. Idempotent: a storyline already present in
 * memory is skipped, so re-running cannot duplicate. Pausable: clear the flag
 * value to restart, or simply stop calling it — no state is left mid-flight.
 */
export async function backfillStoryMemoryFromStorylines(batchSize = 50): Promise<BackfillResult> {
  const supabase = createAdminClient();
  const cursor = await getFeatureFlagValue(BACKFILL_CURSOR_FLAG);

  let query = supabase
    .from('storylines')
    .select('id, story_id, title, discovery_intro, age_group, genre, series_id, episode_number, created_at')
    .eq('is_public', true)
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (cursor) query = query.gt('created_at', cursor);

  const { data, error } = await query;
  if (error) throw new Error(`Backfill failed to read storylines: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return { processed: 0, inserted: 0, cursor, done: true };

  const ids = rows.map((row) => row.id as string);
  const { data: existing } = await supabase
    .from('agent_story_memory')
    .select('storyline_id')
    .in('storyline_id', ids);
  const alreadyPresent = new Set((existing ?? []).map((row) => row.storyline_id as string));

  const pending = rows.filter((row) => !alreadyPresent.has(row.id as string));

  if (pending.length > 0) {
    const { error: insertError } = await supabase.from('agent_story_memory').insert(
      pending.map((row) => ({
        story_id: (row.story_id as string) ?? null,
        storyline_id: row.id as string,
        persona_id: null,
        title: (row.title as string) ?? '',
        premise: (row.discovery_intro as string) ?? '',
        summary: (row.discovery_intro as string) ?? '',
        language: null,
        age_group: (row.age_group as string) ?? null,
        genre: (row.genre as string) ?? null,
        themes: [],
        character_names: [],
        setting_summary: null,
        series_id: (row.series_id as string) ?? null,
        episode_number: (row.episode_number as number) ?? null,
        origin: 'human_backfill' as const,
      }))
    );
    if (insertError) throw new Error(`Backfill failed to write memory: ${insertError.message}`);
  }

  const nextCursor = rows[rows.length - 1].created_at as string;
  await setFeatureFlagValue(BACKFILL_CURSOR_FLAG, nextCursor);

  return {
    processed: rows.length,
    inserted: pending.length,
    cursor: nextCursor,
    done: rows.length < batchSize,
  };
}

/** Clears the backfill cursor so the next run starts from the beginning. */
export async function resetStoryMemoryBackfillCursor(): Promise<void> {
  await setFeatureFlagValue(BACKFILL_CURSOR_FLAG, '');
}
