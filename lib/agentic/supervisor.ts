import 'server-only';

// ── Agentic Creator: Editorial Supervisor, server half ─────────────────
//
// Reads agent_personas (103), storylines/stories (always present), agent_story_memory
// (105), and agent_tasks (106); calls the planning model when there is something worth
// asking it about; writes agent_tasks rows. All the logic that decides what a gap IS and
// whether a model-proposed commission is trustworthy lives in the pure sibling
// supervisor.shared.ts; this file only fetches, calls, and persists.
//
// FAILS CLOSED for its own migration group (106): while it is unapplied, listAgentTasks/
// getAgentTask degrade to empty/null and every write throws a clear "not applied yet"
// message rather than a raw Postgres error, via the same single-latch pattern as
// lib/agentic/memory.ts's latchMemorySchemaUnavailable. buildCatalogueCoverage also fails
// closed for the OTHER migration groups it reads (103, 105) by reusing THEIR OWN
// classifiers (isMissingPersonaSchemaError, isMissingMemorySchemaError) rather than a
// borrowed or shared latch — per GOTCHAS.md, latches are one per migration group, never
// reused across groups, and that applies to which classifier decides "is this table
// missing" just as much as to the boolean flag that remembers it.
//
// A missing/degraded schema anywhere in this chain must never surface as a 500: coverage
// degrades to an empty gap list, and an empty gap list is exactly the input that makes
// proposeCommissions() skip the model call entirely (see its own comment below).

import { createAdminClient } from '@/lib/supabase/admin';
import { getModelConfig } from '@/lib/ai/model-config';
import { callGeminiAgenticJson } from '@/app/actions/gemini-proxy';
import { isMissingPersonaSchemaError, type AgentPersonaStatus } from '@/lib/agentic/personas.shared';
import { isMissingMemorySchemaError } from '@/lib/agentic/memory.shared';
import {
  GAP_SHORTLIST_SIZE,
  MAX_COMMISSIONS_PER_TICK,
  buildCoverageMatrix,
  buildSupervisorPlanningPrompt,
  isMissingTaskSchemaError,
  rankCoverageGaps,
  validateCommissionProposals,
  type CommissionProposal,
  type CoverageGap,
  type CoverageRow,
  type RejectedCommission,
  type SupervisorPersona,
} from '@/lib/agentic/supervisor.shared';

const TASK_SCHEMA_UNAVAILABLE_MESSAGE =
  'Task storage is not available yet — migration 106 has not been applied to this environment.';

// One latch for migration 106 alone (GOTCHAS: latches are one per migration group).
// Logged once, then quiet: an unapplied migration is a steady state, not an incident.
let taskSchemaUnavailable = false;
function latchTaskSchemaUnavailable(context: string): void {
  if (!taskSchemaUnavailable) {
    taskSchemaUnavailable = true;
    console.warn(
      `[agentic-supervisor] agent_tasks unavailable (${context}); migration 106 is not applied on this database. ` +
        'Reads will report empty and writes will throw until it is.'
    );
  }
}

function isTaskSchemaMissing(error: unknown): boolean {
  return isMissingTaskSchemaError(error as { code?: string; message?: string } | null | undefined);
}

// ── Row shapes ─────────────────────────────────────────────────────────

interface PersonaCoverageRow {
  id: string;
  slug: string;
  status: AgentPersonaStatus;
  language: string;
  age_group: string;
  genres: string[] | null;
}

function rowToPersona(row: PersonaCoverageRow): SupervisorPersona {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    // Cast, not validate: agent_personas.language/age_group are admin-authored and
    // constrained at creation time (see agentic-personas.ts), so a raw DB row is
    // trusted here exactly like mapRowToPersona's own `as AgentPersona['language']`.
    language: row.language as SupervisorPersona['language'],
    ageGroup: row.age_group as SupervisorPersona['ageGroup'],
    genres: row.genres ?? [],
  };
}

interface StorylineCoverageRow {
  age_group: string | null;
  genre: string | null;
  stories: { story_config: Record<string, unknown> | null } | null;
}

interface MemoryCoverageRow {
  language: string | null;
  age_group: string | null;
  genre: string | null;
}

