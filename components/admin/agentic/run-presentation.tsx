'use client';

// ── Agentic Creator System: run/evaluation presentation helpers ─────────
//
// Extracted verbatim out of RunMonitor.tsx (Unit 9c) so Phase 9's review queue
// (ReviewQueue.tsx, /admin/authors) can show the same stage labels, id/date
// formatting, and evaluation panel as the run monitor (/admin/agents/runs)
// without a second, drifting copy of any of it. Nothing here changed behavior
// or styling in the move -- every export below is byte-identical to what
// RunMonitor.tsx used to define locally, less RUN_STATUS_*/STAGE_FILTER_OPTIONS
// and any run-monitor-only state, which stayed behind because the queue does not
// use them (RunMonitor.tsx still owns those, and still imports STAGE_LABELS from
// here to build STAGE_FILTER_OPTIONS).
//
// 'use client' as of Unit 9L: this file was previously isomorphic (no hooks, no
// state -- EvaluationEntry was pure JSX over its `evaluation` prop) and stayed
// importable from either side of the boundary, even though every real importer
// (RunMonitor.tsx, ReviewQueue.tsx) was already a client component. That changed
// when FormattedDateTime (below) was added to fix a REPRODUCED hydration error on
// /review: loaded as the reviewer with a browser timezone forced away from the
// dev server's own (see docs/agentic-creator-phase9c-plan.md section 4.4), the
// "Entered review" cell threw React's hydration-mismatch error and regenerated
// the whole tree client-side -- "9 Sept 2026, 4:40 pm" (server, IST) vs.
// "9 Sept 2026, 4:10 am" (client, forced to America/Los_Angeles). An explicit
// timeZone on formatDateTime below closes exactly that gap, but the plan
// deliberately does not stop there: Node's bundled ICU/CLDR data and a visitor's
// browser can still disagree on the exact bytes of a locale string for the SAME
// instant and the SAME timeZone (a narrow no-break space vs. a regular one before
// "am"/"pm" is a real, previously-observed case), which no timeZone option fixes.
// FormattedDateTime sidesteps that entire class by never letting a locale string
// reach the DOM during the SSR/hydration pass at all -- it renders a fixed
// placeholder for that pass and swaps to the real text once the client is known
// to be live, via useSyncExternalStore's getServerSnapshot/getSnapshot split
// (React's own recommended tool for "render one value during SSR/hydration, a
// different one after" -- see useHasMounted below) rather than a useEffect that
// calls setState, which this repo's react-hooks/set-state-in-effect lint rule
// rejects as a footgun for the ordinary "sync external state" case it usually
// guards against. This one is not that case.
import { useSyncExternalStore } from 'react';
import type { StoredEvaluation, AgentRunEventLevel, AgentRunStage } from '@/app/actions/agentic-runs';
import {
  EVALUATION_DIMENSIONS,
  type EvaluationModelStatus,
  type EvaluationVerdict,
  type EvaluationWarning,
  type ReviewReadiness,
} from '@/lib/agentic/evaluation.shared';

// ── Static option / label tables ────────────────────────────────────────

export const STAGE_LABELS: Record<AgentRunStage, string> = {
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

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as AgentRunStage] ?? stage;
}

export const EVENT_LEVEL_STYLES: Record<AgentRunEventLevel, string> = {
  info: 'text-neutral-300',
  warn: 'text-amber-300',
  error: 'text-rose-300',
};

// ── Evaluation panel tables (Unit 7c) ───────────────────────────────────

export const EVALUATION_VERDICT_LABELS: Record<EvaluationVerdict, string> = {
  pass: 'Pass',
  concerns: 'Concerns',
  fail: 'Fail',
};

// Same border/bg/text triple as RunMonitor.tsx's own RUN_STATUS_STYLES, so a
// verdict pill reads with the same weight as a run-status pill.
export const EVALUATION_VERDICT_STYLES: Record<EvaluationVerdict, string> = {
  pass: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  concerns: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  fail: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
};

export const REVIEW_READINESS_LABELS: Record<ReviewReadiness, string> = {
  ready_for_review: 'Ready for review',
  needs_rewrite: 'Needs rewrite',
};

export const MODEL_STATUS_LABELS: Record<EvaluationModelStatus, string> = {
  applied: 'Model applied',
  unavailable: 'Model unavailable',
  skipped: 'Model skipped',
};

export const EVALUATION_DIMENSION_LABELS: Record<(typeof EVALUATION_DIMENSIONS)[number], string> = {
  coherence: 'Coherence',
  ageFit: 'Age fit',
  personaFidelity: 'Persona fidelity',
  pacing: 'Pacing',
  learningValue: 'Learning value',
  safety: 'Safety',
};

// Every warning source must be a badge, never an inferred fact -- this is the
// panel's single most important requirement (Unit 7c brief): "the
// deterministic layer decided this" and "the model was uneasy" have to be
// distinguishable at a glance, not by guessing from a code prefix.
export const WARNING_SOURCE_LABELS: Record<EvaluationWarning['source'], string> = {
  deterministic: 'Deterministic',
  model: 'Model',
};

