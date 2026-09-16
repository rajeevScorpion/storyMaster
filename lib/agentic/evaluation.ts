import 'server-only';

// ── Agentic Creator: draft evaluation, server half ──────────────────────
//
// Reads and writes agent_evaluations (migration 108). Everything that decides
// what a finished draft's grade IS lives in the pure sibling
// evaluation.shared.ts; this file resolves the grading model, calls it, and
// persists the result. Mirrors the memory.ts / memory.shared.ts split.
//
// THE LOAD-BEARING PROPERTY OF THIS WHOLE MODULE, restated from
// 108_agent_evaluations.sql's header and evaluation.shared.ts's own: AN
// EVALUATION NEVER STOPS A RUN. By the time the 'evaluated' stage (see
// story-assembly.ts's runEvaluatedStage) calls evaluateAndRecord below, the
// draft is already saved to `stories` -- the expensive part is paid for and
// the row exists. Failing here would strand that story: invisible to every
// reviewer surface (they read runs at 'awaiting_review') while still sitting
// in the database. So evaluateAndRecord NEVER THROWS. A missing persona, a
// model timeout, a malformed model response, an unapplied migration 108 --
// every one of them degrades to a worse-but-honest recorded outcome
// (modelStatus: 'unavailable', or persisted: false), never an exception. The
// one caller-side exception, which is not a failure of this module, is the
// stage itself choosing {kind: 'deferred'} before ever calling in here (master
// flag off, or the run's time budget already exhausted) -- that loses no
// work and the run simply resumes.
//
// BILLING: TELEMETRY ONLY, NO COIN RESERVATION -- and this is deliberate, not
// an oversight. Every other paid call in the agentic pipeline
// (brief_ready, story_generated) goes through authorizeAgenticSpend's
// reserve/finalize/release cycle against PRICING_ACTION_KEYS
// (lib/types/pricing.ts). This one does not, and instead follows memory.ts's
// adjudicate() precedent: a real ai_cost_events row is written via the
// `telemetry` argument to callTextModelAgenticJson (activity_key:
// 'agentic_creator'), with no reservation at all. The reason: PRICING_ACTION_KEYS
// has no key that fits a platform-internal quality check no user ever
// triggers, and inventing one would need a new pricing_action_costs row, a
// migration, and an admin pricing entry for a cost nobody chose to spend.
// /admin/cost still shows the true spend through the cost-event row; there is
// simply no coin ledger entry to reserve against, because no user account is
// being charged for this call.
//
// THE LATCH RULE (GOTCHAS.md, "classify by the query, not by the error"):
// evaluationSchemaUnavailable below is set ONLY by a query that touches
// agent_evaluations and nothing else, and classified with
// isMissingEvaluationSchemaError -- never with isMissingRunSchemaError (107),
// isMissingTaskSchemaError (106), or isMissingPersonaSchemaError (103). Those
// classifiers accept an identical set of Postgres/PostgREST codes and are
// told apart only by which table the failing query touched; reusing one for
// another migration group's table blanks a surface that migration was never
// even meant to protect. Commit aa950db is where getting this wrong nearly
// took down the entire run pipeline over a completely unrelated agent_tasks
// hiccup.

import { createAdminClient } from '@/lib/supabase/admin';
import { getModelConfig } from '@/lib/ai/model-config';
import { callTextModelAgenticJson } from '@/app/actions/text-model-proxy';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type { AgentRunWithTimeline } from './orchestrator';
import {
  runDeterministicEvaluation,
  composeEvaluation,
  buildStoryEvaluationPrompt,
  parseEvaluationModelResult,
  isMissingEvaluationSchemaError,
  type DeterministicEvaluationInput,
  type EvaluationScores,
  type EvaluationVerdict,
  type EvaluationWarning,
  type EvaluationModelStatus,
  type ReviewReadiness,
  type StoryEvaluation,
} from '@/lib/agentic/evaluation.shared';

