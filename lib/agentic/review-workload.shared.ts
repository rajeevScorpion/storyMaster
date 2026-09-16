import type { StoredReviewDecisionValue } from '@/lib/agentic/review-decisions.shared';

// ── Agentic Creator System: Unit 9k — the reviewer workload report ───────
//
// Pure aggregation, kept separate from the queries that feed it so the arithmetic can
// be unit-tested. The admin page at /admin/authors/workload is the only consumer.
//
// WHAT THE FOUR NUMBERS MEAN, precisely, because three of them are easy to misread:
//
//   assigned   — ACTIVE assignment rows pointing at this reviewer. Their desk right
//                now, not a career total: a superseded or released row is gone from
//                this count, which is the point (migration 114, D18).
//   completed  — of those, the tasks that have at least one recorded decision, BY
//                ANYONE. Assignment is advisory: nothing stops another reviewer
//                deciding a draft sitting on this one's desk, and calling that
//                "completed by them" would be a lie. It is still off their desk.
//   pending    — assigned minus completed. Work genuinely still waiting.
//   decisions  — decisions THIS reviewer personally recorded, all time, on any task
//                whether it was ever assigned to them or not. This is their output,
//                and it can legitimately exceed `completed` in both directions.
//
// The unassigned pool is reported as its own line, never folded into a reviewer's row:
// an active assignment whose reviewer_id went null (the FK's ON DELETE SET NULL) means
// nobody is on it, per D18 — it does not mean "assigned to nobody in particular".

/** One active assignment, narrowed to what the aggregation needs. */
export interface WorkloadAssignment {
  taskId: string;
  /** Null is the unassigned pool (ON DELETE SET NULL), never a reviewer. */
  reviewerId: string | null;
}

/** One recorded decision, narrowed to what the aggregation needs. */
export interface WorkloadDecision {
  runId: string;
  reviewerId: string | null;
  decision: StoredReviewDecisionValue;
}

/** One roster entry the report has a row for, whether or not it has any work. */
export interface WorkloadReviewer {
  userId: string;
  displayName: string | null;
  role: string;
  status: string;
}

export interface ReviewerWorkloadRow {
  userId: string;
  displayName: string | null;
  role: string;
  status: string;
  assigned: number;
  completed: number;
  pending: number;
  /** Decisions this reviewer personally recorded, by kind. */
  decisions: number;
  decisionsByKind: Record<StoredReviewDecisionValue, number>;
}

export interface ReviewerWorkloadReport {
  reviewers: ReviewerWorkloadRow[];
  /** Active assignment rows with no reviewer on them — the unassigned pool. */
  unassigned: number;
  /**
   * Active assignments pointing at a user who is not on the roster at all. Reported
   * separately rather than dropped: a reviewer whose standing was revoked while work
   * sat on their desk is exactly the state an admin needs to see.
   */
  offRoster: number;
  totalAssigned: number;
  totalCompleted: number;
  totalPending: number;
  totalDecisions: number;
}

const EMPTY_BY_KIND: Record<StoredReviewDecisionValue, number> = {
  approved: 0,
  rewrite_requested: 0,
  rejected: 0,
  published: 0,
};

export function buildReviewerWorkloadReport(input: {
  assignments: readonly WorkloadAssignment[];
  decisions: readonly WorkloadDecision[];
  /** run id -> task id, so a decision recorded against a run can be traced to its task. */
  runTask: ReadonlyMap<string, string>;
  reviewers: readonly WorkloadReviewer[];
}): ReviewerWorkloadReport {
  // Which TASKS have been decided at all. A task can produce several runs (retry, or a
  // re-brief), and a decision on any one of them means the task is off someone's desk —
  // which is why this is keyed by task, resolved through runTask, rather than by run.
  const decidedTasks = new Set<string>();
  for (const decision of input.decisions) {
    const taskId = input.runTask.get(decision.runId);
    if (taskId) decidedTasks.add(taskId);
  }

  const rosterIds = new Set(input.reviewers.map((reviewer) => reviewer.userId));

  const assignedByReviewer = new Map<string, { assigned: number; completed: number }>();
  let unassigned = 0;
  let offRoster = 0;

  for (const assignment of input.assignments) {
    if (!assignment.reviewerId) {
      unassigned += 1;
      continue;
    }
    if (!rosterIds.has(assignment.reviewerId)) {
      offRoster += 1;
      continue;
    }

    let entry = assignedByReviewer.get(assignment.reviewerId);
    if (!entry) {
      entry = { assigned: 0, completed: 0 };
      assignedByReviewer.set(assignment.reviewerId, entry);
    }
    entry.assigned += 1;
    if (decidedTasks.has(assignment.taskId)) entry.completed += 1;
  }

  // Personal output, counted from the decision rows themselves rather than from the
  // assignment table — a reviewer who decided a draft nobody assigned them still did
  // the work, and must not read as having done nothing.
  const decisionsByReviewer = new Map<string, Record<StoredReviewDecisionValue, number>>();
  for (const decision of input.decisions) {
    if (!decision.reviewerId) continue;
    let byKind = decisionsByReviewer.get(decision.reviewerId);
    if (!byKind) {
      byKind = { ...EMPTY_BY_KIND };
      decisionsByReviewer.set(decision.reviewerId, byKind);
    }
    byKind[decision.decision] += 1;
  }

  // Every roster member gets a row, including one with nothing on their desk — "this
  // reviewer has no work" is a real answer, and omitting the row makes it look missing.
  const reviewers: ReviewerWorkloadRow[] = input.reviewers.map((reviewer) => {
    const load = assignedByReviewer.get(reviewer.userId) ?? { assigned: 0, completed: 0 };
    const byKind = decisionsByReviewer.get(reviewer.userId) ?? EMPTY_BY_KIND;
    const decisions = byKind.approved + byKind.rewrite_requested + byKind.rejected + byKind.published;
    return {
      userId: reviewer.userId,
      displayName: reviewer.displayName,
      role: reviewer.role,
      status: reviewer.status,
      assigned: load.assigned,
      completed: load.completed,
      pending: load.assigned - load.completed,
      decisions,
      decisionsByKind: { ...byKind },
    };
  });

  // Most still-pending work first — that is what an admin looking at this page is
  // trying to find. Ties fall back to the busiest desk, then to name, so the order is
  // stable between loads.
  reviewers.sort(
    (a, b) =>
      b.pending - a.pending ||
      b.assigned - a.assigned ||
      (a.displayName ?? a.userId).localeCompare(b.displayName ?? b.userId)
  );

  return {
    reviewers,
    unassigned,
    offRoster,
    totalAssigned: reviewers.reduce((sum, row) => sum + row.assigned, 0),
    totalCompleted: reviewers.reduce((sum, row) => sum + row.completed, 0),
    totalPending: reviewers.reduce((sum, row) => sum + row.pending, 0),
    totalDecisions: reviewers.reduce((sum, row) => sum + row.decisions, 0),
  };
}
