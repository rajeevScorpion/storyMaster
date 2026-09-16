import 'server-only';

// ── Agentic Creator: Persona Test Lab, server half ───────────────────────
//
// Lets an admin pick a persona, optionally supply a theme, and run the REAL
// headless story-assembly pipeline (lib/agentic/story-assembly.ts) against an
// agent_tasks row with is_test = true, then inspect the result before
// deciding whether it becomes a real draft.
//
// THE SAFETY PROPERTY: a test run must never write agent_story_memory and
// must never reach the gallery. This is NOT enforced by a "test mode" flag
// threaded through story-assembly.ts -- there isn't one, and this module
// deliberately does not add one. It is enforced structurally, by WHERE this
// module stops the orchestrator: recordStoryMemory, updatePersonaMemory and
// saveStoryForUser are ALL called inside runDraftCreatedStage in
// story-assembly.ts, and nowhere earlier in the pipeline. startTestLabRun and
// continueTestLabRun both call executeRunNow with
// `{ stopAfterStage: 'story_generated' }` -- one stage short of
// draft_created -- so a test run that stops there touches none of those three
// calls, full stop. There is no code path in this module that can reach
// draft_created except promoteTestLabRun, which is the one explicit,
// separately-named action that flips the task off test mode first. Get the
// stage name in that one option wrong and the bug would be silent -- a test
// story quietly saved and folded into global memory -- which is exactly why
// the mechanism is "which stage does advanceRun stop after" rather than a
// boolean an executor could ignore.
//
// (runNoveltyCheck, called both for the pipeline's own pre_generation check
// and for this module's own postNoveltyPreview below, writes
// agent_novelty_checks -- a verdict log. That is fine and expected pre-
// promotion; it is not the memory table the safety property is about.)
//
// Runs created here are fully invisible to the cron drain: drainAgentRuns'
// claim query in orchestrator.ts filters `agent_tasks.is_test = false`, and
// enqueueCommissionedTasks' candidate query does the same. Nothing outside
// this module's own executeRunNow calls will ever advance a Test Lab run.

import { createAdminClient } from '@/lib/supabase/admin';
import {
  createRunForTask,
  executeRunNow,
  getRun,
  type AgentRun,
  type AgentRunEvent,
} from '@/lib/agentic/orchestrator';
import type { AgentRunCheckpoint, AgentRunStage, AgentRunStatus } from '@/lib/agentic/orchestrator.shared';
import { getAgentTask, type AgentTask } from '@/lib/agentic/supervisor';
import { isMissingTaskSchemaError } from '@/lib/agentic/supervisor.shared';
import {
  clampBeatCount,
  isMissingPersonaSchemaError,
  mapRowToPersona,
  resolvePersonaStoryConfig,
  type AgentPersona,
  type PersonaRow,
} from '@/lib/agentic/personas.shared';
import {
  AGENT_TASK_ROLES,
  resolveAgentModel,
  type AgentTaskKey,
  type AgentTaskRole,
} from '@/lib/agentic/routing.shared';
import { getModelConfig } from '@/lib/ai/model-config';
import { normalizeStoryConfig } from '@/lib/ai/story-config';
import { runNoveltyCheck } from '@/lib/agentic/memory';
import {
  runDeterministicEvaluation,
  toEvaluatedBeats,
  type DeterministicEvaluationResult,
} from '@/lib/agentic/evaluation.shared';
import {
  storyAssemblyExecutor,
  STORY_PROGRESS_CHECKPOINT_KEY,
  type StoryBrief,
} from '@/lib/agentic/story-assembly';
import { AGENTIC_SOURCE_FIDELITY, type SeedGenerationProgress } from '@/lib/agentic/story-assembly.shared';
import { buildTestLabBrief } from '@/lib/agentic/test-lab.shared';
import type { SeedPlan, StoryBeat, StoryConfig } from '@/lib/types/story';

type AdminClient = ReturnType<typeof createAdminClient>;

const PERSONA_SCHEMA_UNAVAILABLE_MESSAGE =
  'Persona storage is not available yet — migration 103 has not been applied to this environment.';
const TASK_SCHEMA_UNAVAILABLE_MESSAGE =
  'Task storage is not available yet — migration 106 has not been applied to this environment.';

// ── Model routing ──────────────────────────────────────────────────────

