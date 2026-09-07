'use server';

// Agentic Creator System: run admin entry points. Every export starts with
// verifyAdmin() -- a 'use server' file may only export async functions, so the types
// (AgentRun, AgentRunEvent, AgentRunWithTimeline, AgentRunListFilters, AgentRunStage,
// AgentRunStatus) live in lib/agentic/orchestrator.ts and lib/agentic/orchestrator.shared.ts,
// not here.
//
// Reads (listRunsAction, getRunAction) are allowed even while the master flag is off --
// an admin browsing an empty (or migration-107-absent) run list is harmless, mirroring
// listPersonas/getPersona in agentic-personas.ts and getCatalogueCoverage/
// listAgentTasksAction in agentic-supervisor.ts. cancelRunAction and retryRunAction
// mutate a run's lifecycle, so they additionally require agentic_creator_enabled, the
// same requireCreatorEnabled() gate agentic-personas.ts and agentic-supervisor.ts use
// for their own writes.
//
// kickAgenticWorker() is DELIBERATELY NOT HERE -- it belongs to Phase 5b together with
// the CRON_SECRET-guarded worker route (app/api/agentic/run/route.ts) it would call.
// Adding it now would give the admin UI a "Run now" button with nothing behind it.
//
// Migration 107 will not be applied when this code first ships (see
// docs/agentic-creator-working-memory.md). Every call here fails closed through
// lib/agentic/orchestrator.ts's own latch: reads return [] / null, writes throw a clear
// "not applied yet" message instead of a raw Postgres error.

import { verifyAdmin } from '@/lib/supabase/admin';
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

export type { AgentRun, AgentRunEvent, AgentRunEventLevel, AgentRunListFilters, AgentRunWithTimeline } from '@/lib/agentic/orchestrator';
export type { AgentRunStage, AgentRunStatus } from '@/lib/agentic/orchestrator.shared';

async function requireCreatorEnabled(): Promise<void> {
  const flags = await getAgenticFlags();
  if (!flags.creatorEnabled) {
    throw new Error(
      'The Agentic Creator System is currently disabled. Turn on the master switch on the Agents Overview page before managing runs.'
    );
  }
}

/** Read-only: lists runs, most recent first. Allowed while the system is off. */
export async function listRunsAction(filters?: AgentRunListFilters): Promise<AgentRun[]> {
  await verifyAdmin();
  return listRuns(filters);
}

/** Read-only: one run plus its full agent_run_events timeline. Allowed while the system is off. */
export async function getRunAction(id: string): Promise<AgentRunWithTimeline | null> {
  await verifyAdmin();
  return getRun(id);
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
