'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  Info,
  Layers,
  Loader2,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  ToggleRight,
  UserPlus,
  XCircle,
} from 'lucide-react';
import FilterDropdown from '@/components/ui/FilterDropdown';
import RowActionsMenu, { type RowAction } from '@/components/ui/RowActionsMenu';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import {
  getCatalogueCoverage,
  proposeCommissionsAction,
  commissionTasksAction,
  listAgentTasksAction,
  assignTaskPersonaAction,
  setAgentTaskStatusAction,
  cancelAgentTaskAction,
  type AgentTask,
  type AgentTaskStatus,
  type AgentTaskListFilters,
  type ProposeCommissionsResult,
} from '@/app/actions/agentic-supervisor';
import type { CoverageGap } from '@/lib/agentic/supervisor.shared';
import type { AgentPersona } from '@/app/actions/agentic-personas';
import { STORY_LANGUAGE_OPTIONS } from '@/lib/ai/story-config';
import { STORY_AUDIENCE_OPTIONS } from '@/lib/ai/story-audience';
import { STORY_GENRES } from '@/lib/story/genres';

// ── Static option / label tables ────────────────────────────────────────

const TASK_STATUS_ORDER: AgentTaskStatus[] = [
  'commissioned',
  'assigned',
  'running',
  'awaiting_review',
  'approved',
  'published',
  'rejected',
  'failed',
  'cancelled',
];

const TASK_STATUS_LABELS: Record<AgentTaskStatus, string> = {
  commissioned: 'Commissioned',
  assigned: 'Assigned',
  running: 'Running',
  awaiting_review: 'Awaiting review',
  approved: 'Approved',
  published: 'Published',
  rejected: 'Rejected',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const TASK_STATUS_STYLES: Record<AgentTaskStatus, string> = {
  commissioned: 'border-neutral-500/25 bg-neutral-500/10 text-neutral-300',
  assigned: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
  running: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
  awaiting_review: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  published: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  rejected: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
  failed: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
  cancelled: 'border-neutral-500/25 bg-neutral-500/10 text-neutral-500',
};

const TASK_STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  ...TASK_STATUS_ORDER.map((value) => ({ value, label: TASK_STATUS_LABELS[value] })),
];

const TASK_STATUS_CHANGE_OPTIONS = TASK_STATUS_ORDER.map((value) => ({ value, label: TASK_STATUS_LABELS[value] }));

const LANGUAGE_FILTER_OPTIONS = [{ value: 'all', label: 'All languages' }, ...STORY_LANGUAGE_OPTIONS];
const AGE_GROUP_FILTER_OPTIONS = [{ value: 'all', label: 'All age groups' }, ...STORY_AUDIENCE_OPTIONS];