// One latch for migration 108 alone (GOTCHAS: latches are one per migration
// group). Logged once, then quiet -- an unapplied migration is a steady
// state, not an incident to log per request.
let evaluationSchemaUnavailable = false;
function latchEvaluationSchemaUnavailable(context: string): void {
  if (!evaluationSchemaUnavailable) {
    evaluationSchemaUnavailable = true;
    console.warn(
      `[agentic-evaluation] agent_evaluations unavailable (${context}); migration 108 is not applied on this database. ` +
        'Evaluations will still be computed and summarized into agent_run_events, but not persisted, until it is.'
    );
  }
}

function isEvaluationSchemaMissing(error: unknown): boolean {
  return isMissingEvaluationSchemaError(error as { code?: string; message?: string } | null | undefined);
}

export interface StoredEvaluation extends StoryEvaluation {
  id: string;
  runId: string;
  storyId: string | null;
  personaId: string | null;
  triggerSource: 'pipeline' | 'manual';
  modelId: string | null;
  createdAt: string;
}

/**
 * The run monitor's admin detail row: a run's stage timeline plus every
 * evaluation recorded against it. Defined here, not in orchestrator.ts,
 * because orchestrator.ts is the lower layer of this pair and must not learn
 * about evaluations -- the same direction of dependency this module's own
 * header enforces (evaluation.ts calls into orchestrator's types, never the
 * reverse). AgentRunWithTimeline is imported type-only above so this stays a
 * compile-time-only dependency, creating no runtime import from evaluation.ts
 * into orchestrator.ts.
 */
export interface AgentRunDetail extends AgentRunWithTimeline {
  evaluations: StoredEvaluation[];
}

interface EvaluationRow {
  id: string;
  run_id: string;
  story_id: string | null;
  persona_id: string | null;
  trigger_source: 'pipeline' | 'manual';
  verdict: EvaluationVerdict;
  review_readiness: ReviewReadiness;
  scores: EvaluationScores | null;
  warnings: EvaluationWarning[] | null;
  model_status: EvaluationModelStatus;
  model_id: string | null;
  created_at: string;
}

function rowToStoredEvaluation(row: EvaluationRow): StoredEvaluation {
  return {
    id: row.id,
    runId: row.run_id,
    storyId: row.story_id,
    personaId: row.persona_id,
    triggerSource: row.trigger_source,
    verdict: row.verdict,
    reviewReadiness: row.review_readiness,
    scores: row.scores ?? {},
    warnings: row.warnings ?? [],
    modelStatus: row.model_status,
    modelId: row.model_id,
    createdAt: row.created_at,
  };
}

/**
 * Computes an evaluation and records it. Never throws -- see this module's
 * header. `promptInput: null` skips the model call entirely (the deterministic
 * layer still runs and is still recorded) rather than guessing at a prompt
 * from incomplete data.
 *
 * A failure to persist the row (including migration 108 being unapplied) is
 * logged and reported back as `persisted: false`; it never changes the
 * computed `evaluation` and never throws. The caller (runEvaluatedStage in
 * story-assembly.ts) still gets a real verdict to log and advance with even
 * when the database write itself did not land.
 */
