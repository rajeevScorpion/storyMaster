'use client';

import { Fragment, useState, useTransition } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  RefreshCcw,
  Rocket,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import FilterDropdown from '@/components/ui/FilterDropdown';
import RowActionsMenu, { type RowAction } from '@/components/ui/RowActionsMenu';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  approveRunAction,
  listReviewQueueAction,
  publishRunAction,
  rejectRunAction,
  requestRunRewriteAction,
  type ReviewDecisionKind,
  type ReviewQueueReadiness,
  type ReviewQueueRow,
  type StoredReviewDecisionValue,
} from '@/app/actions/agentic-review';
import {
  EVALUATION_VERDICT_LABELS,
  EVALUATION_VERDICT_STYLES,
  REVIEW_READINESS_LABELS,
  formatDateTime,
  shortId,
  EvaluationEntry,
} from '@/components/admin/agentic/run-presentation';

// ── Agentic Creator System: Phase 9 review queue (Units 9c, 9e-i, 9e-ii) ────────
//
// Unit 9c made the queue VISIBLE: every run at stage 'awaiting_review', its story,
// and its latest evaluation, in one place, filterable by review readiness. Unit
// 9e-i added three reviewer decisions -- approve, reject, request rewrite -- as
// row actions. Unit 9e-ii (D15, docs/agentic-creator-decisions.md) adds the
// fourth: Publish, gated on the current reviewer's own can_publish (the
// `canPublish` prop, resolved server-side by app/admin/authors/page.tsx via
// requireReviewer() -- this component has no session of its own to check it
// with). A reviewer without can_publish still sees the row, still sees every
// other action, but the Publish item renders disabled.
//
// 9c deliberately used a plain chevron for the expand toggle because there were
// no mutating actions yet. Now there are, so the expand toggle stays a bare
// chevron cell (still just a UI affordance, not an action) and a separate
// RowActionsMenu column carries Approve / Request rewrite / Reject / Publish,
// exactly the pattern RunMonitor.tsx already uses for Retry / Cancel.
//
// WHAT EACH DECISION DOES TO THE ROW, so the optimistic local update below reads
// as intentional rather than guessed (full state machine:
// lib/agentic/review-decisions.shared.ts's decideReviewTransition):
//   - Approve / Request rewrite: the run stays at 'awaiting_review' (approving
//     does NOT publish -- Publish is a separate action a reviewer takes on its
//     own), so the row stays in this list. Only its `latestDecision` badge
//     changes.
//   - Reject / Publish: the run moves to a terminal stage ('cancelled' /
//     'complete' respectively), so it no longer belongs in a list filtered to
//     'awaiting_review' -- the row is removed locally rather than left showing a
//     stage the next real reload would never return.
//
// This component assumes the reviewer-workflow flag is already ON. The flag-off
// state (D8) is rendered by app/admin/authors/page.tsx BEFORE this component is
// ever mounted -- that is what makes "does not fetch while off" literally true,
// rather than this component fetching and then hiding the result. All four
// decision actions ALSO re-check the flag server-side (agentic-review.ts's
// requireReviewerWorkflowEnabled) -- this component does not duplicate that
// check, it just surfaces whatever error a disabled flag throws back. Publish
// additionally re-checks can_publish server-side (canPublish(reviewer) inside
// publishRunAction) -- the `canPublish` prop below is a UX convenience (an
// honest disabled affordance), never the write's actual security boundary,
// exactly as the server action file's own header explains for the flag check.
//
// Four distinguishable empty states, the same discipline RunMonitor.tsx's own
// doc comment describes for its run list:
//   (a) flag off -- handled by the page, not here (see above).
//   (b) migration 107 not applied (schemaApplied: false) -- reuses the SAME
//       isMissingRunSchemaError latch path RunMonitor and agentic-runs.ts use
//       for agent_runs; this file invents no new latch.
//   (c) applied, nothing is awaiting review right now.
//   (d) applied, rows exist, but none match the current readiness filter.
// Collapsing these into one bare table would hide exactly what an operator
// needs to know: is there a schema problem, is the queue genuinely empty, or is
// a filter hiding real rows?

const READINESS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All readiness' },
  { value: 'ready_for_review', label: REVIEW_READINESS_LABELS.ready_for_review },
  { value: 'needs_rewrite', label: REVIEW_READINESS_LABELS.needs_rewrite },
  { value: 'unscored', label: 'Not yet evaluated' },
];

// REVIEW_READINESS_LABELS (run-presentation.tsx) only covers the two values
// deriveReviewReadiness can actually produce -- 'unscored' is this queue's own
// addition for "no agent_evaluations row exists for this run" (see
// agentic-review.ts's ReviewQueueReadiness doc comment), so it gets its own
// badge style here rather than being forced into that shared table.
const QUEUE_READINESS_STYLES: Record<ReviewQueueReadiness, string> = {
  ready_for_review: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  needs_rewrite: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
  unscored: 'border-neutral-500/25 bg-neutral-500/10 text-neutral-400',
};

