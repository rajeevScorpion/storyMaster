import { describe, it, expect } from 'vitest';
import { buildReviewerWorkloadReport } from './review-workload.shared';

const REVIEWERS = [
  { userId: 'u1', displayName: 'Asha', role: 'editor', status: 'active' },
  { userId: 'u2', displayName: 'Bela', role: 'reviewer', status: 'active' },
  { userId: 'u3', displayName: 'Chandra', role: 'reviewer', status: 'suspended' },
];

// Two runs on task t1 — the retry case the task-level join exists for.
const RUN_TASK = new Map([
  ['r1', 't1'],
  ['r1b', 't1'],
  ['r2', 't2'],
  ['r3', 't3'],
  ['r4', 't4'],
]);

describe('buildReviewerWorkloadReport', () => {
  it('splits a reviewer’s desk into completed and pending', () => {
    const report = buildReviewerWorkloadReport({
      reviewers: REVIEWERS,
      runTask: RUN_TASK,
      assignments: [
        { taskId: 't1', reviewerId: 'u1' },
        { taskId: 't2', reviewerId: 'u1' },
        { taskId: 't3', reviewerId: 'u2' },
      ],
      decisions: [{ runId: 'r1', reviewerId: 'u1', decision: 'approved' }],
    });

    const asha = report.reviewers.find((row) => row.userId === 'u1')!;
    expect([asha.assigned, asha.completed, asha.pending]).toEqual([2, 1, 1]);
    expect(report.totalAssigned).toBe(3);
    expect(report.totalCompleted).toBe(1);
    expect(report.totalPending).toBe(2);
  });

  // A task can produce several runs; a decision on any one of them ends the task.
  it('counts a task as completed when a decision lands on a later run of it', () => {
    const report = buildReviewerWorkloadReport({
      reviewers: REVIEWERS,
      runTask: RUN_TASK,
      assignments: [{ taskId: 't1', reviewerId: 'u1' }],
      decisions: [{ runId: 'r1b', reviewerId: 'u1', decision: 'published' }],
    });

    const asha = report.reviewers.find((row) => row.userId === 'u1')!;
    expect([asha.assigned, asha.completed, asha.pending]).toEqual([1, 1, 0]);
  });

  // Assignment is advisory (D18): anyone may decide anyone's draft. The task is off the
  // assignee's desk either way, but the decision belongs to whoever recorded it.
  it('credits a decision to whoever recorded it, not to the assignee', () => {
    const report = buildReviewerWorkloadReport({
      reviewers: REVIEWERS,
      runTask: RUN_TASK,
      assignments: [{ taskId: 't1', reviewerId: 'u1' }],
      decisions: [{ runId: 'r1', reviewerId: 'u2', decision: 'rejected' }],
    });

    const asha = report.reviewers.find((row) => row.userId === 'u1')!;
    const bela = report.reviewers.find((row) => row.userId === 'u2')!;
    expect([asha.assigned, asha.completed, asha.decisions]).toEqual([1, 1, 0]);
    expect([bela.assigned, bela.decisions]).toEqual([0, 1]);
    expect(bela.decisionsByKind.rejected).toBe(1);
  });

  // D18: reviewer_id going null is the unassigned pool, never "assigned to nobody".
  it('reports null-reviewer assignments as the unassigned pool', () => {
    const report = buildReviewerWorkloadReport({
      reviewers: REVIEWERS,
      runTask: RUN_TASK,
      assignments: [
        { taskId: 't1', reviewerId: null },
        { taskId: 't2', reviewerId: null },
        { taskId: 't3', reviewerId: 'u2' },
      ],
      decisions: [],
    });

    expect(report.unassigned).toBe(2);
    expect(report.totalAssigned).toBe(1);
    expect(report.reviewers.every((row) => row.assigned <= 1)).toBe(true);
  });

  // Standing revoked while work sat on their desk — an admin needs to see that.
  it('counts assignments to someone no longer on the roster separately', () => {
    const report = buildReviewerWorkloadReport({
      reviewers: REVIEWERS,
      runTask: RUN_TASK,
      assignments: [
        { taskId: 't1', reviewerId: 'gone' },
        { taskId: 't2', reviewerId: 'u1' },
      ],
      decisions: [],
    });

    expect(report.offRoster).toBe(1);
    expect(report.totalAssigned).toBe(1);
    expect(report.reviewers.some((row) => row.userId === 'gone')).toBe(false);
  });

  // "This reviewer has no work" is a real answer, not a missing row.
  it('lists every roster member, including one with an empty desk', () => {
    const report = buildReviewerWorkloadReport({
      reviewers: REVIEWERS,
      runTask: RUN_TASK,
      assignments: [],
      decisions: [],
    });

    expect(report.reviewers).toHaveLength(3);
    expect(report.reviewers.every((row) => row.assigned === 0 && row.decisions === 0)).toBe(true);
  });

  it('ranks the most pending work first', () => {
    const report = buildReviewerWorkloadReport({
      reviewers: REVIEWERS,
      runTask: RUN_TASK,
      assignments: [
        { taskId: 't1', reviewerId: 'u1' },
        { taskId: 't2', reviewerId: 'u2' },
        { taskId: 't3', reviewerId: 'u2' },
        { taskId: 't4', reviewerId: 'u2' },
      ],
      decisions: [],
    });

    expect(report.reviewers.map((row) => row.displayName)).toEqual(['Bela', 'Asha', 'Chandra']);
  });

  // A decision whose run is unknown (its run was deleted, or the read was capped)
  // cannot be traced to a task, so it must not silently mark anything completed.
  it('ignores a decision whose run cannot be traced to a task', () => {
    const report = buildReviewerWorkloadReport({
      reviewers: REVIEWERS,
      runTask: RUN_TASK,
      assignments: [{ taskId: 't1', reviewerId: 'u1' }],
      decisions: [{ runId: 'unknown-run', reviewerId: 'u1', decision: 'approved' }],
    });

    const asha = report.reviewers.find((row) => row.userId === 'u1')!;
    expect([asha.completed, asha.pending, asha.decisions]).toEqual([0, 1, 1]);
  });
});
