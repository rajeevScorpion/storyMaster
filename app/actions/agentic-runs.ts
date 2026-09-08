'use server';

// Agentic Creator System: run admin entry points. Every export starts with
// verifyAdmin() -- a 'use server' file may only export async functions, so the types
// (AgentRun, AgentRunEvent, AgentRunWithTimeline, AgentRunListFilters, AgentRunStage,
// AgentRunStatus, AgentRunDetail, StoredEvaluation) live in lib/agentic/orchestrator.ts,
// lib/agentic/orchestrator.shared.ts and lib/agentic/evaluation.ts, not here.
//
// Reads (listRunsAction, getRunAction, getRunSchemaStatusAction) are allowed even while
// the master flag is off -- an admin browsing an empty (or migration-107-absent) run
// list is harmless, mirroring listPersonas/getPersona in agentic-personas.ts and
// getCatalogueCoverage/listAgentTasksAction in agentic-supervisor.ts. cancelRunAction,
// retryRunAction and kickAgenticWorker mutate or drive a run's lifecycle, so they
// additionally require agentic_creator_enabled, the same requireCreatorEnabled() gate
// agentic-personas.ts and agentic-supervisor.ts use for their own writes.
//
// Phase 5b: kickAgenticWorker() (the admin "Run now" button) and
// getRunSchemaStatusAction() (the run monitor's migration-107-applied probe, mirroring
// getTaskPoolStatus in agentic-supervisor.ts -- needed to tell "not applied" apart from
// "applied but empty" apart from "no rows match the filters") are both new here; every
// other export is unchanged from Phase 5a.
//
// Unit 7c: getRunAction now also returns each evaluation recorded against the run
// (migration 108, lib/agentic/evaluation.ts), for the run monitor's Evaluation panel.
// See getRunAction's own doc comment for why that fetch is not allowed to break the
// timeline/checkpoint half of the same response.
//
// Migration 107 will not be applied when this code first ships (see
// docs/agentic-creator-working-memory.md). Every call here fails closed through
// lib/agentic/orchestrator.ts's own latch: reads return [] / null, writes throw a clear
// "not applied yet" message instead of a raw Postgres error.

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { getAgenticFlags } from '@/lib/agentic/flags';
import {
  cancelRun,
  getRun,
  listRuns,
  retryRun,
  type AgentRun,
  type AgentRunListFilters,
  type AgentRunWithTimeline,
} from '@/lib/agentic/orchestrator';
import { isMissingRunSchemaError } from '@/lib/agentic/orchestrator.shared';
import { listEvaluationsForRun, type AgentRunDetail, type StoredEvaluation } from '@/lib/agentic/evaluation';

export type { AgentRun, AgentRunEvent, AgentRunEventLevel, AgentRunListFilters, AgentRunWithTimeline } from '@/lib/agentic/orchestrator';
export type { AgentRunStage, AgentRunStatus } from '@/lib/agentic/orchestrator.shared';
export type { AgentRunDetail, StoredEvaluation } from '@/lib/agentic/evaluation';

async function requireCreatorEnabled(): Promise<void> {
  const flags = await getAgenticFlags();
  if (!flags.creatorEnabled) {
    throw new Error(
      'The Agentic Creator System is currently disabled. Turn on the master switch on the Agents Overview page before managing runs.'
    );
  }
}

/**
 * Distinguishes the run monitor's "migration not applied" empty state from "applied,
 * genuinely no runs" and "applied, none match the filters" -- both of which look
 * identical from listRunsAction() alone, since it returns [] for either. Mirrors
 * getTaskPoolStatus in agentic-supervisor.ts exactly: a cheap existence probe against
 * the table, classified only through this migration's own dedicated latch
 * (isMissingRunSchemaError) -- never a borrowed one (GOTCHAS.md).
 */
export async function getRunSchemaStatusAction(): Promise<{ schemaApplied: boolean }> {
  await verifyAdmin();

  const supabase = createAdminClient();
  const { error } = await supabase.from('agent_runs').select('id').limit(1);

  if (error) {
    if (isMissingRunSchemaError(error)) return { schemaApplied: false };
    throw new Error(`Failed to check run schema status: ${error.message}`);
  }

  return { schemaApplied: true };
}

function agenticWorkerBaseUrl(): string {
  const raw = process.env.APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return raw.replace(/\/$/, '');
}

/**
 * Admin "Run now" button: kicks /api/agentic/run directly instead of waiting for the
 * next scheduled drain. Mirrors rekickWorker in lib/media/image-job-runner.ts:45 --
 * same URL construction, same CRON_SECRET bearer header, same short abort timeout with
 * a swallowed catch. A slow or failed kick must not fail this action; the worker route
 * records its own outcome via agent_run_events, which the run monitor already shows.
 */
export async function kickAgenticWorker(): Promise<void> {
  await verifyAdmin();
  await requireCreatorEnabled();

  const secret = process.env.CRON_SECRET;
  await fetch(`${agenticWorkerBaseUrl()}/api/agentic/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(15_000),
    keepalive: true,
  }).catch((error) => console.error('Failed to kick agentic worker:', error));
}

/** Read-only: lists runs, most recent first. Allowed while the system is off. */
export async function listRunsAction(filters?: AgentRunListFilters): Promise<AgentRun[]> {
  await verifyAdmin();
  return listRuns(filters);
}

/**
 * Read-only: one run plus its full agent_run_events timeline and every
 * evaluation recorded against it (Unit 7c). Allowed while the system is off.
 *
 * The evaluation fetch is wrapped separately from the run/timeline fetch on
 * purpose. listEvaluationsForRun rethrows every error that isn't a
 * recognized "migration 108 missing" signature (lib/agentic/evaluation.ts:
 * 267-294), and the Evaluation panel this feeds is strictly supplementary to
 * the stage timeline and checkpoint the detail row already showed before
 * this unit existed. A single transient Postgres error in that one query
 * must never take down the whole detail row -- timeline and checkpoint
 * included -- for a panel that is, by construction, allowed to come back
 * empty. So this half fails open: log and fall back to [], never let it
 * throw past this action.
 */
export async function getRunAction(id: string): Promise<AgentRunDetail | null> {
  await verifyAdmin();

  const run = await getRun(id);
  if (!run) return null;

  let evaluations: StoredEvaluation[] = [];
  try {
    evaluations = await listEvaluationsForRun(id);
  } catch (error) {
    console.error(`Failed to load evaluations for run ${id}:`, error);
  }

  return { ...run, evaluations };
}

/** Cancels a run outright, regardless of its current stage or status. */
export async function cancelRunAction(id: string): Promise<AgentRun> {
  await verifyAdmin();
  await requireCreatorEnabled();
  return cancelRun(id);
}

/** Manually resumes a failed or cancelled run from its last checkpoint, with a fresh attempt budget. */
export async function retryRunAction(id: string): Promise<AgentRun> {
  await verifyAdmin();
  await requireCreatorEnabled();
  return retryRun(id);
}