const QUEUE_READINESS_LABELS: Record<ReviewQueueReadiness, string> = {
  ready_for_review: REVIEW_READINESS_LABELS.ready_for_review,
  needs_rewrite: REVIEW_READINESS_LABELS.needs_rewrite,
  unscored: 'Not yet evaluated',
};

// Covers every value migration 112's CHECK constraint allows (StoredReviewDecisionValue),
// including 'published' -- the value publishRunAction (Unit 9e-ii) now writes.
const DECISION_LABELS: Record<StoredReviewDecisionValue, string> = {
  approved: 'Approved',
  rewrite_requested: 'Rewrite requested',
  rejected: 'Rejected',
  published: 'Published',
};

const DECISION_STYLES: Record<StoredReviewDecisionValue, string> = {
  approved: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  rewrite_requested: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  rejected: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
  published: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
};

/** One row's confirm-dialog target: which run, and which of the four decisions it's for. */
interface DecisionTarget {
  row: ReviewQueueRow;
  kind: ReviewDecisionKind;
}

const DECISION_DIALOG_COPY: Record<
  ReviewDecisionKind,
  { title: string; confirmLabel: string; tone: 'default' | 'danger'; body: string }
> = {
  approved: {
    title: 'Approve this draft?',
    confirmLabel: 'Approve',
    tone: 'default',
    body: 'Records your approval. The run stays at "awaiting review" -- publishing is a separate step you take on your own.',
  },
  rewrite_requested: {
    title: 'Request a rewrite?',
    confirmLabel: 'Request rewrite',
    tone: 'default',
    body: 'Records that this draft needs redoing. Nothing is regenerated automatically -- the redo is a fresh commission someone issues separately.',
  },
  rejected: {
    title: 'Reject this draft?',
    confirmLabel: 'Reject',
    tone: 'danger',
    body: 'Cancels the run and marks its task rejected. This is terminal -- the row drops out of this queue once rejected.',
  },
  published: {
    title: 'Publish this draft?',
    confirmLabel: 'Publish',
    tone: 'default',
    body: 'Creates a public storyline from this draft, owned by the agentic system account and credited to the persona -- not to you. This does not require a prior approval, and it is terminal: the row drops out of this queue once published.',
  },
};

// Exhaustive over ReviewDecisionKind on purpose -- a ternary chain with a trailing default
// (as this used to be, defaulting anything unmatched to rejectRunAction) would have
// silently sent 'published' to rejectRunAction the moment that value was added to the
// type, since it was never explicitly matched. A missing case here is now a compile error
// instead of a live incident.
const DECISION_ACTIONS: Record<ReviewDecisionKind, typeof approveRunAction> = {
  approved: approveRunAction,
  rewrite_requested: requestRunRewriteAction,
  rejected: rejectRunAction,
  published: publishRunAction,
};

