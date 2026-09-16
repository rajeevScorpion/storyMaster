import 'server-only';

// ── Agentic Creator System: Unit 9k — one reviewer's own decision history ──
//
// Two reads: the reviewer's decisions (agent_review_decisions, migration 112) and the
// titles of the stories they were about. Nothing here is written.
//
// SCOPED TO ONE REVIEWER BY ID, always. The caller passes the id it resolved from
// requireReviewer(), never a value a client could supply — this is somebody's own
// history, and "whose history" is not a parameter a browser gets to choose.
//
// It deliberately does NOT touch agent_reviewers. A reviewer-facing read must never go
// near that table's `notes` column, which is admin-only commentary written ABOUT a
// reviewer; leaking it was a real defect once (245588e). The reviewer's own name is not
// needed here anyway — they know who they are, and every row is theirs.
//
// Fails closed: while migration 112 is unapplied listReviewDecisionsForReviewer
// degrades to [], which renders as an honest "nothing here yet" rather than an error.
// Production has no agentic tables at all and must keep rendering that empty state.

import { createAdminClient } from '@/lib/supabase/admin';
import { listReviewDecisionsForReviewer } from '@/lib/agentic/review-decisions';
import type { StoredReviewDecisionValue } from '@/lib/agentic/review-decisions.shared';

export interface ReviewHistoryEntry {
  id: string;
  decision: StoredReviewDecisionValue;
  createdAt: string;
  notes: string | null;
  runId: string;
  storyId: string | null;
  storyTitle: string | null;
  /**
   * Set only on a 'published' decision, and only while that storyline still exists —
   * the column is ON DELETE SET NULL, so a non-null value here is a live storyline the
   * UI can safely link to.
   */
  storylineId: string | null;
}

export async function getReviewHistoryForReviewer(reviewerId: string): Promise<ReviewHistoryEntry[]> {
  const decisions = await listReviewDecisionsForReviewer(reviewerId);
  if (decisions.length === 0) return [];

  const storyIds = [...new Set(decisions.map((decision) => decision.storyId).filter((id): id is string => Boolean(id)))];

  const titleByStoryId = new Map<string, string | null>();
  if (storyIds.length > 0) {
    const admin = createAdminClient();
    const { data, error } = await admin.from('stories').select('id, title').in('id', storyIds);
    if (error) {
      // A title is decoration; the decision itself is the record. Losing the join must
      // not lose the history, so this degrades to untitled rows rather than throwing.
      console.warn('[agentic-review-history] could not resolve story titles; showing ids instead.', error);
    } else {
      for (const row of (data ?? []) as { id: string; title: string | null }[]) {
        titleByStoryId.set(row.id, row.title);
      }
    }
  }

  return decisions.map((decision) => ({
    id: decision.id,
    decision: decision.decision,
    createdAt: decision.createdAt,
    notes: decision.notes,
    runId: decision.runId,
    storyId: decision.storyId,
    storyTitle: decision.storyId ? titleByStoryId.get(decision.storyId) ?? null : null,
    storylineId: decision.storylineId,
  }));
}