function languageLabel(value: string): string {
  return STORY_LANGUAGE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function ageGroupLabel(value: string): string {
  return STORY_AUDIENCE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function genreLabel(value: string | null): string {
  if (!value) return '—';
  return STORY_GENRES.find((option) => option.value === value)?.label ?? value;
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Coverage and the task pool, on one admin page. Follows PersonaCatalogue's
 * shape (filters row + table + honest empty state, ConfirmDialog for every
 * mutation, FilterDropdown for every choice) but covers two related surfaces
 * instead of one, because they share the same "is anything actually on yet"
 * story: coverage needs an active persona to mean anything, and the task pool
 * needs migration 106 to exist at all.
 *
 * Three distinct empty states are surfaced deliberately rather than one bare
 * table, because collapsing them would hide exactly the information an admin
 * needs to act:
 *   1. Coverage empty -- distinguishes "persona schema (103) missing" from
 *      "no active personas" (today's real state -- all 15 seeds are draft)
 *      from "genuinely fully covered".
 *   2. Task pool empty -- distinguishes "migration 106 not applied" (today's
 *      real state) from "applied but nothing commissioned yet" / "no rows
 *      match the filters".
 *   3. Commissioning proposals -- proposeCommissionsAction's own `reason`
 *      (no gaps / no active personas, no model call made) is shown verbatim
 *      instead of an empty proposal list, and rejected proposals are always
 *      shown alongside accepted ones rather than swallowed.
 */
export default function TaskPool({
  initialCoverage,
  initialTasks,
  personas,
  taskSchemaApplied,
  personaSchemaApplied,
}: {
  initialCoverage: CoverageGap[];
  initialTasks: AgentTask[];
  personas: AgentPersona[];
  taskSchemaApplied: boolean;
  personaSchemaApplied: boolean;
}) {
  // ── Coverage state ─────────────────────────────────────────────
  const [coverage, setCoverage] = useState(initialCoverage);
  const [isRefreshingCoverage, setIsRefreshingCoverage] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);

  // ── Task pool state ────────────────────────────────────────────
  const [tasks, setTasks] = useState(initialTasks);
  const [statusFilter, setStatusFilter] = useState('all');
  const [personaFilter, setPersonaFilter] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('all');
  const [ageGroupFilter, setAgeGroupFilter] = useState('all');
  const [isPending, startTransition] = useTransition();
  const [taskError, setTaskError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const [assignTarget, setAssignTarget] = useState<AgentTask | null>(null);
  const [assignPersonaId, setAssignPersonaId] = useState('');
  const [statusTarget, setStatusTarget] = useState<AgentTask | null>(null);
  const [nextStatus, setNextStatus] = useState<string>('assigned');
  const [cancelTarget, setCancelTarget] = useState<AgentTask | null>(null);

  // ── Commissioning flow state ───────────────────────────────────
  const [proposalResult, setProposalResult] = useState<ProposeCommissionsResult | null>(null);
  const [selectedProposals, setSelectedProposals] = useState<Set<number>>(new Set());
  const [isProposing, setIsProposing] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [confirmCommission, setConfirmCommission] = useState(false);
  const [isCommissioning, setIsCommissioning] = useState(false);
  const [commissionError, setCommissionError] = useState<string | null>(null);

  const personaById = useMemo(() => new Map(personas.map((persona) => [persona.id, persona])), [personas]);
  const activePersonas = useMemo(() => personas.filter((persona) => persona.status === 'active'), [personas]);

  const personaFilterOptions = useMemo(
    () => [
      { value: 'all', label: 'All personas' },
      ...personas.map((persona) => ({ value: persona.id, label: persona.displayName })),
    ],
    [personas]
  );
  const assignPersonaOptions = useMemo(
    () => activePersonas.map((persona) => ({ value: persona.id, label: persona.displayName })),
    [activePersonas]
  );

  // AgentTaskListFilters only supports status/personaId/origin/isTest -- language
  // and ageGroup are filtered client-side against whatever the server already
  // returned, rather than round-tripping for a filter the action can't express.
  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (languageFilter !== 'all' && task.language !== languageFilter) return false;
      if (ageGroupFilter !== 'all' && task.ageGroup !== ageGroupFilter) return false;
      return true;
    });
  }, [tasks, languageFilter, ageGroupFilter]);

  const taskFiltersActive =
    statusFilter !== 'all' || personaFilter !== 'all' || languageFilter !== 'all' || ageGroupFilter !== 'all';

  function coverageEmptyReason(): { title: string; body: string } {
    if (!personaSchemaApplied) {
      return {
        title: 'Migration 103 has not been applied to this environment yet.',
        body: "The persona tables don't exist here, so there is no persona data to check coverage against. Apply 103_agent_personas.sql in the Supabase dashboard, then reload.",
      };
    }
    if (activePersonas.length === 0) {
      return {
        title: 'No active personas.',
        body: `All ${personas.length} persona${personas.length === 1 ? '' : 's'} in the catalogue ${
          personas.length === 1 ? 'is' : 'are'
        } draft, testing, paused, or archived, so none can serve any language / age-group / genre cell yet. Activate at least one on the Personas page to see gaps here.`,
      };
    }
    return {
      title: 'No coverage gaps found.',
      body: `Every taxonomy cell that ${activePersonas.length} active persona${
        activePersonas.length === 1 ? '' : 's'
      } could serve already has published or agent-authored coverage.`,
    };
  }

  async function refreshCoverage() {
    setIsRefreshingCoverage(true);
    setCoverageError(null);
    try {
      const result = await getCatalogueCoverage();
      setCoverage(result);
    } catch (error) {
      setCoverageError(error instanceof Error ? error.message : 'Unable to refresh coverage.');
    } finally {
      setIsRefreshingCoverage(false);
    }
  }

  function reloadTasks(next: Partial<{ status: string; personaId: string }> = {}) {
    const nextStatusValue = next.status ?? statusFilter;
    const nextPersonaValue = next.personaId ?? personaFilter;

    const filters: AgentTaskListFilters = {};
    if (nextStatusValue !== 'all') filters.status = nextStatusValue as AgentTaskStatus;
    if (nextPersonaValue !== 'all') filters.personaId = nextPersonaValue;

    setTaskError(null);
    startTransition(async () => {
      try {
        const result = await listAgentTasksAction(filters);
        setTasks(result);
      } catch (error) {
        setTaskError(error instanceof Error ? error.message : 'Unable to load the task pool.');
      }
    });
  }

  function upsertTask(saved: AgentTask) {
    setTasks((current) => {
      const exists = current.some((task) => task.id === saved.id);
      return exists ? current.map((task) => (task.id === saved.id ? saved : task)) : [saved, ...current];
    });
  }

  function openAssign(task: AgentTask) {
    setAssignTarget(task);
    setAssignPersonaId(task.personaId ?? assignPersonaOptions[0]?.value ?? '');
    setTaskError(null);
  }

  async function confirmAssign() {
    if (!assignTarget || !assignPersonaId) return;
    setBusyTaskId(assignTarget.id);
    setTaskError(null);
    try {
      const updated = await assignTaskPersonaAction(assignTarget.id, assignPersonaId);
      upsertTask(updated);
      setAssignTarget(null);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Unable to assign persona.');
    } finally {
      setBusyTaskId(null);
    }
  }

  function openStatusChange(task: AgentTask) {
    setStatusTarget(task);
    setNextStatus(task.status);
    setTaskError(null);
  }

  async function confirmStatusChange() {
    if (!statusTarget) return;
    setBusyTaskId(statusTarget.id);
    setTaskError(null);
    try {
      const updated = await setAgentTaskStatusAction(statusTarget.id, nextStatus as AgentTaskStatus);
      upsertTask(updated);
      setStatusTarget(null);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Unable to change status.');
    } finally {
      setBusyTaskId(null);
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setBusyTaskId(cancelTarget.id);
    setTaskError(null);
    try {
      const updated = await cancelAgentTaskAction(cancelTarget.id);
      upsertTask(updated);
      setCancelTarget(null);
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Unable to cancel task.');
    } finally {
      setBusyTaskId(null);
    }
  }

  async function handlePropose() {
    setIsProposing(true);
    setProposalError(null);
    setCommissionError(null);
    try {
      const result = await proposeCommissionsAction();
      setProposalResult(result);
      setSelectedProposals(new Set(result.accepted.map((_, index) => index)));
    } catch (error) {
      setProposalResult(null);
      setProposalError(error instanceof Error ? error.message : 'Unable to propose commissions.');
    } finally {
      setIsProposing(false);
    }
  }

  function toggleProposalSelection(index: number) {
    setSelectedProposals((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function confirmCommissionSelected() {
    if (!proposalResult) return;
    const selected = proposalResult.accepted.filter((_, index) => selectedProposals.has(index));
    if (selected.length === 0) return;

    setIsCommissioning(true);
    setCommissionError(null);
    try {
      const created = await commissionTasksAction(selected);
      setTasks((current) => [...created, ...current]);
      setProposalResult((current) => {
        if (!current) return current;
        const remainingAccepted = current.accepted.filter((_, index) => !selectedProposals.has(index));
        return { ...current, accepted: remainingAccepted };
      });
      setSelectedProposals(new Set());
      setConfirmCommission(false);
    } catch (error) {
      setCommissionError(error instanceof Error ? error.message : 'Unable to commission the selected proposals.');
    } finally {
      setIsCommissioning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Coverage ─────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
              <Gauge className="h-4 w-4 text-emerald-300" />
              Catalogue coverage
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              Every language × age-group × genre cell an active persona could serve, ranked most urgent first.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshCoverage}
            disabled={isRefreshingCoverage}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-neutral-800 px-3 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 disabled:opacity-50"
          >
            {isRefreshingCoverage ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        </div>

        {coverageError && (
          <div className="flex items-center gap-2 border-b border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
            <AlertTriangle size={16} className="shrink-0" />
            {coverageError}
          </div>
        )}

        {coverage.length === 0 ? (
          (() => {
            const reason = coverageEmptyReason();
            return (
              <div className="px-6 py-14 text-center">
                <Layers className="mx-auto h-8 w-8 text-neutral-700" />
                <p className="mt-3 text-sm font-medium text-neutral-300">{reason.title}</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-neutral-600">{reason.body}</p>
              </div>
            );
          })()
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Language</th>
                  <th className="px-4 py-3 font-medium">Age group</th>
                  <th className="px-4 py-3 font-medium">Genre</th>
                  <th className="px-4 py-3 font-medium">Published</th>
                  <th className="px-4 py-3 font-medium">Agent-authored</th>
                  <th className="px-4 py-3 font-medium">Servable by</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((gap) => (
                  <tr key={`${gap.language}|${gap.ageGroup}|${gap.genre}`} className="border-b border-white/5">
                    <td className="px-4 py-3 text-neutral-500">{gap.priority}</td>
                    <td className="px-4 py-3 text-neutral-200">{languageLabel(gap.language)}</td>
                    <td className="px-4 py-3 text-neutral-200">{ageGroupLabel(gap.ageGroup)}</td>
                    <td className="px-4 py-3 text-neutral-200">{genreLabel(gap.genre)}</td>
                    <td className="px-4 py-3 text-neutral-400">{gap.publishedCount}</td>
                    <td className="px-4 py-3 text-neutral-400">{gap.agentCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-64 flex-wrap gap-1">
                        {gap.servingPersonaIds.length === 0 ? (
                          <span className="text-xs text-neutral-600">—</span>
                        ) : (
                          gap.servingPersonaIds.map((id) => (
                            <span
                              key={id}
                              className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-neutral-300"
                            >
                              {personaById.get(id)?.displayName ?? id}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Task pool ────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="border-b border-white/10 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
            <ClipboardCheck className="h-4 w-4 text-emerald-300" />
            Task pool
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Commission new work against the gaps above, then track it through review and publication.
          </p>
        </div>

        {!taskSchemaApplied ? (
          <div className="flex gap-4 p-5">
            <ShieldAlert size={22} className="mt-0.5 shrink-0 text-amber-300" />
            <div className="space-y-1 text-sm text-neutral-200">
              <p className="font-medium text-amber-200">Migration 106 has not been applied to this environment yet.</p>
              <p className="text-neutral-300">
                The task table (<code className="text-neutral-100">agent_tasks</code>) doesn&apos;t exist here, so
                there is nowhere to commission or list tasks. Apply{' '}
                <code className="text-neutral-100">106_agent_tasks.sql</code> in the Supabase dashboard for this
                environment, then reload.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Commissioning flow */}
            <div className="space-y-4 border-b border-white/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-neutral-200">Propose commissions</h3>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    Asks the planning model for up to a handful of commissions against the gaps above. Nothing is
                    written until you review and confirm below.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePropose}
                  disabled={isProposing}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:opacity-50"
                >
                  {isProposing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Propose commissions
                </button>
              </div>

              {proposalError && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                  <AlertTriangle size={16} className="shrink-0" />
                  {proposalError}
                </div>
              )}

              {proposalResult && (
                <div className="space-y-4">
                  {proposalResult.reason ? (
                    <div className="flex items-start gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] p-3 text-sm text-indigo-200">
                      <Info size={16} className="mt-0.5 shrink-0" />
                      {proposalResult.reason}
                    </div>
                  ) : proposalResult.accepted.length === 0 && proposalResult.rejected.length === 0 ? (
                    <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-neutral-400">
                      <Info size={16} className="mt-0.5 shrink-0" />
                      The planning model proposed no commissions this round.
                    </div>
                  ) : (
                    <>
                      {proposalResult.accepted.length > 0 && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Accepted proposals ({proposalResult.accepted.length})
                            </p>
                            <button
                              type="button"
                              onClick={() => setConfirmCommission(true)}
                              disabled={selectedProposals.size === 0}
                              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-400 px-3 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:opacity-40"
                            >
                              Commission selected ({selectedProposals.size})
                            </button>
                          </div>
                          <div className="overflow-x-auto rounded-xl border border-white/10">
                            <table className="w-full min-w-[760px] text-sm">
                              <thead>
                                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                                  <th className="px-3 py-2 font-medium" aria-label="Select" />
                                  <th className="px-3 py-2 font-medium">Persona</th>
                                  <th className="px-3 py-2 font-medium">Language / Age / Genre</th>
                                  <th className="px-3 py-2 font-medium">Brief</th>
                                  <th className="px-3 py-2 font-medium">Rationale</th>
                                  <th className="px-3 py-2 font-medium">Gap</th>
                                </tr>
                              </thead>
                              <tbody>
                                {proposalResult.accepted.map((proposal, index) => (
                                  <tr key={`${proposal.personaSlug}-${index}`} className="border-b border-white/5">
                                    <td className="px-3 py-2">
                                      <input
                                        type="checkbox"
                                        checked={selectedProposals.has(index)}
                                        onChange={() => toggleProposalSelection(index)}
                                        className="h-4 w-4 rounded border-white/20 bg-neutral-800 accent-emerald-400"
                                        aria-label={`Select proposal for ${proposal.personaSlug}`}
                                      />
                                    </td>
                                    <td className="px-3 py-2 text-neutral-200">{proposal.personaSlug}</td>
                                    <td className="px-3 py-2 text-neutral-400">
                                      {languageLabel(proposal.language)} / {ageGroupLabel(proposal.ageGroup)} /{' '}
                                      {genreLabel(proposal.genre)}
                                    </td>
                                    <td className="px-3 py-2 text-neutral-300" title={proposal.brief}>
                                      {truncate(proposal.brief, 90)}
                                    </td>
                                    <td className="px-3 py-2 text-neutral-500" title={proposal.rationale}>
                                      {truncate(proposal.rationale, 70)}
                                    </td>
                                    <td className="px-3 py-2 text-neutral-500">{proposal.gapPriority ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {proposalResult.rejected.length > 0 && (
                        <div className="space-y-2">
                          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-rose-300">
                            <XCircle className="h-3.5 w-3.5" />
                            Rejected proposals ({proposalResult.rejected.length})
                          </p>
                          <ul className="space-y-1.5">
                            {proposalResult.rejected.map((rejection, index) => (
                              <li
                                key={index}
                                className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-200"
                              >
                                {rejection.reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-4">
              <FilterDropdown
                value={statusFilter}
                options={TASK_STATUS_FILTER_OPTIONS}
                ariaLabel="Filter tasks by status"
                onChange={(value) => {
                  setStatusFilter(value);
                  reloadTasks({ status: value });
                }}
              />
              <FilterDropdown
                value={languageFilter}
                options={LANGUAGE_FILTER_OPTIONS}
                ariaLabel="Filter tasks by language"
                onChange={setLanguageFilter}
              />
              <FilterDropdown
                value={ageGroupFilter}
                options={AGE_GROUP_FILTER_OPTIONS}
                ariaLabel="Filter tasks by age group"
                onChange={setAgeGroupFilter}
              />
              <FilterDropdown
                value={personaFilter}
                options={personaFilterOptions}
                ariaLabel="Filter tasks by persona"
                onChange={(value) => {
                  setPersonaFilter(value);
                  reloadTasks({ personaId: value });
                }}
              />
            </div>

            {taskError && (
              <div className="flex items-center gap-2 border-b border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
                <AlertTriangle size={16} className="shrink-0" />
                {taskError}
              </div>
            )}

            <div className={`relative overflow-x-auto transition-opacity ${isPending ? 'opacity-55' : ''}`}>
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Language</th>
                    <th className="px-4 py-3 font-medium">Age group</th>
                    <th className="px-4 py-3 font-medium">Genre</th>
                    <th className="px-4 py-3 font-medium">Persona</th>
                    <th className="px-4 py-3 font-medium">Brief</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium" aria-label="Row actions" />
                  </tr>
                </thead>
                <tbody>
                  {visibleTasks.map((task) => {
                    const actions: RowAction[] = [
                      {
                        key: 'assign',
                        label: 'Assign persona',
                        icon: UserPlus,
                        onSelect: () => openAssign(task),
                        disabled: activePersonas.length === 0,
                      },
                      {
                        key: 'status',
                        label: 'Change status',
                        icon: ToggleRight,
                        onSelect: () => openStatusChange(task),
                      },
                      {
                        key: 'cancel',
                        label: 'Cancel',
                        icon: Ban,
                        tone: 'danger',
                        onSelect: () => setCancelTarget(task),
                        disabled: task.status === 'cancelled',
                      },
                    ];

                    const persona = task.personaId ? personaById.get(task.personaId) : undefined;

                    return (
                      <tr key={task.id} className="border-b border-white/5 transition-colors hover:bg-white/[0.035]">
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TASK_STATUS_STYLES[task.status]}`}
                          >
                            {TASK_STATUS_LABELS[task.status]}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-neutral-300">{languageLabel(task.language)}</td>
                        <td className="px-4 py-4 text-neutral-300">{ageGroupLabel(task.ageGroup)}</td>
                        <td className="px-4 py-4 text-neutral-300">{genreLabel(task.genre)}</td>
                        <td className="px-4 py-4 text-neutral-300">
                          {persona ? (
                            persona.displayName
                          ) : task.personaId ? (
                            task.personaId
                          ) : (
                            <span className="text-neutral-600">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-neutral-300" title={task.brief}>
                          {truncate(task.brief, 80)}
                        </td>
                        <td className="px-4 py-4 text-neutral-500">{formatDateTime(task.createdAt)}</td>
                        <td className="px-4 py-4 text-right">
                          <RowActionsMenu
                            actions={actions}
                            ariaLabel={`Actions for task ${task.id}`}
                            busy={busyTaskId === task.id}
                            className="ml-auto"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {visibleTasks.length === 0 && (
                <div className="px-6 py-16 text-center">
                  <ClipboardCheck className="mx-auto h-8 w-8 text-neutral-700" />
                  {taskFiltersActive ? (
                    <p className="mt-3 text-sm text-neutral-400">No tasks match these filters.</p>
                  ) : (
                    <>
                      <p className="mt-3 text-sm text-neutral-400">No tasks commissioned yet.</p>
                      <p className="mx-auto mt-1 max-w-sm text-xs text-neutral-600">
                        Use &ldquo;Propose commissions&rdquo; above once there are coverage gaps and the Editorial
                        Supervisor flag is on.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Dialogs ──────────────────────────────────────────────── */}
      <ConfirmDialog
        open={Boolean(assignTarget)}
        title="Assign a persona to this task"
        message={
          <div className="space-y-3">
            <p>Sets the task to &ldquo;assigned&rdquo; once a persona is attached.</p>
            {assignPersonaOptions.length === 0 ? (
              <p className="text-amber-300">No active personas available. Activate one on the Personas page first.</p>
            ) : (
              <FilterDropdown
                value={assignPersonaId}
                options={assignPersonaOptions}
                onChange={setAssignPersonaId}
                ariaLabel="Persona to assign"
                fullWidth
              />
            )}
          </div>
        }
        confirmLabel="Assign"
        busy={Boolean(assignTarget) && busyTaskId === assignTarget?.id}
        onCancel={() => setAssignTarget(null)}
        onConfirm={confirmAssign}
      />

      <ConfirmDialog
        open={Boolean(statusTarget)}
        title="Change status for this task"
        message={
          <div className="space-y-3">
            <p>Currently {statusTarget ? TASK_STATUS_LABELS[statusTarget.status] : ''}.</p>
            <FilterDropdown
              value={nextStatus}
              options={TASK_STATUS_CHANGE_OPTIONS}
              onChange={setNextStatus}
              ariaLabel="New status"
              fullWidth
            />
          </div>
        }
        confirmLabel="Update status"
        busy={Boolean(statusTarget) && busyTaskId === statusTarget?.id}
        onCancel={() => setStatusTarget(null)}
        onConfirm={confirmStatusChange}
      />

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel this task?"
        message="The task moves to “cancelled” and drops out of the active pool. This does not delete it."
        confirmLabel="Cancel task"
        tone="danger"
        busy={Boolean(cancelTarget) && busyTaskId === cancelTarget?.id}
        onCancel={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />

      <ConfirmDialog
        open={confirmCommission}
        title={`Commission ${selectedProposals.size} task${selectedProposals.size === 1 ? '' : 's'}?`}
        message={
          <div className="space-y-2">
            <p>
              This writes {selectedProposals.size} new row{selectedProposals.size === 1 ? '' : 's'} into the task
              pool.
            </p>
            {commissionError && <p className="text-rose-300">{commissionError}</p>}
          </div>
        }
        confirmLabel="Commission"
        busy={isCommissioning}
        onCancel={() => setConfirmCommission(false)}
        onConfirm={confirmCommissionSelected}
      />
    </div>
  );
}