export type AgentTaskOrigin = 'supervisor' | 'admin' | 'schedule' | 'test_lab';
export type AgentTaskStatus =
  | 'commissioned'
  | 'assigned'
  | 'running'
  | 'awaiting_review'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'failed'
  | 'cancelled';

/** Mirrors public.agent_tasks (migration 106), camelCased. */
export interface AgentTask {
  id: string;
  personaId: string | null;
  origin: AgentTaskOrigin;
  status: AgentTaskStatus;
  brief: string;
  rationale: string | null;
  language: string;
  ageGroup: string;
  genre: string | null;
  targetBeatCount: number | null;
  seriesId: string | null;
  constraints: Record<string, unknown>;
  storyId: string | null;
  isTest: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AgentTaskRow {
  id: string;
  persona_id: string | null;
  origin: AgentTaskOrigin;
  status: AgentTaskStatus;
  brief: string;
  rationale: string | null;
  language: string;
  age_group: string;
  genre: string | null;
  target_beat_count: number | null;
  series_id: string | null;
  constraints: Record<string, unknown> | null;
  story_id: string | null;
  is_test: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(row: AgentTaskRow): AgentTask {
  return {
    id: row.id,
    personaId: row.persona_id,
    origin: row.origin,
    status: row.status,
    brief: row.brief,
    rationale: row.rationale,
    language: row.language,
    ageGroup: row.age_group,
    genre: row.genre,
    targetBeatCount: row.target_beat_count,
    seriesId: row.series_id,
    constraints: row.constraints ?? {},
    storyId: row.story_id,
    isTest: row.is_test,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Active personas (shared by coverage + commissioning) ───────────────

async function fetchActivePersonas(): Promise<SupervisorPersona[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('agent_personas')
    .select('id, slug, status, language, age_group, genres')
    .eq('status', 'active');

  if (error) {
    if (isMissingPersonaSchemaError(error)) return [];
    throw new Error(`Failed to read agent_personas for the supervisor: ${error.message}`);
  }

  return (data ?? []).map((row) => rowToPersona(row as PersonaCoverageRow));
}

// ── Coverage ───────────────────────────────────────────────────────────

/**
 * Builds the ranked coverage gaps the supervisor plans against: published
 * storylines (language via a join to stories.story_config, since storylines has
 * no language column of its own) plus agent_story_memory as the agent-authored
 * side, crossed against active personas. Returns [] when there are no active
 * personas at all -- today's real state, per the 15 draft seeds -- without
 * bothering to query the catalogue, since no cell could be servable anyway.
 */
export async function buildCatalogueCoverage(): Promise<CoverageGap[]> {
  try {
    const personas = await fetchActivePersonas();
    if (personas.length === 0) return [];

    const supabase = createAdminClient();

    const { data: storylineRows, error: storylineError } = await supabase
      .from('storylines')
      .select('age_group, genre, stories!inner(story_config)')
      .eq('is_public', true)
      .in('moderation_status', ['none', 'approved']);

    if (storylineError) {
      throw new Error(`Failed to read storylines for coverage: ${storylineError.message}`);
    }

    // Cast through unknown: supabase-js infers `stories` as an array from the
    // `stories!inner(story_config)` select string without generated Database
    // types, but a many-to-one join from storylines to stories returns a single
    // object at runtime -- the same override gallery.ts's StorylineGalleryRow
    // applies for the identical join.
    const publishedRows: CoverageRow[] = ((storylineRows ?? []) as unknown as StorylineCoverageRow[]).map((row) => ({
      language: typeof row.stories?.story_config?.language === 'string' ? (row.stories.story_config.language as string) : '',
      ageGroup: row.age_group ?? '',
      genre: row.genre ?? '',
      count: 1,
      origin: 'published' as const,
    }));

    let agentRows: CoverageRow[] = [];
    const { data: memoryRows, error: memoryError } = await supabase
      .from('agent_story_memory')
      .select('language, age_group, genre');

    if (memoryError) {
      if (!isMissingMemorySchemaError(memoryError)) {
        throw new Error(`Failed to read agent_story_memory for coverage: ${memoryError.message}`);
      }
      // Migration 105 not applied: proceed with zero agent-authored coverage rather
      // than failing the whole coverage build over a sibling migration group.
    } else {
      agentRows = ((memoryRows ?? []) as MemoryCoverageRow[]).map((row) => ({
        language: row.language ?? '',
        ageGroup: row.age_group ?? '',
        genre: row.genre ?? '',
        count: 1,
        origin: 'agent' as const,
      }));
    }

    const cells = buildCoverageMatrix([...publishedRows, ...agentRows], personas);
    return rankCoverageGaps(cells, personas, { limit: GAP_SHORTLIST_SIZE });
  } catch (error) {
    if (isMissingPersonaSchemaError(error as { code?: string }) || isMissingMemorySchemaError(error as { code?: string })) {
      return [];
    }
    throw error;
  }
}

// ── Commissioning ──────────────────────────────────────────────────────

export interface ProposeCommissionsResult {
  accepted: CommissionProposal[];
  rejected: RejectedCommission[];
  /** Set when nothing was proposed WITHOUT a model call — e.g. no gaps, no personas. */
  reason?: string;
}

/**
 * Builds the planning prompt from the ranked gaps and asks the model to propose
 * commissions, then runs every proposal through validateCommissionProposals.
 *
 * If there are no coverage gaps or no active personas, this returns immediately
 * with an explanatory reason and makes NO model call — a model call that can only
 * ever come back empty (there is nothing to commission against) is a pure cost
 * with no possible benefit, so it is skipped rather than made and discarded.
 */
export async function proposeCommissions(limit: number = MAX_COMMISSIONS_PER_TICK): Promise<ProposeCommissionsResult> {
  const gaps = await buildCatalogueCoverage();
  if (gaps.length === 0) {
    return { accepted: [], rejected: [], reason: 'No coverage gaps found (no active persona can serve any taxonomy cell, or the catalogue already covers every servable one); skipped the model call.' };
  }

  const personas = await fetchActivePersonas();
  if (personas.length === 0) {
    return { accepted: [], rejected: [], reason: 'No active personas available to commission; skipped the model call.' };
  }

  const config = await getModelConfig('agent_supervisor_planning');
  const prompt = buildSupervisorPlanningPrompt(gaps, personas);

  let raw: unknown;
  try {
    const text = await callGeminiAgenticJson({
      task: 'agent_supervisor_planning',
      model: config.model,
      prompt,
      temperature: config.temperature ?? 0.4,
    });
    raw = JSON.parse(text);
  } catch (error) {
    return {
      accepted: [],
      rejected: [{ reason: `Planning model call or JSON parse failed: ${error instanceof Error ? error.message : 'unknown error'}`, raw: null }],
    };
  }

  const validated = validateCommissionProposals(raw, { personas, gaps });
  const cappedLimit = Math.max(0, Math.min(limit, MAX_COMMISSIONS_PER_TICK));

  return {
    accepted: validated.accepted.slice(0, cappedLimit),
    rejected: validated.rejected,
  };
}

function toInsertRow(proposal: CommissionProposal, createdBy: string | null | undefined) {
  return {
    persona_id: proposal.personaId,
    origin: 'supervisor' as const,
    status: 'commissioned' as const,
    brief: proposal.brief,
    rationale: proposal.rationale,
    language: proposal.language,
    age_group: proposal.ageGroup,
    genre: proposal.genre,
    target_beat_count: proposal.targetBeatCount,
    series_id: proposal.seriesId,
    created_by: createdBy ?? null,
  };
}

/** Inserts accepted commission proposals as agent_tasks rows. Fails closed on missing schema. */
export async function commissionTasks(proposals: CommissionProposal[], createdBy?: string | null): Promise<AgentTask[]> {
  if (proposals.length === 0) return [];
  if (taskSchemaUnavailable) throw new Error(TASK_SCHEMA_UNAVAILABLE_MESSAGE);

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('agent_tasks')
      .insert(proposals.map((proposal) => toInsertRow(proposal, createdBy)))
      .select('*');

    if (error) {
      if (isTaskSchemaMissing(error)) {
        latchTaskSchemaUnavailable('commissionTasks');
        throw new Error(TASK_SCHEMA_UNAVAILABLE_MESSAGE);
      }
      throw new Error(`Failed to insert agent_tasks: ${error.message}`);
    }

    return ((data ?? []) as AgentTaskRow[]).map(rowToTask);
  } catch (error) {
    if (error instanceof Error && error.message === TASK_SCHEMA_UNAVAILABLE_MESSAGE) throw error;
    if (isTaskSchemaMissing(error)) {
      latchTaskSchemaUnavailable('commissionTasks');
      throw new Error(TASK_SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }
}

// ── Task pool CRUD ─────────────────────────────────────────────────────

export interface AgentTaskListFilters {
  status?: AgentTaskStatus;
  personaId?: string;
  origin?: AgentTaskOrigin;
  isTest?: boolean;
}

export async function listAgentTasks(filters: AgentTaskListFilters = {}): Promise<AgentTask[]> {
  if (taskSchemaUnavailable) return [];

  try {
    const supabase = createAdminClient();
    let query = supabase.from('agent_tasks').select('*').order('created_at', { ascending: false });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.personaId) query = query.eq('persona_id', filters.personaId);
    if (filters.origin) query = query.eq('origin', filters.origin);
    if (filters.isTest !== undefined) query = query.eq('is_test', filters.isTest);

    const { data, error } = await query;
    if (error) {
      if (isTaskSchemaMissing(error)) {
        latchTaskSchemaUnavailable('listAgentTasks');
        return [];
      }
      throw new Error(`Failed to list agent_tasks: ${error.message}`);
    }

    return ((data ?? []) as AgentTaskRow[]).map(rowToTask);
  } catch (error) {
    if (isTaskSchemaMissing(error)) {
      latchTaskSchemaUnavailable('listAgentTasks');
      return [];
    }
    throw error;
  }
}

export async function getAgentTask(id: string): Promise<AgentTask | null> {
  if (taskSchemaUnavailable) return null;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from('agent_tasks').select('*').eq('id', id).maybeSingle();

    if (error) {
      if (isTaskSchemaMissing(error)) {
        latchTaskSchemaUnavailable('getAgentTask');
        return null;
      }
      throw new Error(`Failed to read agent_task: ${error.message}`);
    }

    return data ? rowToTask(data as AgentTaskRow) : null;
  } catch (error) {
    if (isTaskSchemaMissing(error)) {
      latchTaskSchemaUnavailable('getAgentTask');
      return null;
    }
    throw error;
  }
}

async function updateTask(taskId: string, patch: Record<string, unknown>, context: string): Promise<AgentTask> {
  if (taskSchemaUnavailable) throw new Error(TASK_SCHEMA_UNAVAILABLE_MESSAGE);

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('agent_tasks')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', taskId)
      .select('*')
      .single();

    if (error) {
      if (isTaskSchemaMissing(error)) {
        latchTaskSchemaUnavailable(context);
        throw new Error(TASK_SCHEMA_UNAVAILABLE_MESSAGE);
      }
      throw new Error(`Failed to update agent_task (${context}): ${error.message}`);
    }

    return rowToTask(data as AgentTaskRow);
  } catch (error) {
    if (error instanceof Error && error.message === TASK_SCHEMA_UNAVAILABLE_MESSAGE) throw error;
    if (isTaskSchemaMissing(error)) {
      latchTaskSchemaUnavailable(context);
      throw new Error(TASK_SCHEMA_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }
}

/** Attaches a persona to a commissioned task and advances it to 'assigned'. */
export async function assignTaskPersona(taskId: string, personaId: string): Promise<AgentTask> {
  return updateTask(taskId, { persona_id: personaId, status: 'assigned' satisfies AgentTaskStatus }, 'assignTaskPersona');
}

export async function setAgentTaskStatus(taskId: string, status: AgentTaskStatus): Promise<AgentTask> {
  return updateTask(taskId, { status }, 'setAgentTaskStatus');
}

export async function cancelAgentTask(taskId: string): Promise<AgentTask> {
  return updateTask(taskId, { status: 'cancelled' satisfies AgentTaskStatus }, 'cancelAgentTask');
}
