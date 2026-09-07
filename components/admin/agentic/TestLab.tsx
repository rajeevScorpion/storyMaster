'use client';

import { useState, type ComponentType, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Bot,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Gauge,
  Layers,
  Loader2,
  Play,
  RefreshCcw,
  Route,
  ScrollText,
  Settings2,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import FilterDropdown from '@/components/ui/FilterDropdown';
import {
  startTestLabRunAction,
  continueTestLabRunAction,
  getTestLabRunAction,
  promoteTestLabRunAction,
  type TestLabRunView,
  type TestLabNoveltyPreview,
} from '@/app/actions/agentic-test-lab';
import type { AgentRunEventLevel } from '@/app/actions/agentic-runs';
import type { AgentRunStage, AgentRunStatus } from '@/lib/agentic/orchestrator.shared';
import type { AgentTaskKey, AgentTaskRole } from '@/lib/agentic/routing.shared';
import { TASK_DEFINITIONS } from '@/lib/ai/model-config.shared';

export interface TestLabPersonaOption {
  id: string;
  slug: string;
  displayName: string;
  language: string;
  ageGroup: string;
  status: string;
}

// ── Static option / label tables ────────────────────────────────────────
// Deliberately duplicated from RunMonitor.tsx / the routing page rather than
// exported and shared -- these are small, page-local presentation tables
// (same convention RunMonitor itself follows for its own STAGE_LABELS), and
// keeping them local means neither surface can accidentally shift the
// other's copy when only one needs a new stage/role label.

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

const EVENT_LEVEL_STYLES: Record<AgentRunEventLevel, string> = {
  info: 'text-neutral-300',
  warn: 'text-amber-300',
  error: 'text-rose-300',
};

const ROLE_LABELS: Record<AgentTaskRole, string> = {
  economy: 'Economy',
  standard: 'Standard',
  creative: 'Creative',
};

const ROLE_STYLES: Record<AgentTaskRole, string> = {
  economy: 'border-neutral-500/25 bg-neutral-500/10 text-neutral-300',
  standard: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
  creative: 'border-purple-500/25 bg-purple-500/10 text-purple-300',
};

const NOVELTY_VERDICT_STYLES: Record<string, string> = {
  clear: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  warn: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  block: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
};

function noveltyStyle(verdict: string): string {
  return NOVELTY_VERDICT_STYLES[verdict] ?? 'border-neutral-500/25 bg-neutral-500/10 text-neutral-300';
}

function taskLabel(taskKey: AgentTaskKey): string {
  return TASK_DEFINITIONS.find((task) => task.key === taskKey)?.label ?? taskKey;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

// Each continue pass is one executeRunNow call bounded by RUN_TIME_BUDGET_MS
// (~20s -- lib/agentic/orchestrator.shared.ts), and story_generated alone makes
// roughly 2N+2 paid model calls for an N-beat story (lib/agentic/test-lab.ts's
// continueTestLabRun doc). A persona's beat range tops out well under 15, so 25
// passes is comfortable headroom for a slow model or a persona at the top of
// its range, while still bounding a genuinely broken run rather than looping
// against it forever -- driveRun() below also stops immediately on a `failed`
// status regardless of this cap.
const MAX_AUTO_CONTINUE_PASSES = 25;

// ── Small presentational helpers ────────────────────────────────────────

type SectionIcon = ComponentType<{ className?: string }>;

/** A collapsible result panel. Own local component -- no shared "Collapsible" exists yet in components/ui. */
function Section({
  title,
  icon: Icon,
  defaultOpen = true,
  badge,
  children,
}: {
  title: string;
  icon: SectionIcon;
  defaultOpen?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
          <Icon className="h-4 w-4 text-emerald-300" />
          {title}
        </span>
        <span className="flex items-center gap-3">
          {badge}
          {open ? <ChevronDown className="h-4 w-4 text-neutral-500" /> : <ChevronRight className="h-4 w-4 text-neutral-500" />}
        </span>
      </button>
      {open && <div className="border-t border-white/10 p-4">{children}</div>}
    </section>
  );
}

function ConfigField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-neutral-900/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-sm text-neutral-200">{value}</p>
    </div>
  );
}

