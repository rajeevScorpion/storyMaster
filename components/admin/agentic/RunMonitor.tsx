'use client';

import { Fragment, useState, useTransition } from 'react';
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Info,
  Loader2,
  Play,
  RefreshCcw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import FilterDropdown from '@/components/ui/FilterDropdown';
import RowActionsMenu, { type RowAction } from '@/components/ui/RowActionsMenu';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  listRunsAction,
  getRunAction,
  cancelRunAction,
  retryRunAction,
  kickAgenticWorker,
  type AgentRun,
  type AgentRunEvent,
  type AgentRunEventLevel,
  type AgentRunListFilters,
  type AgentRunStage,
  type AgentRunStatus,
  type AgentRunWithTimeline,
} from '@/app/actions/agentic-runs';
import { STAGE_SEQUENCE } from '@/lib/agentic/orchestrator.shared';

// ── Static option / label tables ────────────────────────────────────────

const RUN_STATUS_ORDER: AgentRunStatus[] = ['pending', 'processing', 'succeeded', 'failed', 'cancelled'];

const RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const RUN_STATUS_STYLES: Record<AgentRunStatus, string> = {
  pending: 'border-neutral-500/25 bg-neutral-500/10 text-neutral-300',
  processing: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
  succeeded: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
  cancelled: 'border-neutral-500/25 bg-neutral-500/10 text-neutral-500',
};

const RUN_STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  ...RUN_STATUS_ORDER.map((value) => ({ value, label: RUN_STATUS_LABELS[value] })),
];

const STAGE_LABELS: Record<AgentRunStage, string> = {
  queued: 'Queued',
  brief_ready: 'Brief ready',
  novelty_checked: 'Novelty checked',
  story_generated: 'Story generated',
  draft_created: 'Draft created',
  narration_pending: 'Narration pending',
  narration_complete: 'Narration complete',
  evaluated: 'Evaluated',
  awaiting_review: 'Awaiting review',
  media_pending: 'Media pending',
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as AgentRunStage] ?? stage;
}

const STAGE_FILTER_OPTIONS = [
  { value: 'all', label: 'All stages' },
  ...STAGE_SEQUENCE.map((value) => ({ value, label: STAGE_LABELS[value] })),
];

const EVENT_LEVEL_STYLES: Record<AgentRunEventLevel, string> = {
  info: 'text-neutral-300',
  warn: 'text-amber-300',
  error: 'text-rose-300',
};

function shortId(id: string | null): string {
  if (!id) return '—';
  return id.slice(0, 8);
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Run list + stage-timeline/checkpoint detail, on one admin page. Follows
 * TaskPool.tsx's shape (filters row + table + honest empty state, ConfirmDialog
 * for every mutation, FilterDropdown for every choice, RowActionsMenu for row
 * actions) but for agent_runs/agent_run_events (migration 107) instead of
 * agent_tasks (106) -- a different migration group with its own latch, so its
 * empty state is checked and reported independently (see `schemaApplied`).
 *
 * Three distinct empty states, exactly like TaskPool's task pool section:
 *   1. Migration 107 not applied (schemaApplied: false) -- today's real state.
 *   2. Applied, but no run has ever been created yet.
 *   3. Applied, runs exist, but none match the current filters.
 * Collapsing these into one bare table would hide exactly the information an
 * operator needs: is the schema even there, or is the queue just empty?
 *
 * The checkpoint view matters more than it looks: a retry resumes from the
 * last checkpointed stage (lib/agentic/orchestrator.shared.ts's
 * isCheckpointed/recordCheckpoint contract) rather than restarting from
 * `queued`, so seeing which stages are already banked is what tells an
 * operator whether a retry will re-pay for anything.
 */
