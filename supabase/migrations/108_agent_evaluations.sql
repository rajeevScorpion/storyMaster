-- 108_agent_evaluations.sql
--
-- Agentic Creator System: the independent evaluator's record (Phase 7).
--
-- `agent_runs` (107) is one attempt at executing a commission; this table is the graded
-- report the `evaluated` stage writes about the draft that attempt produced. One row per
-- evaluation, read by the Run monitor today and by the Phase 9 reviewer queue next.
--
-- THE LOAD-BEARING PROPERTY OF THIS WHOLE TABLE: AN EVALUATION NEVER STOPS A RUN.
-- By the time `evaluated` is reached the draft is already saved in `stories` -- the
-- expensive part is paid for and the row exists. Failing the run here would strand a real
-- story: invisible to every reviewer surface (they read runs at 'awaiting_review') while
-- still sitting in the stories table. So the run always advances, and every column below
-- is a LABEL A HUMAN READS, never a gate. V1's only gate is the human reviewer, exactly
-- as 14_FUTURE_SCOPE requires -- evaluation can never publish, and it can never reject.
--
-- WHO DECIDES `verdict`. The deterministic layer, alone. This continues the rule the
-- first live runs forced (commit 32f2c65): a model call may never be the sole cause of an
-- automatic consequence. In the novelty check the model was allowed to SOFTEN a
-- deterministic verdict, because a block was terminal and a too-harsh threshold would
-- otherwise kill a good story -- a rescue valve with a real cost if absent. Here nothing
-- is terminal, so there is nothing to be rescued from: an over-cautious verdict costs a
-- reviewer one closer look. The model therefore gets NO VOTE on `verdict` or
-- `review_readiness`, in either direction. It contributes `scores` (the six subjective
-- dimensions no deterministic check can judge) and advisory rows in `warnings` tagged
-- source='model', including its own overall recommendation -- recorded so the audit trail
-- shows what the model claimed and that it did not decide, mirroring the way
-- applyAdjudication records an attempted escalation in `reasons`.
--
-- `review_readiness` is a DERIVED DENORMALIZATION of `verdict`, not an independent
-- judgement, and it is deliberately stored rather than computed at read time: Phase 9's
-- queue, the Run monitor and any later reviewer surface must not each re-implement the
-- mapping. The derivation lives in exactly one place, lib/agentic/evaluation.shared.ts's
-- deriveReviewReadiness(), and is unit-tested there. pass/concerns -> 'ready_for_review',
-- fail -> 'needs_rewrite'.
--
-- `trigger_source` plus idx_agent_evaluations_pipeline_run give "evaluated once per run"
-- for the automatic path without closing the door on Phase 9. The unique index is
-- PARTIAL (WHERE trigger_source = 'pipeline'), the same shape as idx_agent_runs_active_task
-- (107) and idx_image_generation_jobs_active_node (071): the pipeline can write at most
-- one evaluation per run -- so a retry re-reads the verdict it already reached instead of
-- re-grading, the same "decided once per run, not once per attempt" property 32f2c65
-- established for novelty -- while a reviewer-triggered re-evaluation after an edit
-- (trigger_source='manual') is a genuinely different evaluation of a genuinely different
-- story state and is left unconstrained. A plain UNIQUE (run_id) would have forced a
-- migration to undo in Phase 9.
--
-- `model_status` distinguishes the three honest outcomes of the subjective half:
-- 'applied' (the model answered and `scores` is populated), 'unavailable' (it was called
-- and failed, timed out, or returned unusable JSON -- the deterministic verdict still
-- stands and the run still advances), and 'skipped' (never called, e.g. the Test Lab's
-- free deterministic preview). A reader can always tell "the model said nothing bad" from
-- "the model was never asked".
--
-- NOT stored here, deliberately: story text, persona prompts, model reasoning, or any
-- chain-of-thought. `warnings[].message` is a short factual line -- a count, a script
-- name, a threshold -- exactly like agent_run_events.message. See CLAUDE.md and
-- docs/agentic-creator-decisions.md.
--
-- RLS-enabled with zero policies and REVOKE ALL from anon/authenticated, matching every
-- other admin/system-only table in this schema (agent_personas 103, agent_story_memory
-- 105, agent_tasks 106, agent_runs 107). Service-role access only, via
-- lib/supabase/admin.ts createAdminClient(). Application code (lib/agentic/evaluation.ts)
-- fails closed while this migration is unapplied: the evaluation is still COMPUTED and
-- still written into agent_run_events, only the persist is skipped (with a warn), and the
-- run still advances -- via its own dedicated latch (isMissingEvaluationSchemaError),
-- never reusing 105's, 106's or 107's, per GOTCHAS.md ("classify by the query, not by the
-- error").
--
-- NO COLUMN IS ADDED TO ANY EXISTING TABLE by this migration. agent_evaluations.story_id
-- and .persona_id are new columns ON agent_evaluations referencing stories and
-- agent_personas, not new columns on those tables -- so `stories` and `agent_personas` are
-- untouched in both directions.
--
-- ROLLBACK ORDERING -- reasoned through explicitly, per the discipline 103, 105, 106 and
-- 107 applied. agent_evaluations is the DEPENDENT side of all three foreign keys it
-- carries (into agent_runs, stories, agent_personas) and NOTHING in this schema references
-- agent_evaluations. There is therefore no table that must be altered or dropped first to
-- make the DROP TABLE succeed, and no ordering constraint at all: the rollback is a single
-- statement. See 108_agent_evaluations_rollback.sql.
--
-- Apply to development first. Then confirm:
--   select * from public.schema_migration_ledger where migration_number = 108;
--   select count(*) from public.agent_evaluations;   -- expect 0
-- and that the existing run pipeline, story creation/save, and the image/narration job
-- queues are unaffected (this migration touches no existing table).

CREATE TABLE IF NOT EXISTS public.agent_evaluations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  story_id          UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  persona_id        UUID REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  trigger_source    TEXT NOT NULL DEFAULT 'pipeline'
                      CHECK (trigger_source IN ('pipeline','manual')),
  -- Decided by the deterministic layer alone; the model has no vote. See header.
  verdict           TEXT NOT NULL CHECK (verdict IN ('pass','concerns','fail')),
  -- Derived from verdict by deriveReviewReadiness(); stored so no reader re-derives it.
  review_readiness  TEXT NOT NULL CHECK (review_readiness IN ('ready_for_review','needs_rewrite')),
  -- The six subjective dimensions, 1-5, populated only when model_status = 'applied'.
  scores            JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{code, severity: info|warn|error, message, source: deterministic|model}, ...]
  warnings          JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_status      TEXT NOT NULL DEFAULT 'skipped'
                      CHECK (model_status IN ('applied','unavailable','skipped')),
  model_id          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One PIPELINE evaluation per run: a retry re-reads its verdict instead of re-grading.
-- Partial on purpose -- Phase 9's reviewer-triggered re-evaluations stay unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_evaluations_pipeline_run
  ON public.agent_evaluations (run_id) WHERE trigger_source = 'pipeline';
CREATE INDEX IF NOT EXISTS idx_agent_evaluations_run ON public.agent_evaluations (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_evaluations_story ON public.agent_evaluations (story_id);

ALTER TABLE public.agent_evaluations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_evaluations FROM anon, authenticated;

INSERT INTO public.schema_migration_ledger (migration_number, file_name)
VALUES (108, '108_agent_evaluations.sql') ON CONFLICT (migration_number) DO NOTHING;
