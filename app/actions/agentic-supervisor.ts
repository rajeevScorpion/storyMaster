'use server';

// Agentic Creator System: Editorial Supervisor admin entry points. Every export
// starts with verifyAdmin() -- a 'use server' file may only export async
// functions, so the types (AgentTask, CoverageGap, CommissionProposal, ...) live
// in lib/agentic/supervisor.shared.ts and lib/agentic/supervisor.ts, not here.
//
// Reads (getCatalogueCoverage, listAgentTasksAction) are allowed even while the
// master flag is off, mirroring listPersonas/getPersona in agentic-personas.ts --
// an admin browsing an empty coverage table or task pool is harmless. Every
// entry point that actually commissions new work (proposeCommissionsAction,
// commissionTasksAction) additionally requires agentic_supervisor_enabled on top
// of the master switch, so a commission can never be proposed or created while
// either is off. Task-pool management on already-existing tasks
// (assign/setStatus/cancel) requires only the master switch, matching
// createPersona/updatePersona's requireCreatorEnabled() -- they are not
// themselves acts of commissioning.

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { getAgenticFlags } from '@/lib/agentic/flags';
import {
  assignTaskPersona,
  buildCatalogueCoverage,
  cancelAgentTask,
  commissionTasks,
  getAgentTask,
  listAgentTasks,
  proposeCommissions,
  setAgentTaskStatus,
  type AgentTask,
  type AgentTaskListFilters,
  type AgentTaskStatus,
  type ProposeCommissionsResult,
} from '@/lib/agentic/supervisor';
import { isMissingTaskSchemaError, type CommissionProposal, type CoverageGap } from '@/lib/agentic/supervisor.shared';

export type { AgentTask, AgentTaskListFilters, AgentTaskOrigin, AgentTaskStatus, ProposeCommissionsResult } from '@/lib/agentic/supervisor';

async function requireCreatorEnabled(): Promise<void> {
  const flags = await getAgenticFlags();
  if (!flags.creatorEnabled) {
    throw new Error(
      'The Agentic Creator System is currently disabled. Turn on the master switch on the Agents Overview page first.'
    );
  }
}

async function requireSupervisorEnabled(): Promise<void> {
  const flags = await getAgenticFlags();
  if (!flags.creatorEnabled || !flags.supervisorEnabled) {
    throw new Error(
      'The Editorial Supervisor is currently disabled. Turn on both the master switch and the Supervisor toggle on the Agents Overview page before commissioning tasks.'
    );
  }
}

/**
 * Distinguishes the task-pool UI's two "nothing here" states: migration 106 not
 * applied yet (schemaApplied: false, agent_tasks doesn't exist here) vs. applied
 * but genuinely empty (schemaApplied: true, listAgentTasksAction() returns []).
 * Mirrors getPersonaCatalogueStatus in agentic-personas.ts exactly -- same cheap
 * existence probe, same fail-closed classification via the migration's own
 * classifier (isMissingTaskSchemaError), never a borrowed one (GOTCHAS.md).
 */
export async function getTaskPoolStatus(): Promise<{ schemaApplied: boolean }> {
  await verifyAdmin();

  const supabase = createAdminClient();
  const { error } = await supabase.from('agent_tasks').select('id').limit(1);

  if (error) {
    if (isMissingTaskSchemaError(error)) return { schemaApplied: false };
    throw new Error(`Failed to check task schema status: ${error.message}`);
  }

  return { schemaApplied: true };
}

/** Read-only: the ranked catalogue coverage gaps. Allowed while the system is off. */
export async function getCatalogueCoverage(): Promise<CoverageGap[]> {
  await verifyAdmin();
  return buildCatalogueCoverage();
}

/**
 * Asks the planning model to propose commissions against the current coverage
 * gaps. Does not write anything -- call commissionTasksAction with the accepted
 * proposals to actually create agent_tasks rows.
 */
export async function proposeCommissionsAction(limit?: number): Promise<ProposeCommissionsResult> {
  await verifyAdmin();
  await requireSupervisorEnabled();
  return proposeCommissions(limit);
}

/** Creates agent_tasks rows from already-validated commission proposals. */
export async function commissionTasksAction(proposals: CommissionProposal[]): Promise<AgentTask[]> {
  const admin = await verifyAdmin();
  await requireSupervisorEnabled();
  return commissionTasks(proposals, admin.user.id);
}

/** Read-only: lists tasks in the pool. Allowed while the system is off. */
export async function listAgentTasksAction(filters?: AgentTaskListFilters): Promise<AgentTask[]> {
  await verifyAdmin();
  return listAgentTasks(filters);
}

/** Read-only: one task by id. Allowed while the system is off. */
export async function getAgentTaskAction(id: string): Promise<AgentTask | null> {
  await verifyAdmin();
  return getAgentTask(id);
}

export async function assignTaskPersonaAction(taskId: string, personaId: string): Promise<AgentTask> {
  await verifyAdmin();
  await requireCreatorEnabled();
  return assignTaskPersona(taskId, personaId);
}

export async function setAgentTaskStatusAction(taskId: string, status: AgentTaskStatus): Promise<AgentTask> {
  await verifyAdmin();
  await requireCreatorEnabled();
  return setAgentTaskStatus(taskId, status);
}

export async function cancelAgentTaskAction(taskId: string): Promise<AgentTask> {
  await verifyAdmin();
  await requireCreatorEnabled();
  return cancelAgentTask(taskId);
}