export const WARNING_SOURCE_STYLES: Record<EvaluationWarning['source'], string> = {
  deterministic: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
  model: 'border-purple-500/25 bg-purple-500/10 text-purple-300',
};

export function shortId(id: string | null): string {
  if (!id) return '—';
  return id.slice(0, 8);
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  // timeZone pinned alongside the locale: every admin/reviewer sees the same wall
  // clock regardless of their laptop's own timezone, and it closes off a genuine,
  // reproduced timezone-mismatch hydration error (see the file header). It is not
  // a complete fix by itself -- an ICU/CLDR version difference between Node and a
  // browser can still format the same instant, same zone, as different bytes --
  // which is why every call site this unit touches goes through
  // FormattedDateTime, not this function directly, during the render that gets
  // hydrated.
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}

// True once this component is running in the browser, false during SSR and
// during the hydration render that must match the server's output byte for
// byte. useSyncExternalStore's third argument (getServerSnapshot) is used
// EXACTLY for this: it is what the server render AND the first client render
// both call, and the second argument (getSnapshot) is what every render after
// that calls -- so the flip from false to true happens automatically, for
// free, the instant React considers the component "live," with no effect and
// no setState to trip react-hooks/set-state-in-effect. The subscribe function
// is a genuine no-op: this value never changes on its own after mount, there
// is nothing to subscribe to.
function subscribeNever() {
  return () => {};
}
function useHasMounted(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

/**
 * Hydration-safe wrapper around formatDateTime(value): renders a fixed '—'
 * placeholder for the SSR render and the hydration-matching first client
 * render, then swaps to the real formatted string. React only compares
 * server-rendered markup against a component's FIRST client render when
 * deciding whether hydration succeeded -- by construction that first render
 * here is always '—', identical to what the server sent, so there is nothing
 * left for the two environments to disagree about. The swap to the real text
 * happens on the very next render, outside hydration's comparison entirely.
 *
 * Use this (not formatDateTime directly) at any call site whose output gets
 * server-rendered and then hydrated -- i.e. everywhere in this file's actual
 * importers today. formatDateTime itself stays exported for call sites that
 * genuinely need a plain string (a `title` attribute, a non-hydrated context).
 */
export function FormattedDateTime({ value }: { value: string | null }) {
  const mounted = useHasMounted();
  return <>{mounted ? formatDateTime(value) : '—'}</>;
}

/**
 * One recorded grade for a run -- the Evaluation panel renders a list of
 * these, newest first (the order listEvaluationsForRun already returns).
 * Every field composeEvaluation (lib/agentic/evaluation.shared.ts) can
 * produce gets a visible slot: an absent score reads as "—", never "0", and
 * a warning always carries both its severity and its source badge, because
 * the source badge is the only thing that tells "the deterministic layer
 * decided this" apart from "the model was uneasy" -- they must never be
 * distinguishable only by guessing from a code or a message.
 */
export function EvaluationEntry({ evaluation }: { evaluation: StoredEvaluation }) {
  return (
    <div className="rounded-lg border border-white/10 bg-neutral-900/60 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${EVALUATION_VERDICT_STYLES[evaluation.verdict]}`}
        >
          {EVALUATION_VERDICT_LABELS[evaluation.verdict]}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-neutral-400">
          {REVIEW_READINESS_LABELS[evaluation.reviewReadiness]}
        </span>
        <span className="text-neutral-600">
          {evaluation.triggerSource === 'pipeline' ? 'Pipeline' : 'Manual'} · <FormattedDateTime value={evaluation.createdAt} />
        </span>
      </div>

      <div className="mt-2 text-neutral-400">
        {MODEL_STATUS_LABELS[evaluation.modelStatus]}
        {evaluation.modelId && <span className="text-neutral-600"> ({evaluation.modelId})</span>}
        {evaluation.modelStatus !== 'applied' && (
          <span className="text-neutral-600"> — scores below are absent, not zero.</span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {EVALUATION_DIMENSIONS.map((dimension) => (
          <div key={dimension} className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5">
            <dt className="text-[10px] uppercase tracking-wide text-neutral-600">
              {EVALUATION_DIMENSION_LABELS[dimension]}
            </dt>
            <dd className="mt-0.5 text-sm text-neutral-200">
              {evaluation.scores[dimension] !== undefined ? evaluation.scores[dimension] : '—'}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3">
        {evaluation.warnings.length === 0 ? (
          <p className="text-neutral-600">No warnings.</p>
        ) : (
          <ul className="space-y-1.5">
            {evaluation.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="flex flex-wrap items-center gap-1.5">
                <span className={`font-medium ${EVENT_LEVEL_STYLES[warning.severity]}`}>{warning.severity}</span>
                <span
                  className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${WARNING_SOURCE_STYLES[warning.source]}`}
                >
                  {WARNING_SOURCE_LABELS[warning.source]}
                </span>
                <span className="text-neutral-500">{warning.code}</span>
                <span className="text-neutral-300">{warning.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