/**
 * The only three agentic TaskKeys the pipeline exercises before draft_created
 * -- the stages the Persona Test Lab can actually reach. agent_supervisor_planning
 * and agent_story_evaluation belong to the Editorial Supervisor and Phase 7
 * evaluation respectively, neither of which this module runs.
 */
const TEST_LAB_MODEL_ROUTING_KEYS = [
  'agent_story_brief',
  'agent_seed_story_writing',
  'agent_novelty_assessment',
] as const satisfies readonly AgentTaskKey[];

export interface TestLabModelRoute {
  taskKey: AgentTaskKey;
  role: AgentTaskRole;
  model: string;
  temperature: number | null;
  source: 'persona_override' | 'global_config';
}

async function buildModelRouting(persona: AgentPersona): Promise<TestLabModelRoute[]> {
  return Promise.all(
    TEST_LAB_MODEL_ROUTING_KEYS.map(async (taskKey) => {
      const globalConfig = await getModelConfig(taskKey);
      const resolved = resolveAgentModel(taskKey, persona, globalConfig);
      return { taskKey, role: AGENT_TASK_ROLES[taskKey], model: resolved.model, temperature: resolved.temperature, source: resolved.source };
    })
  );
}

// ── View ───────────────────────────────────────────────────────────────

export interface TestLabNoveltyPreview {
  verdict: string;
  score: number;
  adjudicated: boolean;
}

export interface TestLabRunView {
  taskId: string;
  runId: string;
  stage: AgentRunStage;
  status: AgentRunStatus;
  attemptCount: number;
  maxAttempts: number;
  personaId: string;
  personaName: string;
  brief: StoryBrief | null;
  preNovelty: TestLabNoveltyPreview | null;
  sourceText: string | null;
  seedPlan: SeedPlan | null;
  beats: StoryBeat[];
  targetBeatCount: number;
  storyConfig: StoryConfig;
  modelRouting: TestLabModelRoute[];
  events: AgentRunEvent[];
  errorDetail: string | null;
  /** null until promoted. */
  storyId: string | null;
  /** True while the run is parked at story_generated awaiting promotion. */
  readyToPromote: boolean;
  /** True when the pipeline stopped early (time budget, or a retryable failure) and needs another pass. */
  needsContinue: boolean;
  /**
   * A PREVIEW verdict, computed once beats are complete and cached into the run's
   * own checkpoint so repeated reads (polling getTestLabRun, or promoteTestLabRun
   * itself) never recompute it. promoteTestLabRun runs runNoveltyCheck('post_generation', ...)
   * again for real inside draft_created -- see this module's header on why paying
   * the adjudicator twice in the ambiguous band is an accepted, cheap trade for
   * showing both verdicts before an admin commits to promoting.
   */
  postNoveltyPreview: TestLabNoveltyPreview | null;
  /** Deterministic-only evaluation of the parked beats. Null until the run parks awaiting promotion. */
  evaluationPreview: DeterministicEvaluationResult | null;
}

/** Cache key for the post-generation preview, inside the same agent_runs.checkpoint object. Never an AgentRunStage. */
const TEST_LAB_POST_NOVELTY_CHECKPOINT_KEY = 'test_lab_post_novelty_preview';