export default function RunMonitor({
  initialRuns,
  schemaApplied,
  creatorEnabled,
}: {
  initialRuns: AgentRun[];
  schemaApplied: boolean;
  creatorEnabled: boolean;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [isPending, startTransition] = useTransition();
  const [runError, setRunError] = useState<string | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<AgentRun | null>(null);
  const [retryTarget, setRetryTarget] = useState<AgentRun | null>(null);

  // ── Detail (stage timeline + checkpoint) ────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, AgentRunWithTimeline>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // ── "Run now" ────────────────────────────────────────────────────
  const [isKicking, setIsKicking] = useState(false);
  const [kickMessage, setKickMessage] = useState<string | null>(null);
  const [kickError, setKickError] = useState<string | null>(null);

  const runFiltersActive = statusFilter !== 'all' || stageFilter !== 'all';

  function reloadRuns(next: Partial<{ status: string; stage: string }> = {}) {
    const nextStatusValue = next.status ?? statusFilter;
    const nextStageValue = next.stage ?? stageFilter;

    const filters: AgentRunListFilters = {};
    if (nextStatusValue !== 'all') filters.status = nextStatusValue as AgentRunStatus;
    if (nextStageValue !== 'all') filters.stage = nextStageValue as AgentRunStage;

    setRunError(null);
    startTransition(async () => {
      try {
        const result = await listRunsAction(filters);
        setRuns(result);
      } catch (error) {
        setRunError(error instanceof Error ? error.message : 'Unable to load runs.');
      }
    });
  }

  function upsertRun(saved: AgentRun) {
    setRuns((current) => current.map((run) => (run.id === saved.id ? saved : run)));
    setDetailCache((current) => {
      const existing = current[saved.id];
      if (!existing) return current;
      return { ...current, [saved.id]: { ...existing, ...saved } };
    });
  }

  async function toggleExpand(run: AgentRun) {
    if (expandedId === run.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(run.id);
    if (detailCache[run.id]) return;

    setLoadingDetailId(run.id);
    setDetailError(null);
    try {
      const detail = await getRunAction(run.id);
      if (detail) {
        setDetailCache((current) => ({ ...current, [run.id]: detail }));
      }
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Unable to load the run timeline.');
    } finally {
      setLoadingDetailId(null);
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setBusyRunId(cancelTarget.id);
    setRunError(null);
    try {
      const updated = await cancelRunAction(cancelTarget.id);
      upsertRun(updated);
      setCancelTarget(null);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Unable to cancel run.');
    } finally {
      setBusyRunId(null);
    }
  }

  async function confirmRetry() {
    if (!retryTarget) return;
    setBusyRunId(retryTarget.id);
    setRunError(null);
    try {
      const updated = await retryRunAction(retryTarget.id);
      upsertRun(updated);
      setRetryTarget(null);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Unable to retry run.');
    } finally {
      setBusyRunId(null);
    }
  }

  async function handleRunNow() {
    setIsKicking(true);
    setKickError(null);
    setKickMessage(null);
    try {
      await kickAgenticWorker();
      setKickMessage('Worker kicked. Give it a few seconds, then refresh to see progress.');
    } catch (error) {
      setKickError(error instanceof Error ? error.message : 'Unable to kick the worker.');
    } finally {
      setIsKicking(false);
    }
  }

  function runsEmptyReason(): { title: string; body: string } {
    if (!schemaApplied) {
      return {
        title: 'Migration 107 has not been applied to this environment yet.',
        body: "The run tables (agent_runs, agent_run_events) don't exist here, so there is nothing to show. Apply 107_agent_runs.sql in the Supabase dashboard for this environment, then reload.",
      };
    }
    if (runFiltersActive) {
      return { title: 'No runs match these filters.', body: 'Clear a filter to see the rest of the queue.' };
    }
    return {
      title: 'No runs yet.',
      body: 'A run is created for a commissioned task (see Task pool). Story generation itself is Phase 6 -- every run that does exist currently defers on its first content stage rather than completing.',
    };
  }

  const emptyReason = runsEmptyReason();

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
              <ClipboardList className="h-4 w-4 text-emerald-300" />
              Run queue
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              Every execution run for a commissioned task, its stage progress, and its checkpointed history.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => reloadRuns()}
              disabled={isPending || !schemaApplied}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-neutral-800 px-3 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
              Refresh
            </button>
            <button
              type="button"
              onClick={handleRunNow}
              disabled={isKicking || !creatorEnabled}
              title={!creatorEnabled ? 'Turn on the master switch on the Agents Overview page first.' : undefined}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-400 px-3 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:opacity-50"
            >
              {isKicking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run now
            </button>
          </div>
        </div>

        {!creatorEnabled && (
          <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-neutral-400">
            <Info size={14} className="shrink-0" />
            The master switch is off, so &ldquo;Run now&rdquo; and per-run actions are disabled. The list above still
            reads fine.
          </div>
        )}

        {kickMessage && (
          <div className="flex items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <Info size={16} className="shrink-0" />
            {kickMessage}
          </div>
        )}
        {kickError && (
          <div className="flex items-center gap-2 border-b border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
            <AlertTriangle size={16} className="shrink-0" />
            {kickError}
          </div>
        )}

        {!schemaApplied ? (
          <div className="flex gap-4 p-5">
            <ShieldAlert size={22} className="mt-0.5 shrink-0 text-amber-300" />
            <div className="space-y-1 text-sm text-neutral-200">
              <p className="font-medium text-amber-200">{emptyReason.title}</p>
              <p className="text-neutral-300">{emptyReason.body}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-4">
              <FilterDropdown
                value={statusFilter}
                options={RUN_STATUS_FILTER_OPTIONS}
                ariaLabel="Filter runs by status"
                onChange={(value) => {
                  setStatusFilter(value);
                  reloadRuns({ status: value });
                }}
              />
              <FilterDropdown
                value={stageFilter}
                options={STAGE_FILTER_OPTIONS}
                ariaLabel="Filter runs by stage"
                onChange={(value) => {
                  setStageFilter(value);
                  reloadRuns({ stage: value });
                }}
              />
            </div>

            {runError && (
              <div className="flex items-center gap-2 border-b border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
                <AlertTriangle size={16} className="shrink-0" />
                {runError}
              </div>
            )}

            <div className={`relative overflow-x-auto transition-opacity ${isPending ? 'opacity-55' : ''}`}>
              <table className="w-full min-w-[1080px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                    <th className="px-2 py-3" aria-label="Expand" />
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Stage</th>
                    <th className="px-4 py-3 font-medium">Attempts</th>
                    <th className="px-4 py-3 font-medium">Persona</th>
                    <th className="px-4 py-3 font-medium">Task</th>
                    <th className="px-4 py-3 font-medium">Error</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium">Finished</th>
                    <th className="px-4 py-3 font-medium" aria-label="Row actions" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const isExpanded = expandedId === run.id;
                    const detail = detailCache[run.id];
                    const isTerminal = run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled';

                    const actions: RowAction[] = [
                      {
                        key: 'retry',
                        label: 'Retry',
                        icon: RotateCcw,
                        onSelect: () => setRetryTarget(run),
                        disabled: !creatorEnabled || (run.status !== 'failed' && run.status !== 'cancelled'),
                      },
                      {
                        key: 'cancel',
                        label: 'Cancel',
                        icon: Ban,
                        tone: 'danger',
                        onSelect: () => setCancelTarget(run),
                        disabled: !creatorEnabled || isTerminal,
                      },
                    ];

                    return (
                      <Fragment key={run.id}>
                        <tr
                          className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/[0.035]"
                          onClick={() => toggleExpand(run)}
                        >
                          <td className="px-2 py-4 text-neutral-500">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${RUN_STATUS_STYLES[run.status]}`}
                            >
                              {RUN_STATUS_LABELS[run.status]}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-neutral-300">{stageLabel(run.stage)}</td>
                          <td className="px-4 py-4 text-neutral-400">
                            {run.attemptCount}/{run.maxAttempts}
                          </td>
                          <td className="px-4 py-4 font-mono text-xs text-neutral-400" title={run.personaId ?? undefined}>
                            {shortId(run.personaId)}
                          </td>
                          <td className="px-4 py-4 font-mono text-xs text-neutral-400" title={run.taskId}>
                            {shortId(run.taskId)}
                          </td>
                          <td className="px-4 py-4 text-neutral-400" title={run.errorDetail ?? undefined}>
                            {run.errorCategory ?? '—'}
                          </td>
                          <td className="px-4 py-4 text-neutral-500">{formatDateTime(run.createdAt)}</td>
                          <td className="px-4 py-4 text-neutral-500">{formatDateTime(run.finishedAt)}</td>
                          <td className="px-4 py-4 text-right" onClick={(event) => event.stopPropagation()}>
                            <RowActionsMenu
                              actions={actions}
                              ariaLabel={`Actions for run ${run.id}`}
                              busy={busyRunId === run.id}
                              className="ml-auto"
                            />
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-white/5 bg-white/[0.02]">
                            <td colSpan={10} className="px-6 py-5">
                              {loadingDetailId === run.id ? (
                                <div className="flex items-center gap-2 text-sm text-neutral-400">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Loading timeline...
                                </div>
                              ) : detailError ? (
                                <p className="text-sm text-rose-300">{detailError}</p>
                              ) : (
                                <div className="grid gap-5 lg:grid-cols-2">
                                  <div>
                                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                      Stage timeline
                                    </h4>
                                    {!detail || detail.events.length === 0 ? (
                                      <p className="text-sm text-neutral-500">No events recorded yet.</p>
                                    ) : (
                                      <ul className="space-y-2">
                                        {detail.events.map((event: AgentRunEvent) => (
                                          <li
                                            key={event.id}
                                            className="rounded-lg border border-white/10 bg-neutral-900/60 p-3 text-xs"
                                          >
                                            <div className="flex items-center justify-between gap-2">
                                              <span className={`font-medium ${EVENT_LEVEL_STYLES[event.level]}`}>
                                                {stageLabel(event.stage)}
                                              </span>
                                              <span className="text-neutral-600">{formatDateTime(event.createdAt)}</span>
                                            </div>
                                            <p className="mt-1 text-neutral-300">{event.message}</p>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                  <div>
                                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                      Checkpoint (stages already banked)
                                    </h4>
                                    {Object.keys(run.checkpoint).length === 0 ? (
                                      <p className="text-sm text-neutral-500">
                                        Empty — no stage has been checkpointed yet. A retry would resume from &ldquo;
                                        {stageLabel(run.stage)}&rdquo;.
                                      </p>
                                    ) : (
                                      <pre className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-neutral-950 p-3 text-[11px] text-neutral-300">
                                        {JSON.stringify(run.checkpoint, null, 2)}
                                      </pre>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              {runs.length === 0 && (
                <div className="px-6 py-16 text-center">
                  <ClipboardList className="mx-auto h-8 w-8 text-neutral-700" />
                  <p className="mt-3 text-sm text-neutral-400">{emptyReason.title}</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-600">{emptyReason.body}</p>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel this run?"
        message="The run moves to “cancelled” regardless of its current stage. This does not delete it, and it can be retried later."
        confirmLabel="Cancel run"
        tone="danger"
        busy={Boolean(cancelTarget) && busyRunId === cancelTarget?.id}
        onCancel={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />

      <ConfirmDialog
        open={Boolean(retryTarget)}
        title="Retry this run?"
        message={
          <div className="space-y-2">
            <p>
              Resumes from stage &ldquo;{retryTarget ? stageLabel(retryTarget.stage) : ''}&rdquo; using its existing
              checkpoint -- already-banked stages are not re-executed. The attempt count resets to 0.
            </p>
          </div>
        }
        confirmLabel="Retry"
        busy={Boolean(retryTarget) && busyRunId === retryTarget?.id}
        onCancel={() => setRetryTarget(null)}
        onConfirm={confirmRetry}
      />
    </div>
  );
}
