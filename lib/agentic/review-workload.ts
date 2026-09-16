import 'server-only';

// ── Agentic Creator System: Unit 9k — the reviewer workload report's data ──
//
// Four small reads, assembled by the pure function in review-workload.shared.ts.
// Nothing here is written; this module only ever reads.
//
// Each read goes through the module that OWNS its table, so each one carries that
// table's own migration latch and fails closed on its own terms rather than through a
// latch borrowed from a neighbour (GOTCHAS: one latch per migration group):
//   - agent_review_assignments (114) — review-routing.ts's listActiveAssignments
//   - agent_review_decisions (112)   — review-decisions.ts's listAllReviewDecisions
//   - agent_runs (107)               — orchestrator.ts's listRuns
//   - agent_reviewers (111/113)      — the one direct query below, classified with
//                                      reviewers.shared.ts's own classifier
//
// A database with none of those tables therefore yields an empty report, not an error.
// Production has no agentic tables at all and must keep rendering an honest empty state.
//
// WHY listRuns() UNFILTERED. A decision records a run; an assignment records a task. To
// connect them this needs run -> task for every run a decision could name, and listRuns
// supports one taskId at a time, not a set. The run monitor already reads this table
// unfiltered, and it is small. If it ever stops being small, the fix is a narrow
// `select id, task_id where task_id in (...)` here with 107's classifier, not a wider
// interface on the orchestrator.

import { createAdminClient } from '@/lib/supabase/admin';
import { listRuns } from '@/lib/agentic/orchestrator';
import { listAllReviewDecisions } from '@/lib/agentic/review-decisions';
import { listActiveAssignments } from '@/lib/agentic/review-routing';
import { isMissingReviewerSchemaError } from '@/lib/agentic/reviewers.shared';
import {
  buildReviewerWorkloadReport,
  type ReviewerWorkloadReport,
  type WorkloadReviewer,
} from '@/lib/agentic/review-workload.shared';

export interface ReviewerWorkloadResult {
  report: ReviewerWorkloadReport;
  /**
   * True when the reviewer roster itself could not be read — migration 111/113 is not
   * applied here. The report is still structurally valid (every count is zero), but the
   * page must say so rather than implying nobody has any work.
   */
  rosterUnavailable: boolean;
}

const EMPTY_REPORT: ReviewerWorkloadReport = {
  reviewers: [],
  unassigned: 0,
  offRoster: 0,
  totalAssigned: 0,
  totalCompleted: 0,
  totalPending: 0,
  totalDecisions: 0,
};

/**
 * The whole report. Deliberately takes no filters: the roster is a handful of people
 * and the point of the page is to see all of them at once.
 */
export async function getReviewerWorkloadReport(): Promise<ReviewerWorkloadResult> {
  const admin = createAdminClient();

  const rosterResult = await admin
    .from('agent_reviewers')
    .select('user_id, display_name, role, status');
  if (rosterResult.error) {
    if (isMissingReviewerSchemaError(rosterResult.error)) {
      return { report: EMPTY_REPORT, rosterUnavailable: true };
    }
    throw new Error(`Failed to load the reviewer roster for the workload report: ${rosterResult.error.message}`);
  }

  const [assignments, decisions, runs] = await Promise.all([
    listActiveAssignments(admin),
    listAllReviewDecisions(),
    listRuns(),
  ]);

  const runTask = new Map<string, string>();
  for (const run of runs) runTask.set(run.id, run.taskId);

  const reviewers: WorkloadReviewer[] = (rosterResult.data ?? []).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name ?? null,
    role: row.role ?? 'reviewer',
    status: row.status ?? 'active',
  }));

  return {
    report: buildReviewerWorkloadReport({
      assignments: assignments.map((assignment) => ({
        taskId: assignment.taskId,
        reviewerId: assignment.reviewerId,
      })),
      decisions: decisions.map((decision) => ({
        runId: decision.runId,
        reviewerId: decision.reviewerId,
        decision: decision.decision,
      })),
      runTask,
      reviewers,
    }),
    rosterUnavailable: false,
  };
}