export async function evaluateAndRecord(params: {
  runId: string;
  storyId: string | null;
  personaId: string | null;
  triggerSource: 'pipeline' | 'manual';
  deterministic: DeterministicEvaluationInput;
  promptInput: Parameters<typeof buildStoryEvaluationPrompt>[0] | null;
  telemetry: CostTelemetryContext;
}): Promise<{ evaluation: StoryEvaluation; modelId: string | null; persisted: boolean }> {
  const deterministic = runDeterministicEvaluation(params.deterministic);

  let evaluation: StoryEvaluation;
  let modelId: string | null = null;

  if (!params.promptInput) {
    evaluation = composeEvaluation({ deterministic, model: null, modelCalled: false });
  } else {
    try {
      const config = await getModelConfig('agent_story_evaluation');
      modelId = config.model;
      const prompt = buildStoryEvaluationPrompt(params.promptInput);
      const raw = await callTextModelAgenticJson({
        task: 'agent_story_evaluation',
        model: config.model,
        prompt,
        temperature: config.temperature ?? 0.3,
        telemetry: params.telemetry,
      });
      const modelResult = parseEvaluationModelResult(raw);
      // modelResult can legitimately be null here (unparseable/unusable JSON)
      // without this being a caught error -- composeEvaluation already treats
      // modelCalled=true + model=null as modelStatus: 'unavailable'.
      evaluation = composeEvaluation({ deterministic, model: modelResult, modelCalled: true });
    } catch (error) {
      // Any throw from getModelConfig/callTextModelAgenticJson (timeout, network,
      // provider error) is caught here and becomes the same honest
      // modelStatus: 'unavailable' outcome as an unparseable response --
      // never a thrown error escaping this function.
      console.error(
        '[agentic-evaluation] model evaluation call failed:',
        error instanceof Error ? error.message : error
      );
      evaluation = composeEvaluation({ deterministic, model: null, modelCalled: true });
    }
  }

  let persisted = false;
  if (!evaluationSchemaUnavailable) {
    try {
      const admin = createAdminClient();
      const { error } = await admin.from('agent_evaluations').insert({
        run_id: params.runId,
        story_id: params.storyId,
        persona_id: params.personaId,
        trigger_source: params.triggerSource,
        verdict: evaluation.verdict,
        review_readiness: evaluation.reviewReadiness,
        scores: evaluation.scores,
        warnings: evaluation.warnings,
        model_status: evaluation.modelStatus,
        model_id: modelId,
      });

      if (error) {
        if (isEvaluationSchemaMissing(error)) {
          latchEvaluationSchemaUnavailable('evaluateAndRecord');
        } else {
          console.error('[agentic-evaluation] failed to persist evaluation:', error.message);
        }
      } else {
        persisted = true;
      }
    } catch (error) {
      if (isEvaluationSchemaMissing(error)) {
        latchEvaluationSchemaUnavailable('evaluateAndRecord');
      } else {
        console.error(
          '[agentic-evaluation] failed to persist evaluation:',
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  return { evaluation, modelId, persisted };
}

/**
 * The one pipeline evaluation for a run, or null. Null also when migration
 * 108 is unapplied -- callers (runEvaluatedStage) treat "no prior evaluation"
 * and "can't tell" identically, since both mean "compute a fresh one".
 */
export async function getPipelineEvaluationForRun(runId: string): Promise<StoredEvaluation | null> {
  if (evaluationSchemaUnavailable) return null;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('agent_evaluations')
      .select('*')
      .eq('run_id', runId)
      .eq('trigger_source', 'pipeline')
      .maybeSingle();

    if (error) {
      if (isEvaluationSchemaMissing(error)) {
        latchEvaluationSchemaUnavailable('getPipelineEvaluationForRun');
        return null;
      }
      throw new Error(`Failed to read pipeline evaluation for run ${runId}: ${error.message}`);
    }

    return data ? rowToStoredEvaluation(data as EvaluationRow) : null;
  } catch (error) {
    if (isEvaluationSchemaMissing(error)) {
      latchEvaluationSchemaUnavailable('getPipelineEvaluationForRun');
      return null;
    }
    throw error;
  }
}

/** Every evaluation for a run, newest first. Empty when 108 is unapplied. */
export async function listEvaluationsForRun(runId: string): Promise<StoredEvaluation[]> {
  if (evaluationSchemaUnavailable) return [];

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('agent_evaluations')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: false });

    if (error) {
      if (isEvaluationSchemaMissing(error)) {
        latchEvaluationSchemaUnavailable('listEvaluationsForRun');
        return [];
      }
      throw new Error(`Failed to list evaluations for run ${runId}: ${error.message}`);
    }

    return ((data ?? []) as EvaluationRow[]).map(rowToStoredEvaluation);
  } catch (error) {
    if (isEvaluationSchemaMissing(error)) {
      latchEvaluationSchemaUnavailable('listEvaluationsForRun');
      return [];
    }
    throw error;
  }
}

/**
 * True while this process has not yet observed a query against
 * agent_evaluations fail with a schema-missing error -- i.e. migration 108 is
 * believed available. Like every other latch in this codebase, this is
 * inferred from write/read attempts, never proactively checked against
 * information_schema: a fresh process reports true until (and unless) a real
 * query proves otherwise, exactly the same "innocent until classified
 * guilty" posture memorySchemaUnavailable and runSchemaUnavailable take.
 */
export async function isEvaluationSchemaApplied(): Promise<boolean> {
  return !evaluationSchemaUnavailable;
}