async function computeAndCachePostNoveltyPreview(
  admin: AdminClient,
  run: AgentRun,
  task: AgentTask,
  persona: AgentPersona,
  brief: StoryBrief,
  beats: StoryBeat[]
): Promise<TestLabNoveltyPreview | null> {
  try {
    const characterNames = Array.from(
      new Set([
        ...brief.characters.map((character) => character.name),
        ...beats.flatMap((beat) => beat.characters.map((character) => character.name)),
      ])
    );

    const result = await runNoveltyCheck(
      'post_generation',
      {
        title: brief.workingTitle,
        premise: brief.premise,
        themes: brief.themes,
        characterNames,
        language: persona.language,
        ageGroup: persona.ageGroup,
        genre: task.genre ?? persona.genres[0] ?? null,
        seriesId: task.seriesId ?? null,
      },
      { taskId: task.id, runId: run.id, personaId: persona.id }
    );

    const preview: TestLabNoveltyPreview = { verdict: result.verdict, score: result.score, adjudicated: result.adjudicated };

    // Best-effort cache write -- a failure here must not fail the view build, it
    // just means the next read tries again (and pays for another call).
    //
    // BOTH guards below are load-bearing, and neither is paranoia. This is a
    // read-modify-write of the WHOLE agent_runs.checkpoint object from a code path
    // that does not own the run's claim, so it is exactly the shape of write that
    // can silently erase another writer's progress -- the failure the orchestrator
    // comments call out as "correct stories, duplicated spend, no error".
    //
    //  1. The checkpoint is re-read HERE, immediately before the merge, rather than
    //     spread from the `run` object this function was handed. That object was
    //     loaded at the top of the view build, and a promotion (or any executeRunNow
    //     pass) between then and now writes new keys into the same column --
    //     story_generated_progress's completed beats, or draft_created's storyId.
    //     Merging onto the stale copy would drop them, and a retry would re-pay for
    //     every beat already generated, or save a SECOND story.
    //  2. The update is conditional on the run still being parked exactly where the
    //     preview is meaningful (stage 'story_generated', status 'pending'). An
    //     executor writes its own progress with .eq('status', 'processing'), so the
    //     two conditions are mutually exclusive: once anything has claimed this run,
    //     this write matches zero rows and does nothing at all, rather than racing.
    const { data: freshRow, error: rereadError } = await admin
      .from('agent_runs')
      .select('checkpoint')
      .eq('id', run.id)
      .maybeSingle();
    if (rereadError || !freshRow) return preview;

    const freshCheckpoint = (freshRow.checkpoint ?? {}) as AgentRunCheckpoint;
    const nextCheckpoint = { ...freshCheckpoint, [TEST_LAB_POST_NOVELTY_CHECKPOINT_KEY]: preview };
    const { data: written, error } = await admin
      .from('agent_runs')
      .update({ checkpoint: nextCheckpoint })
      .eq('id', run.id)
      .eq('status', 'pending')
      .eq('stage', 'story_generated')
      .select('id');
    if (!error && written && written.length > 0) run.checkpoint = nextCheckpoint;

    return preview;
  } catch (error) {
    console.warn(
      '[test-lab] failed to compute the post-generation novelty preview:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

async function buildTestLabRunView(
  admin: AdminClient,
  run: AgentRun,
  task: AgentTask,
  persona: AgentPersona,
  events: AgentRunEvent[]
): Promise<TestLabRunView> {
  const targetBeatCount = clampBeatCount(persona, task.targetBeatCount ?? Number.NaN);
  const brief = (run.checkpoint.brief_ready as StoryBrief | undefined) ?? null;
  const preNovelty = (run.checkpoint.novelty_checked as TestLabNoveltyPreview | undefined) ?? null;
  const progress = run.checkpoint[STORY_PROGRESS_CHECKPOINT_KEY] as SeedGenerationProgress | undefined;
  const beats = progress?.completedBeats ?? [];
  const sourceText = progress?.sourceText ?? null;
  const seedPlan = progress?.seedPlan ?? null;

  const storyConfig = normalizeStoryConfig({ ...resolvePersonaStoryConfig(persona), maxBeats: targetBeatCount });
  const modelRouting = await buildModelRouting(persona);

  // stopAfterStage always parks a completed test run with stage === 'story_generated'
  // and status === 'pending' (returnRunToPending, attempt not consumed) -- see
  // orchestrator.ts's advanceRun. Any OTHER 'pending' status at this point means the
  // run stopped short of that -- a time-budget deferral mid-story_generated, or a
  // retryable failure on an earlier stage -- and needs another executeRunNow pass.
  const readyToPromote = run.stage === 'story_generated' && run.status === 'pending';
  const needsContinue = run.status === 'pending' && !readyToPromote;

  // Computed ONLY while the run is parked awaiting promotion, never merely because
  // the beats happen to be complete. After promotion the run is moving again, and
  // both the model call and the cache write below would be racing draft_created's
  // own writes to this same row for a verdict draft_created independently computes
  // anyway (see runDraftCreatedStage). A preview already cached while parked stays
  // readable here afterwards, which is the case that matters for the UI.
  let postNoveltyPreview = (run.checkpoint[TEST_LAB_POST_NOVELTY_CHECKPOINT_KEY] as TestLabNoveltyPreview | undefined) ?? null;
  if (!postNoveltyPreview && readyToPromote && brief && beats.length > 0 && beats.length >= targetBeatCount) {
    postNoveltyPreview = await computeAndCachePostNoveltyPreview(admin, run, task, persona, brief, beats);
  }

  // Deterministic-only evaluation preview of the parked beats (Unit 7d). This
  // deliberately does NOT cache the way postNoveltyPreview above does.
  // postNoveltyPreview caches because it is a PAID model call that must never
  // repeat and whose read-modify-write of the checkpoint could otherwise race
  // draft_created's own writes (see computeAndCachePostNoveltyPreview's
  // comment). runDeterministicEvaluation makes no model call, writes nothing,
  // and costs nothing to redo -- so it is simply recomputed inline on every
  // view build. No checkpoint key, no cache, no write. Do not "fix" this by
  // adding one; there is nothing here worth paying a race for.
  //
  // Built from the run's OWN storyConfig (computed above), not re-derived
  // from the persona. That is deliberate and correct, not a shortcut:
  // storyConfig is the config that actually generated these beats, and it
  // agrees with the real pipeline's construction by definition --
  // story-assembly.ts's buildSeededStoryConfig builds its StoryConfig from
  // resolvePersonaStoryConfig(persona) too (the same function storyConfig
  // above is built from), so both land on the same ageGroup, language and
  // beatLength.
  //
  // sourceFidelity is the ONE field taken from AGENTIC_SOURCE_FIDELITY rather
  // than from storyConfig, and the distinction is not pedantic. storyConfig
  // does not set authoring.sourceFidelity at all; it only ever arrives here as
  // normalizeStoryConfig's DEFAULT_AUTHORING fallback, which happens to be
  // 'strictly_follow' today. buildSeededStoryConfig, meanwhile, pins the field
  // explicitly. So the two agree by coincidence of a default, not by
  // construction -- change DEFAULT_AUTHORING.sourceFidelity and this preview
  // would start applying the beat-length band while the real evaluated stage
  // still skipped it, or vice versa, and the preview would quietly disagree
  // with the grade it exists to predict. Reading the constant the pipeline
  // itself pins makes that agreement structural.
  //
  // noveltyVerdict/noveltyReason are ALWAYS null here -- never preNovelty.
  // DeterministicEvaluationInput.noveltyVerdict specifically wants the
  // POST-generation verdict carried in draft_created's checkpoint (see that
  // field's own doc comment in evaluation.shared.ts), and draft_created has
  // not run yet: readyToPromote means stage is still 'story_generated'.
  // preNovelty is a different check at a different time (pre_generation,
  // before any beat existed); substituting it here would mislabel it.
  // runDeterministicEvaluation already turns a null verdict into its own
  // 'novelty_unavailable' info warning, never a failure, so nothing here
  // needs to work around the gap -- it is exactly the honest answer.
  const evaluationPreview: DeterministicEvaluationResult | null =
    readyToPromote && brief && beats.length > 0 && beats.length >= targetBeatCount
      ? runDeterministicEvaluation({
          beats: toEvaluatedBeats(beats),
          targetBeatCount,
          ageGroup: storyConfig.ageGroup,
          beatLengthLevel: storyConfig.beatLength?.level,
          sourceFidelity: AGENTIC_SOURCE_FIDELITY,
          language: storyConfig.language,
          restrictedThemes: persona.restrictedThemes,
          briefThemes: brief.themes,
          noveltyVerdict: null,
          noveltyReason: null,
        })
      : null;

  return {
    taskId: task.id,
    runId: run.id,
    stage: run.stage,
    status: run.status,
    attemptCount: run.attemptCount,
    maxAttempts: run.maxAttempts,
    personaId: persona.id,
    personaName: persona.displayName,
    brief,
    preNovelty,
    sourceText,
    seedPlan,
    beats,
    targetBeatCount,
    storyConfig,
    modelRouting,
    events,
    errorDetail: run.errorDetail,
    storyId: run.storyId,
    readyToPromote,
    needsContinue,
    postNoveltyPreview,
    evaluationPreview,
  };
}

/** Fetches the run + its full event timeline and assembles the view from it. */
async function assembleView(admin: AdminClient, runId: string, task: AgentTask, persona: AgentPersona): Promise<TestLabRunView> {
  const withTimeline = await getRun(runId);
  if (!withTimeline) throw new Error(`Run ${runId} could not be re-read after advancing.`);
  return buildTestLabRunView(admin, withTimeline, task, persona, withTimeline.events);
}

// ── Persona lookup ───────────────────────────────────────────────────────
//
// Headless, exactly like story-assembly.ts's own loadPersonaById: this module
// has no admin session to hand to the verifyAdmin()-gated actions in
// app/actions/agentic-personas.ts, so it goes straight at agent_personas with
// the admin client instead.

async function loadPersonaOrThrow(admin: AdminClient, personaId: string): Promise<AgentPersona> {
  const { data, error } = await admin.from('agent_personas').select('*').eq('id', personaId).maybeSingle();
  if (error) {
    if (isMissingPersonaSchemaError(error)) throw new Error(PERSONA_SCHEMA_UNAVAILABLE_MESSAGE);
    throw new Error(`Failed to load persona: ${error.message}`);
  }
  if (!data) throw new Error(`No persona found with id ${personaId}.`);
  return mapRowToPersona(data as PersonaRow);
}

// ── Persona picker ─────────────────────────────────────────────────────

/**
 * Non-archived personas for the Test Lab's picker, ordered by display name.
 *
 * Deliberately NOT filtered to status = 'active': every seed persona on the
 * dev database is currently 'draft' (the status a brand-new or not-yet-
 * launched persona sits in), and the whole point of the Test Lab is to run a
 * persona BEFORE it goes live. An "active only" filter would make this tool
 * unusable for exactly the personas it exists to test. 'archived' is the one
 * status excluded, since an archived persona has been deliberately retired.
 */
export async function listTestLabPersonas(): Promise<
  { id: string; slug: string; displayName: string; language: string; ageGroup: string; status: string }[]
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('agent_personas')
    .select('id, slug, display_name, language, age_group, status')
    .neq('status', 'archived')
    .order('display_name', { ascending: true });

  if (error) {
    if (isMissingPersonaSchemaError(error)) return [];
    throw new Error(`Failed to list personas for the Test Lab: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    displayName: row.display_name as string,
    language: row.language as string,
    ageGroup: row.age_group as string,
    status: row.status as string,
  }));
}

// ── Start ──────────────────────────────────────────────────────────────

export async function startTestLabRun(personaId: string, theme: string | null, createdBy: string | null): Promise<TestLabRunView> {
  const admin = createAdminClient();

  const persona = await loadPersonaOrThrow(admin, personaId);
  if (persona.status === 'archived') {
    throw new Error(`Persona '${persona.displayName}' is archived and cannot be used in the Test Lab.`);
  }

  const brief = buildTestLabBrief(persona, theme);
  const targetBeatCount = clampBeatCount(persona, Number.NaN);

  const { data: insertedRow, error: insertError } = await admin
    .from('agent_tasks')
    .insert({
      persona_id: persona.id,
      origin: 'test_lab',
      status: 'running',
      is_test: true,
      brief,
      language: persona.language,
      age_group: persona.ageGroup,
      genre: persona.genres[0] ?? null,
      target_beat_count: targetBeatCount,
      created_by: createdBy,
    })
    .select('id')
    .single();

  if (insertError) {
    if (isMissingTaskSchemaError(insertError)) throw new Error(TASK_SCHEMA_UNAVAILABLE_MESSAGE);
    throw new Error(`Failed to create the Test Lab task: ${insertError.message}`);
  }

  const task = await getAgentTask((insertedRow as { id: string }).id);
  if (!task) throw new Error('The Test Lab task was created but could not be read back.');

  const { run } = await createRunForTask(task.id);
  if (!run) {
    throw new Error('Failed to create a run for the new Test Lab task (unexpected: a brand-new task should never already have a live run).');
  }

  // stopAfterStage: 'story_generated' -- one stage short of draft_created. See this
  // module's header for why that is the entire safety mechanism.
  const advancedRun = await executeRunNow(run.id, storyAssemblyExecutor, { stopAfterStage: 'story_generated' });
  if (!advancedRun) {
    throw new Error(`Run ${run.id} could not be claimed right after creation; please try again.`);
  }

  return assembleView(admin, advancedRun.id, task, persona);
}

// ── Continue ───────────────────────────────────────────────────────────

/**
 * Runs another executeRunNow pass against an already-started run, stopping at
 * the same 'story_generated' boundary. Needed because RUN_TIME_BUDGET_MS
 * (lib/agentic/orchestrator.shared.ts) is only 20 seconds while
 * story_generated makes roughly 2N+2 paid model calls for an N-beat story, so
 * the first pass (and often the second, third...) almost always defers
 * partway through, returning the run to 'pending' with its intra-stage
 * progress already checkpointed (persistStoryGenerationProgress in
 * story-assembly.ts). That is the SAME deferral machinery the cron drain
 * relies on working exactly as designed -- not an error, and not specific to
 * the Test Lab -- so calling this again simply resumes from wherever the
 * previous pass left off, at no extra cost for beats already completed.
 */
export async function continueTestLabRun(runId: string): Promise<TestLabRunView> {
  const admin = createAdminClient();

  const existing = await getRun(runId);
  if (!existing) throw new Error(`No Test Lab run found with id ${runId}.`);

  const task = await getAgentTask(existing.taskId);
  if (!task) throw new Error(`Run ${runId}'s task could not be loaded.`);
  if (!existing.personaId) throw new Error(`Run ${runId} has no persona assigned.`);
  const persona = await loadPersonaOrThrow(admin, existing.personaId);

  const advancedRun = await executeRunNow(runId, storyAssemblyExecutor, { stopAfterStage: 'story_generated' });
  if (!advancedRun) {
    throw new Error(`Run ${runId} could not be claimed (it may already be 'processing' elsewhere); try again shortly.`);
  }

  return assembleView(admin, advancedRun.id, task, persona);
}

// ── Read ───────────────────────────────────────────────────────────────

export async function getTestLabRun(runId: string): Promise<TestLabRunView | null> {
  const withTimeline = await getRun(runId);
  if (!withTimeline) return null;

  const task = await getAgentTask(withTimeline.taskId);
  if (!task || !withTimeline.personaId) return null;

  const admin = createAdminClient();
  const persona = await loadPersonaOrThrow(admin, withTimeline.personaId);

  return buildTestLabRunView(admin, withTimeline, task, persona, withTimeline.events);
}

// ── Promote ────────────────────────────────────────────────────────────

/**
 * Promotes a parked test run into a real draft: flips the task's is_test to
 * false, then runs the SAME executeRunNow entry point with NO stopAfterStage,
 * so draft_created (the stage that finally calls saveStoryForUser,
 * recordStoryMemory and updatePersonaMemory) is allowed to run, followed by
 * storyAssemblyExecutor's automatic advance through narration_pending /
 * narration_complete / evaluated straight to awaiting_review, exactly like
 * any non-test run.
 */
export async function promoteTestLabRun(runId: string): Promise<TestLabRunView> {
  const admin = createAdminClient();

  const existing = await getRun(runId);
  if (!existing) throw new Error(`No Test Lab run found with id ${runId}.`);
  if (existing.stage !== 'story_generated' || existing.status !== 'pending') {
    throw new Error(
      `Run ${runId} is not parked at 'story_generated' awaiting promotion (currently stage='${existing.stage}', status='${existing.status}').`
    );
  }

  const task = await getAgentTask(existing.taskId);
  if (!task) throw new Error(`Run ${runId}'s task could not be loaded.`);
  if (!existing.personaId) throw new Error(`Run ${runId} has no persona assigned.`);
  const persona = await loadPersonaOrThrow(admin, existing.personaId);

  // is_test flips to false FIRST, before the run is allowed anywhere near
  // draft_created -- the story about to be saved is a real draft the instant
  // that stage runs, and is_test lingering true past that point would
  // misdescribe it. `origin` stays 'test_lab' regardless: that is provenance
  // (how this task came to exist), not a safety flag, and it is exactly the
  // fact a reviewer most wants to see once this draft reaches their queue.
  const { error: flipError } = await admin
    .from('agent_tasks')
    .update({ is_test: false, updated_at: new Date().toISOString() })
    .eq('id', task.id);
  if (flipError) {
    if (isMissingTaskSchemaError(flipError)) throw new Error(TASK_SCHEMA_UNAVAILABLE_MESSAGE);
    throw new Error(`Failed to flip task ${task.id} off test mode: ${flipError.message}`);
  }

  const advancedRun = await executeRunNow(runId, storyAssemblyExecutor);
  if (!advancedRun) {
    throw new Error(`Run ${runId} could not be claimed for promotion (it may already be 'processing' elsewhere); try again shortly.`);
  }

  return assembleView(admin, advancedRun.id, task, persona);
}