function NoveltyCard({
  label,
  preview,
  pendingMessage,
}: {
  label: string;
  preview: TestLabNoveltyPreview | null;
  pendingMessage: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      {preview ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${noveltyStyle(preview.verdict)}`}
            >
              {preview.verdict}
            </span>
            <span className="text-sm text-neutral-300">score {preview.score.toFixed(2)}</span>
          </div>
          <p className="mt-1.5 text-xs text-neutral-500">
            {preview.adjudicated ? 'Model-adjudicated (deterministic score landed in the ambiguous band).' : 'Deterministic scoring only -- no model call was needed.'}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-neutral-500">{pendingMessage}</p>
      )}
    </div>
  );
}

/**
 * Persona Test Lab: pick a persona, optionally type a theme, run the REAL
 * headless pipeline (app/actions/agentic-test-lab.ts, backed by
 * lib/agentic/test-lab.ts) against an is_test agent_task, and inspect
 * everything it produced.
 *
 * THE SAFETY PROPERTY THIS UI RELIES ON (see lib/agentic/test-lab.ts's header
 * for the full explanation, reduced to what matters here): startTestLabRunAction
 * and continueTestLabRunAction can never advance a run past 'story_generated',
 * so nothing this component's "Run test" or auto-continue loop does can ever
 * write agent_story_memory or reach the gallery. The ONLY action that can cross
 * that boundary is promoteTestLabRunAction, wired to its own explicit "Create
 * draft" button below -- never called automatically.
 *
 * AUTO-CONTINUE: RUN_TIME_BUDGET_MS (lib/agentic/orchestrator.shared.ts) is only
 * ~20 seconds while story_generated alone makes roughly 2N+2 paid model calls,
 * so a single pass almost always defers partway through with its progress
 * checkpointed -- exactly the same deferral machinery the cron drain relies on,
 * not a bug. driveRun() below repeatedly calls continueTestLabRunAction while
 * the view reports needsContinue, capped at MAX_AUTO_CONTINUE_PASSES so a
 * genuinely broken run (one that never reaches 'failed' or completion) cannot
 * spin the browser forever; hitting the cap surfaces a "Continue" button rather
 * than silently giving up, since the checkpointed progress is never lost.
 *
 * Three distinct empty/disabled states, matching RunMonitor's model:
 *   1. No personas returned (migration 103/104 likely unapplied, or every
 *      persona archived) -- replaces the whole run form, not just the dropdown.
 *   2. Personas exist but the master flag (agentic_creator_enabled) is off --
 *      today's real state everywhere, so it gets the best-looking explainer,
 *      not a bare disabled button.
 *   3. Any action error (start/continue/refresh/promote) -- surfaced as
 *      readable text next to the control that triggered it, never swallowed.
 */
export default function TestLab({
  initialPersonas,
  creatorEnabled,
}: {
  initialPersonas: TestLabPersonaOption[];
  creatorEnabled: boolean;
}) {
  const [personaId, setPersonaId] = useState(initialPersonas[0]?.id ?? '');
  const [theme, setTheme] = useState('');

  const [view, setView] = useState<TestLabRunView | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [passCount, setPassCount] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [isPromoting, setIsPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  const personaOptions = initialPersonas.map((persona) => ({
    value: persona.id,
    label: persona.displayName,
    hint: `${persona.language} / ${persona.ageGroup}${persona.status !== 'active' ? ` · ${persona.status}` : ''}`,
  }));

  /** Repeatedly calls continueTestLabRunAction until the run stops needing it, fails, or the pass cap is hit. */
  async function driveRun(initial: TestLabRunView): Promise<void> {
    let current = initial;
    let passes = 0;
    setView(current);
    while (current.needsContinue && current.status !== 'failed' && passes < MAX_AUTO_CONTINUE_PASSES) {
      passes += 1;
      setPassCount(passes);
      current = await continueTestLabRunAction(current.runId);
      setView(current);
    }
    if (current.status === 'failed') {
      setRunError(current.errorDetail ?? 'The run failed with no error detail recorded.');
    } else if (current.needsContinue) {
      setRunError(
        `Stopped after ${MAX_AUTO_CONTINUE_PASSES} passes without finishing this stage. Its progress is checkpointed -- press Continue below to keep going.`
      );
    }
  }

  async function handleStartRun() {
    if (!personaId) return;
    const trimmedTheme = theme.trim();
    setRunError(null);
    setPromoteError(null);
    setPassCount(0);
    setView(null);
    setIsRunning(true);
    try {
      const initial = await startTestLabRunAction(personaId, trimmedTheme.length > 0 ? trimmedTheme : null);
      await driveRun(initial);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Failed to start the test run.');
    } finally {
      setIsRunning(false);
    }
  }

  async function handleContinueClick() {
    if (!view) return;
    setRunError(null);
    setIsRunning(true);
    try {
      await driveRun(view);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Failed to continue the test run.');
    } finally {
      setIsRunning(false);
    }
  }

  async function handleRefresh() {
    if (!view) return;
    setRefreshError(null);
    setIsRefreshing(true);
    try {
      const fresh = await getTestLabRunAction(view.runId);
      if (fresh) setView(fresh);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'Failed to refresh this run.');
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handlePromote() {
    if (!view) return;
    setPromoteError(null);
    setIsPromoting(true);
    try {
      const promoted = await promoteTestLabRunAction(view.runId);
      setView(promoted);
    } catch (error) {
      setPromoteError(error instanceof Error ? error.message : 'Failed to promote this run.');
    } finally {
      setIsPromoting(false);
    }
  }

  if (initialPersonas.length === 0) {
    return (
      <div className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <ShieldAlert size={22} className="mt-0.5 shrink-0 text-amber-300" />
        <div className="space-y-2 text-sm text-neutral-200">
          <p className="font-medium text-amber-200">No personas available.</p>
          <p className="text-neutral-300">
            Migration 103 (agent_personas) or its seed rows may not be applied to this environment yet, or every
            persona has been archived. Apply the migration in the Supabase dashboard, or create/restore a persona in
            the catalogue, then reload this page.
          </p>
          <Link
            href="/admin/agents/personas"
            className="inline-flex items-center gap-1.5 font-medium text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
          >
            Open the persona catalogue
          </Link>
        </div>
      </div>
    );
  }

  const progressPct = view && view.targetBeatCount > 0 ? Math.min(100, Math.round((view.beats.length / view.targetBeatCount) * 100)) : 0;
  const showContinueCallout = Boolean(view) && !view!.storyId && !isRunning && view!.needsContinue && view!.status !== 'failed';

  return (
    <div className="space-y-6">
      {!creatorEnabled && (
        <div className="flex gap-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-5">
          <Bot size={22} className="mt-0.5 shrink-0 text-emerald-300" />
          <div className="space-y-1 text-sm text-neutral-200">
            <p className="font-medium text-emerald-200">The Agentic Creator System is currently off.</p>
            <p className="text-neutral-300">
              The master switch (<code className="text-neutral-100">agentic_creator_enabled</code>) is off on this
              environment, so Run test, Continue, and Create draft are disabled below. Browsing personas and reading
              a previously parked run still works. Flip the switch on the Agents Overview page to actually execute a
              test run.
            </p>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
        <div className="border-b border-white/10 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
            <Users className="h-4 w-4 text-emerald-300" />
            Run a test
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Runs the real pipeline against one persona with <code className="text-neutral-400">agent_tasks.is_test = true</code>.
            Every seed persona is currently &ldquo;draft&rdquo; status -- that is expected here, not an error.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[240px]">
            <label className="mb-1.5 block text-xs text-neutral-400">Persona</label>
            <FilterDropdown value={personaId} options={personaOptions} onChange={setPersonaId} ariaLabel="Select a persona" fullWidth />
          </div>
          <div className="min-w-[240px] flex-1">
            <label className="mb-1.5 block text-xs text-neutral-400" htmlFor="test-lab-theme">
              Theme (optional)
            </label>
            <input
              id="test-lab-theme"
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
              placeholder="Leave blank to let the persona choose its own theme"
              className="w-full rounded-xl border border-white/10 bg-neutral-900/80 px-3 py-2 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-emerald-500/40"
            />
          </div>
          <button
            type="button"
            onClick={handleStartRun}
            disabled={!creatorEnabled || isRunning || !personaId}
            title={!creatorEnabled ? 'Turn on the master switch on the Agents Overview page first.' : undefined}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:opacity-50"
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run test
          </button>
        </div>
        {runError && (
          <div className="flex items-center gap-2 border-t border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
            <AlertTriangle size={16} className="shrink-0" />
            {runError}
          </div>
        )}
      </section>

      {view && (
        <>
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${RUN_STATUS_STYLES[view.status]}`}
                >
                  {RUN_STATUS_LABELS[view.status]}
                </span>
                <span className="text-sm text-neutral-300">{stageLabel(view.stage)}</span>
                <span className="text-xs text-neutral-500">
                  Attempts {view.attemptCount}/{view.maxAttempts}
                </span>
                <span className="text-xs text-neutral-500">Persona: {view.personaName}</span>
              </div>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-neutral-800 px-2.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 disabled:opacity-50"
              >
                {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                Refresh
              </button>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span>Beats</span>
                <span>
                  {view.beats.length} / {view.targetBeatCount}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {isRunning && (
              <p className="mt-3 flex items-start gap-2 text-xs text-indigo-300">
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                Auto-continuing (pass {passCount} of {MAX_AUTO_CONTINUE_PASSES})... each pass is capped at roughly 20
                seconds while this stage makes many paid model calls, so stopping partway and resuming is expected,
                not stuck.
              </p>
            )}
            {refreshError && <p className="mt-2 text-xs text-rose-300">{refreshError}</p>}
          </section>

          {view.status === 'failed' && (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
              <div>
                <p className="text-sm font-medium text-rose-200">This run failed.</p>
                <p className="mt-1 text-sm text-neutral-300">{view.errorDetail ?? 'No error detail was recorded.'}</p>
              </div>
            </div>
          )}

          {showContinueCallout && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-500/25 bg-indigo-500/10 p-4">
              <div>
                <p className="text-sm font-medium text-indigo-200">Stopped without finishing this stage.</p>
                <p className="mt-1 text-xs text-neutral-300">
                  Its progress is checkpointed -- nothing is lost. Press Continue to resume from where it left off.
                </p>
              </div>
              <button
                type="button"
                onClick={handleContinueClick}
                disabled={!creatorEnabled}
                title={!creatorEnabled ? 'Turn on the master switch on the Agents Overview page first.' : undefined}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-indigo-400 px-3 text-xs font-semibold text-neutral-950 transition-colors hover:bg-indigo-300 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                Continue
              </button>
            </div>
          )}

          {!view.storyId && view.readyToPromote && (
            <div className="space-y-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                <div>
                  <p className="text-sm font-medium text-emerald-200">Ready to promote.</p>
                  <p className="mt-1 text-sm text-neutral-300">
                    Nothing has been written to <code className="text-neutral-100">agent_story_memory</code> and nothing
                    has reached the gallery. This run is parked one stage before{' '}
                    <code className="text-neutral-100">draft_created</code> -- the only stage that saves a story or
                    records memory. Inspect the panels below, then press Create draft when satisfied.
                  </p>
                </div>
              </div>
              {promoteError && <p className="text-sm text-rose-300">{promoteError}</p>}
              <button
                type="button"
                onClick={handlePromote}
                disabled={isPromoting || !creatorEnabled}
                title={!creatorEnabled ? 'Turn on the master switch on the Agents Overview page first.' : undefined}
                className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-400 px-3 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:opacity-50"
              >
                {isPromoting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Create draft
              </button>
            </div>
          )}

          {view.storyId && (
            <div className="space-y-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
              <p className="text-sm font-medium text-emerald-200">Draft created.</p>
              <p className="text-sm text-neutral-300">
                The draft is owned by the agentic system user, so an admin can open and read it but cannot edit or
                continue it -- <code className="text-neutral-100">stories</code> RLS allows any signed-in user to
                SELECT a non-archived story but restricts UPDATE to{' '}
                <code className="text-neutral-100">auth.uid() = user_id</code>.
              </p>
              <Link
                href={`/story/${view.storyId}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
              >
                Open /story/{view.storyId}
              </Link>
            </div>
          )}

          <Section title="Brief" icon={FileText}>
            {view.brief ? (
              <div className="space-y-4 text-sm text-neutral-300">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Working title</p>
                  <p className="mt-1 text-neutral-100">{view.brief.workingTitle}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Premise</p>
                  <p className="mt-1">{view.brief.premise}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Themes</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {view.brief.themes.map((themeItem) => (
                      <span
                        key={themeItem}
                        className="rounded-full border border-white/10 bg-neutral-900/60 px-2.5 py-1 text-xs text-neutral-300"
                      >
                        {themeItem}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Characters</p>
                  <div className="mt-1.5 space-y-2">
                    {view.brief.characters.map((character) => (
                      <div key={character.name} className="rounded-lg border border-white/10 bg-neutral-900/60 p-3">
                        <p className="text-sm font-medium text-neutral-100">
                          {character.name} <span className="font-normal text-neutral-500">&mdash; {character.role}</span>
                        </p>
                        <p className="mt-1 text-xs text-neutral-400">{character.appearanceSummary}</p>
                        <p className="mt-1 text-xs text-neutral-400">{character.personalitySummary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">Not available yet -- the run has not reached brief_ready.</p>
            )}
          </Section>

          <Section title="Source text" icon={ScrollText} defaultOpen={false}>
            {view.sourceText ? (
              <div className="max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-neutral-950 p-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">{view.sourceText}</p>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">Not available yet -- the seed prose has not been generated.</p>
            )}
          </Section>

          <Section title="Seed plan" icon={Layers} defaultOpen={false}>
            {view.seedPlan ? (
              <div className="space-y-3">
                <p className="text-xs text-neutral-500">{view.seedPlan.beatCount} planned beats.</p>
                {view.seedPlan.beats.map((beat) => (
                  <div key={beat.beatIndex} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-neutral-100">
                        Beat {beat.beatIndex + 1}: {beat.title}
                      </p>
                      {beat.isEnding && (
                        <span className="rounded-full border border-purple-500/25 bg-purple-500/10 px-2 py-0.5 text-[11px] text-purple-300">
                          Ending
                        </span>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{beat.storyText}</p>
                    <p className="mt-2 text-xs italic text-neutral-500">{beat.sceneSummary}</p>
                    {beat.options.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {beat.options.map((option) => (
                          <li key={option.id} className="text-xs text-neutral-400">
                            <span className="text-neutral-200">{option.label}</span>
                            {option.isCanonical && <span className="ml-1 text-emerald-400">(canonical)</span>} &mdash; {option.intent}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">Not available yet -- the seed plan has not been generated.</p>
            )}
          </Section>

          <Section title="Beats" icon={BookOpenText} badge={<span className="text-xs text-neutral-500">{view.beats.length}</span>}>
            {view.beats.length > 0 ? (
              <div className="space-y-4">
                {view.beats.map((beat) => (
                  <div key={beat.beatNumber} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-neutral-100">
                        Beat {beat.beatNumber}: {beat.title}
                      </p>
                      {beat.isEnding && (
                        <span className="rounded-full border border-purple-500/25 bg-purple-500/10 px-2 py-0.5 text-[11px] text-purple-300">
                          Ending
                        </span>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-300">{beat.storyText}</p>

                    {beat.characters.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Characters</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {beat.characters.map((character) => (
                            <span
                              key={character.id}
                              title={character.appearanceSummary}
                              className="rounded-full border border-white/10 bg-neutral-950 px-2.5 py-1 text-xs text-neutral-300"
                            >
                              {character.name} <span className="text-neutral-500">&middot; {character.type}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {beat.options.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Options</p>
                        <ul className="mt-1.5 space-y-1">
                          {beat.options.map((option) => (
                            <li key={option.id} className="text-xs text-neutral-400">
                              <span className="text-neutral-200">{option.label}</span> &mdash; {option.intent}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {beat.continuityNotes.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Continuity notes</p>
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-neutral-400">
                          {beat.continuityNotes.map((note, index) => (
                            <li key={index}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                        Storyboard prompt (text only -- no image is rendered)
                      </p>
                      <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-neutral-950 p-3 text-[11px] text-neutral-400">
                        {beat.imagePrompt}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">No beats materialized yet.</p>
            )}
          </Section>

          <Section title="Resolved config" icon={Settings2} defaultOpen={false}>
            <div className="space-y-4">
              <div
                className={`flex items-start gap-3 rounded-xl border p-4 ${
                  view.storyConfig.imageGenerationMode === 'prompt_only'
                    ? 'border-emerald-500/25 bg-emerald-500/10'
                    : 'border-amber-500/25 bg-amber-500/10'
                }`}
              >
                <ShieldAlert
                  className={`mt-0.5 h-5 w-5 shrink-0 ${
                    view.storyConfig.imageGenerationMode === 'prompt_only' ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                />
                <div>
                  <p
                    className={`text-sm font-medium ${
                      view.storyConfig.imageGenerationMode === 'prompt_only' ? 'text-emerald-200' : 'text-amber-200'
                    }`}
                  >
                    imageGenerationMode: {view.storyConfig.imageGenerationMode}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-300">
                    {view.storyConfig.imageGenerationMode === 'prompt_only'
                      ? 'Images are off, as expected for the Test Lab -- only storyboard prompt text is produced, and this UI never renders it as an image.'
                      : 'Unexpected: the Test Lab is meant to run prompt-only. Treat this run as unrepresentative until this is investigated.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <ConfigField label="Story kind" value={view.storyConfig.storyKind} />
                <ConfigField label="Age group" value={view.storyConfig.ageGroup} />
                <ConfigField label="Genre" value={view.storyConfig.genre ?? '—'} />
                <ConfigField label="Language" value={view.storyConfig.language} />
                <ConfigField label="Setting country" value={view.storyConfig.settingCountry} />
                <ConfigField label="Max beats" value={String(view.storyConfig.maxBeats)} />
                <ConfigField label="Vertical story" value={view.storyConfig.isVerticalStory ? 'Yes' : 'No'} />
                <ConfigField label="Aspect ratio" value={view.storyConfig.aspectRatio} />
                <ConfigField label="Image delivery mode" value={view.storyConfig.imageDeliveryMode ?? '—'} />
                <ConfigField label="Image continuity" value={view.storyConfig.imageContinuityStrategy} />
              </div>

              <details className="rounded-xl border border-white/10 bg-neutral-900/60 p-3">
                <summary className="cursor-pointer text-xs font-medium text-neutral-400">Full resolved config (JSON)</summary>
                <pre className="mt-2 max-h-64 overflow-auto text-[11px] text-neutral-300">
                  {JSON.stringify(view.storyConfig, null, 2)}
                </pre>
              </details>
            </div>
          </Section>

          <Section title="Model routing" icon={Route} defaultOpen={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.12em] text-neutral-600">
                    <th className="px-3 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 font-medium">Temperature</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {view.modelRouting.map((route) => (
                    <tr key={route.taskKey} className="border-b border-white/5">
                      <td className="px-3 py-2 text-neutral-200">{taskLabel(route.taskKey)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${ROLE_STYLES[route.role]}`}
                        >
                          {ROLE_LABELS[route.role]}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-neutral-300">{route.model}</td>
                      <td className="px-3 py-2 text-neutral-400">{route.temperature ?? '—'}</td>
                      <td className="px-3 py-2 text-neutral-400">
                        {route.source === 'persona_override' ? 'Persona override' : 'Global config'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Novelty" icon={Gauge} defaultOpen={false}>
            <div className="grid gap-4 sm:grid-cols-2">
              <NoveltyCard
                label="Pre-generation"
                preview={view.preNovelty}
                pendingMessage="Not available yet -- computed right after the brief, before any prose is written."
              />
              <NoveltyCard
                label="Post-generation (preview)"
                preview={view.postNoveltyPreview}
                pendingMessage="Not yet computed. This preview runs once all beats are complete and the run parks awaiting promotion -- Create draft re-runs the real check independently inside draft_created."
              />
            </div>
          </Section>

          <Section title="Event timeline" icon={ClipboardList} defaultOpen={false}>
            {view.events.length === 0 ? (
              <p className="text-sm text-neutral-500">No events recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {view.events.map((event) => (
                  <li key={event.id} className="rounded-lg border border-white/10 bg-neutral-900/60 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-medium ${EVENT_LEVEL_STYLES[event.level]}`}>{stageLabel(event.stage)}</span>
                      <span className="text-neutral-600">{formatDateTime(event.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-neutral-300">{event.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