export default function ReviewQueue({
  initialRows,
  schemaApplied,
  canPublish,
}: {
  initialRows: ReviewQueueRow[];
  schemaApplied: boolean;
  /**
   * Whether the CURRENT reviewer (resolved server-side by app/admin/authors/page.tsx via
   * requireReviewer()) may publish. A UX convenience only -- publishRunAction re-checks
   * canPublish(reviewer) itself, so a stale or falsified prop cannot grant a write it
   * would otherwise refuse. See this file's header.
   */
  canPublish: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [readinessFilter, setReadinessFilter] = useState('all');
  const [isPending, startTransition] = useTransition();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Reviewer decisions (Unit 9e-i) ──────────────────────────────
  const [decisionTarget, setDecisionTarget] = useState<DecisionTarget | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const filterActive = readinessFilter !== 'all';

  function reload(nextReadiness: string = readinessFilter) {
    setLoadError(null);
    startTransition(async () => {
      try {
        const result = await listReviewQueueAction(
          nextReadiness === 'all' ? {} : { readiness: nextReadiness as ReviewQueueReadiness }
        );
        setRows(result);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Unable to load the review queue.');
      }
    });
  }

  function openDecision(row: ReviewQueueRow, kind: ReviewDecisionKind) {
    setDecisionError(null);
    setDecisionNotes('');
    setDecisionTarget({ row, kind });
  }

  async function confirmDecision() {
    if (!decisionTarget) return;
    const { row, kind } = decisionTarget;
    const runId = row.run.id;
    const action = DECISION_ACTIONS[kind];

    setBusyRunId(runId);
    setDecisionError(null);
    try {
      const decision = await action(runId, decisionNotes.trim() || undefined);
      // 'rejected' and 'published' both move the run to a terminal stage ('cancelled' /
      // 'complete') -- neither belongs in a list filtered to 'awaiting_review' any more, so
      // the row is removed locally rather than left showing a stage the next real reload
      // would never return it under. 'approved' and 'rewrite_requested' leave the run right
      // where it was; only the badge changes.
      if (kind === 'rejected' || kind === 'published') {
        setRows((current) => current.filter((r) => r.run.id !== runId));
      } else {
        setRows((current) => current.map((r) => (r.run.id === runId ? { ...r, latestDecision: decision } : r)));
      }
      setDecisionTarget(null);
      setDecisionNotes('');
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : 'Unable to record the decision.');
    } finally {
      setBusyRunId(null);
    }
  }

  function emptyReason(): { title: string; body: string } {
    if (!schemaApplied) {
      return {
        title: 'Migration 107 has not been applied to this environment yet.',
        body: "The run tables (agent_runs, agent_run_events) don't exist here, so there is nothing to review. Apply 107_agent_runs.sql in the Supabase dashboard for this environment, then reload.",
      };
    }
    if (filterActive) {
      return { title: 'No drafts match this filter.', body: 'Clear the readiness filter to see the rest of the queue.' };
    }
    return {
      title: 'Nothing is waiting on review right now.',
      body: 'A run lands here once it reaches stage "awaiting_review" -- see Run monitor (Agentic > Agents > Runs) for runs still in progress.',
    };
  }

  const reason = emptyReason();

  return (
    <>
    <section className="rounded-2xl border border-white/10 bg-white/[0.035]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
            <ClipboardCheck className="h-4 w-4 text-emerald-300" />
            Awaiting review
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Agent drafts that finished the automatic pipeline and are waiting on a human.
          </p>
        </div>
        <button
          type="button"
          onClick={() => reload()}
          disabled={isPending || !schemaApplied}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-neutral-800 px-3 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      {!schemaApplied ? (
        <div className="flex gap-4 p-5">
          <ShieldAlert size={22} className="mt-0.5 shrink-0 text-amber-300" />
          <div className="space-y-1 text-sm text-neutral-200">
            <p className="font-medium text-amber-200">{reason.title}</p>
            <p className="text-neutral-300">{reason.body}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-4">
            <FilterDropdown
              value={readinessFilter}
              options={READINESS_FILTER_OPTIONS}
              ariaLabel="Filter by review readiness"
              onChange={(value) => {
                setReadinessFilter(value);
                reload(value);
              }}
            />
          </div>

          {loadError && (
            <div className="flex items-center gap-2 border-b border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
              <AlertTriangle size={16} className="shrink-0" />
              {loadError}
            </div>
          )}

          {decisionError && (
            <div className="flex items-center gap-2 border-b border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
              <AlertTriangle size={16} className="shrink-0" />
              {decisionError}
            </div>
          )}

          <div className={`relative overflow-x-auto transition-opacity ${isPending ? 'opacity-55' : ''}`}>
            <table className="w-full min-w-[1180px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                  <th className="px-2 py-3" aria-label="Expand" />
                  <th className="px-4 py-3 font-medium">Story</th>
                  <th className="px-4 py-3 font-medium">Persona</th>
                  <th className="px-4 py-3 font-medium">Readiness</th>
                  <th className="px-4 py-3 font-medium">Latest verdict</th>
                  <th className="px-4 py-3 font-medium">Decision</th>
                  <th className="px-4 py-3 font-medium">Entered review</th>
                  <th className="px-4 py-3 font-medium">Run</th>
                  <th className="px-4 py-3 font-medium" aria-label="Row actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isExpanded = expandedId === row.run.id;
                  const actions: RowAction[] = [
                    {
                      key: 'approve',
                      label: 'Approve',
                      icon: CheckCircle2,
                      onSelect: () => openDecision(row, 'approved'),
                    },
                    {
                      key: 'rewrite',
                      label: 'Request rewrite',
                      icon: RotateCcw,
                      onSelect: () => openDecision(row, 'rewrite_requested'),
                    },
                    {
                      key: 'reject',
                      label: 'Reject',
                      icon: Ban,
                      tone: 'danger',
                      onSelect: () => openDecision(row, 'rejected'),
                    },
                    {
                      key: 'publish',
                      // Disabled rather than hidden: a reviewer without can_publish should
                      // still see the action exists (and why it's out of reach) instead of
                      // wondering whether the feature is missing. publishRunAction is the
                      // actual gate (canPublish(reviewer) inside it) -- this only controls
                      // whether the click reaches that gate at all.
                      label: canPublish ? 'Publish' : 'Publish (no permission)',
                      icon: Rocket,
                      disabled: !canPublish,
                      onSelect: () => openDecision(row, 'published'),
                    },
                  ];
                  return (
                    <Fragment key={row.run.id}>
                      <tr
                        className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/[0.035]"
                        onClick={() => setExpandedId(isExpanded ? null : row.run.id)}
                      >
                        <td className="px-2 py-4 text-neutral-500">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="px-4 py-4 text-neutral-200">
                          {row.story?.title ?? <span className="text-neutral-600">Untitled</span>}
                          <div className="mt-0.5 font-mono text-[11px] text-neutral-600">
                            {row.story?.id ? shortId(row.story.id) : '—'}
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-neutral-400" title={row.run.personaId ?? undefined}>
                          {shortId(row.run.personaId)}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${QUEUE_READINESS_STYLES[row.readiness]}`}
                          >
                            {QUEUE_READINESS_LABELS[row.readiness]}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {row.latestEvaluation ? (
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${EVALUATION_VERDICT_STYLES[row.latestEvaluation.verdict]}`}
                            >
                              {EVALUATION_VERDICT_LABELS[row.latestEvaluation.verdict]}
                            </span>
                          ) : (
                            <span className="text-neutral-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {row.latestDecision ? (
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${DECISION_STYLES[row.latestDecision.decision]}`}
                              title={row.latestDecision.reviewerLabel ? `By ${row.latestDecision.reviewerLabel}` : undefined}
                            >
                              {DECISION_LABELS[row.latestDecision.decision]}
                            </span>
                          ) : (
                            <span className="text-neutral-600">Undecided</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-neutral-500">{formatDateTime(row.run.finishedAt)}</td>
                        <td className="px-4 py-4 font-mono text-xs text-neutral-500" title={row.run.id}>
                          {shortId(row.run.id)}
                        </td>
                        <td className="px-4 py-4 text-right" onClick={(event) => event.stopPropagation()}>
                          <RowActionsMenu
                            actions={actions}
                            ariaLabel={`Decide on run ${row.run.id}`}
                            busy={busyRunId === row.run.id}
                            className="ml-auto"
                          />
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-white/5 bg-white/[0.02]">
                          <td colSpan={9} className="px-6 py-5">
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                              Evaluation
                            </h4>
                            {row.latestEvaluation ? (
                              <EvaluationEntry evaluation={row.latestEvaluation} />
                            ) : 'evaluated' in row.run.checkpoint ? (
                              <p className="text-sm text-neutral-500">
                                This run passed the &ldquo;Evaluated&rdquo; stage without storing a grade — either
                                migration 108 was unapplied when it ran, or the write failed. It is still genuinely
                                waiting on review; there is simply no recorded score to show.
                              </p>
                            ) : (
                              <p className="text-sm text-neutral-500">
                                No evaluation recorded for this run, and its checkpoint has no &ldquo;evaluated&rdquo;
                                entry either — unexpected for a run at &ldquo;awaiting_review&rdquo;, which normally
                                passes through that stage first.
                              </p>
                            )}
                            <p className="mt-3 text-[11px] text-neutral-600">
                              Full stage timeline and checkpoint: Agentic &gt; Agents &gt; Runs (Run monitor).
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>

            {rows.length === 0 && (
              <div className="px-6 py-16 text-center">
                <ClipboardCheck className="mx-auto h-8 w-8 text-neutral-700" />
                <p className="mt-3 text-sm text-neutral-400">{reason.title}</p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-600">{reason.body}</p>
              </div>
            )}
          </div>
        </>
      )}
    </section>

    <ConfirmDialog
      open={Boolean(decisionTarget)}
      title={decisionTarget ? DECISION_DIALOG_COPY[decisionTarget.kind].title : ''}
      tone={decisionTarget ? DECISION_DIALOG_COPY[decisionTarget.kind].tone : 'default'}
      confirmLabel={decisionTarget ? DECISION_DIALOG_COPY[decisionTarget.kind].confirmLabel : 'Confirm'}
      busy={Boolean(decisionTarget) && busyRunId === decisionTarget?.row.run.id}
      onCancel={() => setDecisionTarget(null)}
      onConfirm={confirmDecision}
      message={
        <div className="space-y-3">
          <p>{decisionTarget ? DECISION_DIALOG_COPY[decisionTarget.kind].body : ''}</p>
          <p className="text-neutral-500">
            {decisionTarget?.row.story?.title ?? 'Untitled'} · {decisionTarget ? shortId(decisionTarget.row.run.id) : ''}
          </p>
          <textarea
            value={decisionNotes}
            onChange={(event) => setDecisionNotes(event.target.value)}
            placeholder="Optional notes for the record (not shown to anyone yet)"
            rows={3}
            className="w-full rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-emerald-400/40 focus:outline-none"
          />
        </div>
      }
    />
    </>
  );
}
