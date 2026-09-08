import 'server-only';

// ── Agentic Creator: headless story assembly, server half (Phase 6) ────────
//
// Plugs into lib/agentic/orchestrator.ts's StageExecutor seam: turns a
// commissioned agent_task into a normal, editable Kissago story draft owned by
// the system user, stopping at 'awaiting_review'. V1 has no autonomous
// publish -- this module never marks a story public and never touches
// storylines. It IS wired into drainAgentRuns() now, as its default executor
// -- but orchestrator.ts resolves storyAssemblyExecutor via a lazy dynamic
// import rather than a top-level one, because this module imports
// appendRunEvent, AgentRun, StageExecutor and StageExecutionOutcome back from
// orchestrator.ts, and a static import in both directions would be a cycle.
//
// THE NO-DOUBLE-CHARGE CONTRACT: story_generated makes roughly 2N+2 paid model
// calls for an N-beat story (one prose write, one seed plan, then a
// materialize and a storyboard-plan call per beat). A crash mid-loop must
// never make a retry re-pay for beats already completed. The orchestrator's
// own checkpoint contract (lib/agentic/orchestrator.shared.ts's
// isCheckpointed/recordCheckpoint) only fires BETWEEN stages, so it cannot
// protect a loop that runs entirely inside one 'story_generated' executor
// call. This module therefore keeps its own intra-stage progress record
// (SeedGenerationProgress, from story-assembly.shared.ts) and persists it into
// agent_runs.checkpoint via a direct, targeted UPDATE after every completed
// beat -- see persistStoryGenerationProgress's comment for exactly how that
// interacts with (and must stay ahead of) the orchestrator's own end-of-stage
// checkpoint write.
//
// FAILS CLOSED: the master flag (agentic_creator_enabled) and every
// migration-missing case (agent_tasks/106, agent_personas/103) degrade to a
// 'deferred' outcome -- no throw, run left pending -- exactly like
// defaultAgentRunExecutor's own contract for a stage that cannot run yet.
// Schema-missing detection reuses the existing per-migration-group latches
// (isMissingPersonaSchemaError) by CODE ONLY, never message-text matching,
// per GOTCHAS.md.
//
// NEVER logs persona prompts, source text, or secrets into
// agent_run_events.message -- every appendRunEvent call below is a short,
// factual line (a count, a verdict, a stage name), never generated prose.

import { createAdminClient } from '@/lib/supabase/admin';
import { getAgenticFlags } from '@/lib/agentic/flags';
import {
  appendRunEvent,
  type AgentRun,
  type StageExecutor,
  type StageExecutionOutcome,
} from '@/lib/agentic/orchestrator';
import {
  RUN_TIME_BUDGET_MS,
  AgentModelCallError,
  AgentValidationError,
  type AgentRunCheckpoint,
} from '@/lib/agentic/orchestrator.shared';
import {
  buildSeededStoryMap,
  getSeedBeatByIndex,
  nextBeatIndexToGenerate,
  SeededStoryMapError,
  type SeedGenerationProgress,
} from '@/lib/agentic/story-assembly.shared';
import {
  resolvePersonaStoryConfig,
  clampBeatCount,
  isMissingPersonaSchemaError,
  mapRowToPersona,
  type AgentPersona,
  type PersonaRow,
} from '@/lib/agentic/personas.shared';
import { getAgentTask, type AgentTask } from '@/lib/agentic/supervisor';
import { runNoveltyCheck, recordStoryMemory, updatePersonaMemory } from '@/lib/agentic/memory';
import type { NoveltyCandidate, NoveltyVerdict } from '@/lib/agentic/memory.shared';
import { evaluateAndRecord, getPipelineEvaluationForRun } from '@/lib/agentic/evaluation';
import type { DeterministicEvaluationInput } from '@/lib/agentic/evaluation.shared';
import { generateSeedPlanPreview, materializeSeededBeat } from '@/lib/ai/seed-authoring';
import { composeStoryboardPlan, renderStoryboardPlan, mergeCharacterVisualReferences } from '@/lib/ai/beat-orchestration';
import { saveStoryForUser } from '@/lib/story/save-story';
import { callGeminiAgenticJson } from '@/app/actions/gemini-proxy';
import { getModelConfig } from '@/lib/ai/model-config';
import { authorizeBillableAction, finalizeBillableAction, releaseBillableAction } from '@/lib/pricing/enforcement';
import type { PricingActionKey } from '@/lib/types/pricing';
import { normalizeStoryConfig, deriveVisualStyleSummary } from '@/lib/ai/story-config';
import { SEED_SOURCE_WORD_CAP, countAuthoringWords } from '@/lib/story/authoring-limits';
import type { CostTelemetryContext } from '@/lib/ai/cost-telemetry.shared';
import type {
  Character,
  CharacterNameSource,
  SeedPlan,
  StoryBeat,
  StoryConfig,
  StoryMap,
  StorySession,
} from '@/lib/types/story';

/**
 * Key story_generated writes its intra-stage progress under, inside the SAME
 * agent_runs.checkpoint JSONB object the orchestrator's own stage-name keys
 * live in (brief_ready, novelty_checked, ...). It is deliberately not itself
 * an AgentRunStage -- it never appears in STAGE_SEQUENCE and the orchestrator
 * never reads or writes it; it exists purely so a crash partway through this
 * stage's paid-call loop can resume without re-paying for finished work.
 *
 * Exported (not just a local constant) so lib/agentic/test-lab.ts can read a
 * parked run's in-progress sourceText/seedPlan/completedBeats for the Persona
 * Test Lab's inspection view without retyping this string literal a second
 * place -- see GOTCHAS.md on why a duplicated literal like this is worth
 * avoiding even though nothing here enforces it structurally.
 */
export const STORY_PROGRESS_CHECKPOINT_KEY = 'story_generated_progress';

// ── Story brief (brief_ready) ───────────────────────────────────────────

export interface StoryBriefCharacter {
  name: string;
  role: string;
  appearanceSummary: string;
  personalitySummary: string;
}

export interface StoryBrief {
  workingTitle: string;
  premise: string;
  themes: string[];
  characters: StoryBriefCharacter[];
}

function buildStoryBriefPrompt(persona: AgentPersona, task: AgentTask): string {
  const restricted = persona.restrictedThemes.length
    ? `Restricted themes -- never use these: ${persona.restrictedThemes.join(', ')}.`
    : '';
  const constraintKeys = task.constraints && typeof task.constraints === 'object' ? Object.keys(task.constraints) : [];
  const constraints = constraintKeys.length
    ? `Additional commissioning constraints (JSON): ${JSON.stringify(task.constraints)}.`
    : '';

  return [
    `You are ${persona.displayName}, a story-writing persona on the Kissago platform.`,
    persona.personaPrompt,
    persona.creativeNotes ? `Creative notes: ${persona.creativeNotes}` : '',
    restricted,
    '',
    'You have been commissioned to write a new interactive story.',
    `Commission brief: ${task.brief}`,
    task.rationale ? `Editorial rationale: ${task.rationale}` : '',
    task.genre ? `Target genre: ${task.genre}` : '',
    constraints,
    '',
    `Audience: ${persona.ageGroup}. Language: ${persona.language}.`,
    '',
    'Respond with ONLY a JSON object of this exact shape -- no markdown fences, no commentary:',
    '{',
    '  "workingTitle": string,',
    '  "premise": string (2-4 sentences),',
    '  "themes": string[] (2-5 short theme tags, in English),',
    '  "characters": [',
    '    { "name": string, "role": string, "appearanceSummary": string, "personalitySummary": string }',
    '  ] (2-5 principal characters)',
    '}',
    'workingTitle, premise and character fields must be written in the target language.',
  ].filter(Boolean).join('\n');
}

function parseStoryBrief(raw: string): StoryBrief {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AgentValidationError('Story brief response was not valid JSON.');
  }

  const record = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const workingTitle = typeof record.workingTitle === 'string' ? record.workingTitle.trim() : '';
  const premise = typeof record.premise === 'string' ? record.premise.trim() : '';
  const themes = Array.isArray(record.themes)
    ? record.themes.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim())
        .slice(0, 8)
    : [];

  const rawCharacters = Array.isArray(record.characters) ? record.characters : [];
  const characters: StoryBriefCharacter[] = rawCharacters
    .map((entry) => (entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}))
    .map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name.trim() : '',
      role: typeof entry.role === 'string' ? entry.role.trim() : '',
      appearanceSummary: typeof entry.appearanceSummary === 'string' ? entry.appearanceSummary.trim() : '',
      personalitySummary: typeof entry.personalitySummary === 'string' ? entry.personalitySummary.trim() : '',
    }))
    .filter((character) => character.name.length > 0)
    .slice(0, 8);

  if (!workingTitle) throw new AgentValidationError('Story brief response is missing a working title.');
  if (!premise) throw new AgentValidationError('Story brief response is missing a premise.');
  if (characters.length === 0) throw new AgentValidationError('Story brief response contains no named characters.');

  return {
    workingTitle: workingTitle.slice(0, 160),
    premise: premise.slice(0, 1000),
    themes,
    characters,
  };
}

function briefCharactersToRoster(characters: StoryBriefCharacter[]): Character[] {
  return characters.map((character, index) => ({
    id: `agentic-character-${index + 1}`,
    name: character.name,
    type: character.role || 'character',
    appearanceSummary: character.appearanceSummary,
    personalitySummary: character.personalitySummary,
    nameSource: 'ai_generated' as CharacterNameSource,
  }));
}

// ── Seed source prose (story_generated, part 1) ─────────────────────────

function buildSeedSourcePrompt(persona: AgentPersona, brief: StoryBrief, targetBeatCount: number): string {
  const cast = brief.characters
    .map((character) => `- ${character.name} (${character.role}): ${character.appearanceSummary}. ${character.personalitySummary}`)
    .join('\n');

  return [
    `You are ${persona.displayName}, a story-writing persona on the Kissago platform.`,
    persona.personaPrompt,
    persona.creativeNotes ? `Creative notes: ${persona.creativeNotes}` : '',
    '',
    `Write the full source prose for this story, in ${persona.language}, for a ${persona.ageGroup} audience.`,
    `Working title: ${brief.workingTitle}`,
    `Premise: ${brief.premise}`,
    `Themes: ${brief.themes.join(', ')}`,
    'Principal characters:',
    cast,
    '',
    `The prose must divide cleanly into ${targetBeatCount} sequential scenes. Write it as exactly ${targetBeatCount} short paragraphs, one per scene, in reading order, each ending on a clear sentence boundary, separated by a blank line.`,
    `Keep the whole piece under ${SEED_SOURCE_WORD_CAP} words.`,
    '',
    'Respond with ONLY a JSON object of this exact shape -- no markdown fences, no commentary:',
    '{ "sourceText": string }',
  ].filter(Boolean).join('\n');
}

function parseSeedSourceText(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AgentValidationError('Seed source response was not valid JSON.');
  }

  const record = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const sourceText = typeof record.sourceText === 'string' ? record.sourceText.trim() : '';
  if (!sourceText) throw new AgentValidationError('Seed source response is missing sourceText.');
  if (countAuthoringWords(sourceText) > SEED_SOURCE_WORD_CAP) {
    throw new AgentValidationError(`Seed source response exceeds the ${SEED_SOURCE_WORD_CAP}-word cap.`);
  }
  return sourceText;
}

function buildSeededStoryConfig(
  persona: AgentPersona,
  brief: StoryBrief,
  sourceText: string,
  seedPlan: SeedPlan,
  targetBeatCount: number
): StoryConfig {
  const base = resolvePersonaStoryConfig(persona);
  return normalizeStoryConfig({
    ...base,
    maxBeats: targetBeatCount,
    authoring: {
      mode: 'seeded',
      workingTitle: brief.workingTitle,
      sourceText,
      sourceFidelity: 'strictly_follow',
      seedPlan,
    },
  });
}

function mergeCharacterRoster(existing: Character[], incoming: Character[]): Character[] {
  const byId = new Map(existing.map((character) => [character.id, character]));
  for (const character of incoming) {
    byId.set(character.id, { ...byId.get(character.id), ...character });
  }
  return Array.from(byId.values());
}

// ── Billing: reserve/finalize/release against the agentic system user ──────

interface AgenticAuthorization {
  reservationId: string | null;
}

function resolveAgenticSystemUserId(): string {
  const systemUserId = process.env.AGENTIC_SYSTEM_USER_ID;
  if (!systemUserId) {
    throw new AgentValidationError(
      'AGENTIC_SYSTEM_USER_ID is not set; the agentic creator has no billing identity to authorize spend against.'
    );
  }
  return systemUserId;
}

/**
 * Authorizes one paid call as the agentic system user. Anything other than
 * `bypassed`/`allowed` fails the run -- this throws rather than returning a
 * status the caller might forget to check. When AGENTIC_SYSTEM_USER_ID is
 * unset, resolveAgenticSystemUserId already throws with that exact message;
 * when it is set but authorizeBillableAction still could not resolve a
 * billable identity (denied with reason 'sign_in_required' -- the shape a
 * falsy/mismatched userId takes there), the thrown message says so explicitly
 * too, so a config problem never presents as a bare "insufficient balance".
 */
async function authorizeAgenticSpend(
  actionKey: PricingActionKey,
  idempotencyKey: string,
  metadata?: Record<string, unknown>
): Promise<AgenticAuthorization> {
  const systemUserId = resolveAgenticSystemUserId();
  const authorization = await authorizeBillableAction({
    actorKind: 'agentic_system',
    userId: systemUserId,
    actionKey,
    idempotencyKey,
    metadata,
  });

  if (authorization.status !== 'bypassed' && authorization.status !== 'allowed') {
    const reason = authorization.status === 'denied' ? authorization.reason : undefined;
    const configHint = reason === 'sign_in_required'
      ? ' AGENTIC_SYSTEM_USER_ID is unset or does not resolve to a billable account.'
      : '';
    throw new AgentModelCallError(
      `Billing was not authorized for '${actionKey}' (status: ${authorization.status}${reason ? `, reason: ${reason}` : ''}).${configHint}`
    );
  }

  const reservationId =
    authorization.status === 'allowed' && authorization.mode === 'hard' ? authorization.reservationId : null;
  return { reservationId };
}

/** Best-effort: a failed finalize must never fail a run whose generation already succeeded. */
async function finalizeAgenticSpend(reservationId: string | null, storyId?: string | null): Promise<void> {
  if (!reservationId) return;
  const systemUserId = process.env.AGENTIC_SYSTEM_USER_ID;
  if (!systemUserId) return;
  await finalizeBillableAction({ userId: systemUserId, reservationId, storyId: storyId ?? null }).catch((error) => {
    console.error('[agentic-story-assembly] failed to finalize reservation:', error instanceof Error ? error.message : error);
  });
}

/** Best-effort: releasing a reservation after a failed call must never itself fail the run. */
async function releaseAgenticSpend(reservationId: string | null, reason: string): Promise<void> {
  if (!reservationId) return;
  const systemUserId = process.env.AGENTIC_SYSTEM_USER_ID;
  if (!systemUserId) return;
  await releaseBillableAction({ userId: systemUserId, reservationId, reason }).catch((error) => {
    console.error('[agentic-story-assembly] failed to release reservation:', error instanceof Error ? error.message : error);
  });
}

function toFailure(error: unknown, metadata?: Record<string, unknown>): StageExecutionOutcome {
  return {
    kind: 'failed',
    message: error instanceof Error ? error.message : 'Unknown error during story assembly.',
    metadata,
    error,
  };
}

function buildTelemetry(run: AgentRun, task: AgentTask, persona: AgentPersona | null, phase: string): CostTelemetryContext {
  return {
    activityKey: 'agentic_creator',
    storyId: run.storyId ?? undefined,
    phase,
    metadata: {
      runId: run.id,
      taskId: task.id,
      personaId: persona?.id ?? run.personaId ?? undefined,
    },
  };
}

function timeBudgetExceeded(startedAtMs: number): boolean {
  return Date.now() - startedAtMs >= RUN_TIME_BUDGET_MS;
}

// ── Persona lookup (headless -- no admin session, so agentic-personas.ts's
// verifyAdmin()-gated actions are not usable here) ──────────────────────

async function loadPersonaById(personaId: string): Promise<AgentPersona | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from('agent_personas').select('*').eq('id', personaId).maybeSingle();
  if (error) throw error;
  return data ? mapRowToPersona(data as PersonaRow) : null;
}

/**
 * Writes SeedGenerationProgress into agent_runs.checkpoint via a direct,
 * targeted UPDATE -- separate from, and ahead of, the orchestrator's own
 * end-of-stage recordCheckpoint() call in advanceRun(). story_generated must
 * survive a crash PARTWAY through its own paid-call loop, not just between
 * stages, so progress is persisted after every completed beat rather than
 * once at the end.
 *
 * Mutates `run.checkpoint` in place once the write succeeds. This is
 * deliberate: `run` is the SAME object reference orchestrator.ts's
 * advanceRun() holds for the rest of this stage's execution, and once this
 * function returns {kind:'advanced', ...}, advanceRun computes
 * `recordCheckpoint(run.checkpoint, 'story_generated', checkpointPayload)`
 * using whatever `run.checkpoint` looks like AT THAT POINT. Without this
 * mutation, that final write would spread the checkpoint as it stood BEFORE
 * this executor call started and silently drop every progress write made
 * here -- advanceRun has no other channel through which to learn about a
 * direct write like this one.
 */
async function persistStoryGenerationProgress(run: AgentRun, progress: SeedGenerationProgress): Promise<void> {
  const nextCheckpoint: AgentRunCheckpoint = { ...run.checkpoint, [STORY_PROGRESS_CHECKPOINT_KEY]: progress };
  const admin = createAdminClient();
  const { error } = await admin
    .from('agent_runs')
    .update({ checkpoint: nextCheckpoint })
    .eq('id', run.id)
    .eq('status', 'processing');
  if (error) {
    throw new Error(`Failed to persist story generation progress: ${error.message}`);
  }
  run.checkpoint = nextCheckpoint;
}

// ── Stage: brief_ready ───────────────────────────────────────────────────

async function runBriefStage(run: AgentRun, task: AgentTask, persona: AgentPersona): Promise<StageExecutionOutcome> {
  const idempotencyKey = `agentic_run:${run.id}:brief_ready`;
  let authorization: AgenticAuthorization;
  try {
    authorization = await authorizeAgenticSpend('preview_seed_plan', idempotencyKey, {
      runId: run.id,
      taskId: task.id,
      personaId: persona.id,
      stage: 'brief_ready',
    });
  } catch (error) {
    return toFailure(error, { stage: 'brief_ready' });
  }

  try {
    const config = await getModelConfig('agent_story_brief');
    const prompt = buildStoryBriefPrompt(persona, task);
    const raw = await callGeminiAgenticJson({
      task: 'agent_story_brief',
      model: config.model,
      prompt,
      temperature: config.temperature ?? 0.6,
      telemetry: buildTelemetry(run, task, persona, 'brief_ready'),
    });
    const brief = parseStoryBrief(raw);
    await finalizeAgenticSpend(authorization.reservationId);
    await appendRunEvent(
      run.id,
      'brief_ready',
      'info',
      `Story brief generated (${brief.themes.length} themes, ${brief.characters.length} characters).`
    );
    return { kind: 'advanced', checkpointPayload: brief };
  } catch (error) {
    await releaseAgenticSpend(authorization.reservationId, 'brief_generation_failed');
    return toFailure(error, { stage: 'brief_ready' });
  }
}

// ── Stage: novelty_checked ───────────────────────────────────────────────

/**
 * Key the pre-generation verdict is cached under, inside the SAME
 * agent_runs.checkpoint object the orchestrator's stage-name keys live in --
 * and deliberately NOT under the 'novelty_checked' stage key itself.
 *
 * Using the stage key would make isCheckpointed() true, and advanceRun applies
 * a checkpointed stage "for free" without calling the executor: a blocked run
 * would sail straight past the block on its next attempt. The verdict is cached
 * so it is DECIDED once, not so the stage is SKIPPED.
 */
const NOVELTY_VERDICT_CHECKPOINT_KEY = 'novelty_checked_verdict';

interface CachedNoveltyVerdict {
  verdict: string;
  score: number;
  adjudicated: boolean;
  reason: string;
}

/**
 * Persists the pre-generation verdict, guarded on this run still being the one
 * holding the claim. Mirrors persistStoryGenerationProgress: a targeted UPDATE
 * plus an in-place mutation of run.checkpoint, because advanceRun reads that
 * field after the executor returns and would otherwise spread a stale copy.
 *
 * Best-effort by design -- failing to cache a verdict must not fail a run that
 * is otherwise fine. The cost of a miss is one extra adjudication, not a wrong
 * answer.
 */
async function persistNoveltyVerdict(run: AgentRun, cached: CachedNoveltyVerdict): Promise<void> {
  const nextCheckpoint: AgentRunCheckpoint = { ...run.checkpoint, [NOVELTY_VERDICT_CHECKPOINT_KEY]: cached };
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('agent_runs')
      .update({ checkpoint: nextCheckpoint })
      .eq('id', run.id)
      .eq('status', 'processing');
    if (error) {
      console.error('[agentic-story-assembly] failed to cache novelty verdict:', error.message);
      return;
    }
    run.checkpoint = nextCheckpoint;
  } catch (error) {
    console.error('[agentic-story-assembly] failed to cache novelty verdict:', error instanceof Error ? error.message : error);
  }
}

async function runNoveltyStage(run: AgentRun, task: AgentTask, persona: AgentPersona): Promise<StageExecutionOutcome> {
  const brief = run.checkpoint.brief_ready as StoryBrief | undefined;
  if (!brief) {
    return { kind: 'failed', message: 'novelty_checked reached with no brief_ready checkpoint present.' };
  }

  // ADJUDICATE ONCE PER RUN, NOT ONCE PER ATTEMPT. A 'block' fails this stage,
  // and handleStageFailure returns the run to 'pending' for another attempt --
  // at which point brief_ready is checkpointed and skipped, but this stage is
  // not, so without the cache the whole check re-ran, adjudicator included.
  // The adjudicator is a model call and is non-deterministic inside the
  // ambiguous band: four adjudications of identical input returned block,
  // block, warn, block. That made a block mean "blocked unless one of up to
  // MAX_RUN_ATTEMPTS coin flips disagrees" -- a lottery, not a gate. Caching
  // the verdict makes the run's answer the same on every attempt, so a block
  // stays blocked and a clear stays clear.
  const cached = run.checkpoint[NOVELTY_VERDICT_CHECKPOINT_KEY] as CachedNoveltyVerdict | undefined;

  let verdict: string;
  let score: number;
  let adjudicated: boolean;
  let reason: string;

  if (cached) {
    ({ verdict, score, adjudicated, reason } = cached);
  } else {
    const candidate: NoveltyCandidate = {
      title: brief.workingTitle,
      premise: brief.premise,
      themes: brief.themes,
      characterNames: brief.characters.map((character) => character.name),
      language: persona.language,
      ageGroup: persona.ageGroup,
      genre: task.genre ?? persona.genres[0] ?? null,
      seriesId: task.seriesId ?? null,
    };

    const result = await runNoveltyCheck('pre_generation', candidate, {
      taskId: task.id,
      runId: run.id,
      personaId: persona.id,
    });

    verdict = result.verdict;
    score = result.score;
    adjudicated = result.adjudicated;
    reason = (result.reasons[0] ?? 'Flagged as derivative of existing catalogue content.').slice(0, 240);
    await persistNoveltyVerdict(run, { verdict, score, adjudicated, reason });
  }

  if (verdict === 'block') {
    await appendRunEvent(
      run.id,
      'novelty_checked',
      'warn',
      `Novelty check blocked generation${cached ? ' (verdict decided on the first attempt)' : ''}: ${reason}`
    );
    return { kind: 'failed', message: `Novelty check blocked this story: ${reason}` };
  }

  await appendRunEvent(run.id, 'novelty_checked', 'info', `Novelty check verdict: ${verdict}.`);
  return { kind: 'advanced', checkpointPayload: { verdict, score, adjudicated } };
}

// ── Stage: story_generated ───────────────────────────────────────────────

async function runStoryGeneratedStage(run: AgentRun, task: AgentTask, persona: AgentPersona): Promise<StageExecutionOutcome> {
  const brief = run.checkpoint.brief_ready as StoryBrief | undefined;
  if (!brief) {
    return { kind: 'failed', message: 'story_generated reached with no brief_ready checkpoint present.' };
  }

  const startedAt = Date.now();
  const targetBeatCount = clampBeatCount(persona, task.targetBeatCount ?? Number.NaN);
  let progress: SeedGenerationProgress =
    (run.checkpoint[STORY_PROGRESS_CHECKPOINT_KEY] as SeedGenerationProgress | undefined) ?? {};

  // Part 1: seed source prose (agent_seed_story_writing).
  if (!progress.sourceText) {
    const idempotencyKey = `agentic_run:${run.id}:story_generated:seed_source`;
    let authorization: AgenticAuthorization;
    try {
      authorization = await authorizeAgenticSpend('preview_seed_plan', idempotencyKey, {
        runId: run.id, taskId: task.id, personaId: persona.id, stage: 'story_generated', part: 'seed_source',
      });
    } catch (error) {
      return toFailure(error, { stage: 'story_generated', part: 'seed_source' });
    }

    try {
      const config = await getModelConfig('agent_seed_story_writing');
      const prompt = buildSeedSourcePrompt(persona, brief, targetBeatCount);
      const raw = await callGeminiAgenticJson({
        task: 'agent_seed_story_writing',
        model: config.model,
        prompt,
        temperature: config.temperature ?? 0.85,
        telemetry: buildTelemetry(run, task, persona, 'story_generated:seed_source'),
      });
      const sourceText = parseSeedSourceText(raw);
      await finalizeAgenticSpend(authorization.reservationId);
      progress = { ...progress, sourceText };
      await persistStoryGenerationProgress(run, progress);
      await appendRunEvent(run.id, 'story_generated', 'info', 'Seed source prose generated.');
    } catch (error) {
      await releaseAgenticSpend(authorization.reservationId, 'seed_source_generation_failed');
      return toFailure(error, { stage: 'story_generated', part: 'seed_source' });
    }
  }

  if (timeBudgetExceeded(startedAt)) {
    return { kind: 'deferred', message: 'Time budget exhausted after seed source generation; resuming on the next drain.' };
  }

  // Part 2: seed plan (segments the source into targetBeatCount beat outlines).
  if (!progress.seedPlan) {
    const idempotencyKey = `agentic_run:${run.id}:story_generated:seed_plan`;
    let authorization: AgenticAuthorization;
    try {
      authorization = await authorizeAgenticSpend('preview_seed_plan', idempotencyKey, {
        runId: run.id, taskId: task.id, personaId: persona.id, stage: 'story_generated', part: 'seed_plan',
      });
    } catch (error) {
      return toFailure(error, { stage: 'story_generated', part: 'seed_plan' });
    }

    try {
      const baseConfig = resolvePersonaStoryConfig(persona);
      const seedPlan = await generateSeedPlanPreview({
        storyConfig: baseConfig,
        sourceText: progress.sourceText!,
        beatCount: targetBeatCount,
        workingTitle: brief.workingTitle,
        sourceFidelity: 'strictly_follow',
        costTelemetry: buildTelemetry(run, task, persona, 'story_generated:seed_plan'),
      });
      await finalizeAgenticSpend(authorization.reservationId);
      progress = { ...progress, seedPlan };
      await persistStoryGenerationProgress(run, progress);
      await appendRunEvent(run.id, 'story_generated', 'info', `Seed plan generated (${seedPlan.beats.length} beats).`);
    } catch (error) {
      await releaseAgenticSpend(authorization.reservationId, 'seed_plan_generation_failed');
      return toFailure(error, { stage: 'story_generated', part: 'seed_plan' });
    }
  }

  if (timeBudgetExceeded(startedAt)) {
    return { kind: 'deferred', message: 'Time budget exhausted after seed plan generation; resuming on the next drain.' };
  }

  const seedPlan = progress.seedPlan!;
  const sourceText = progress.sourceText!;
  const storyConfig = buildSeededStoryConfig(persona, brief, sourceText, seedPlan, targetBeatCount);
  const visualStyle = deriveVisualStyleSummary(storyConfig.visualSettings);

  let completedBeats = progress.completedBeats ?? [];
  let runningCharacters: Character[] = mergeCharacterRoster(
    briefCharactersToRoster(brief.characters),
    completedBeats.flatMap((beat) => beat.characters)
  );

  // Part 3: per-beat materialize + storyboard compose, resuming from wherever
  // progress.completedBeats left off. Each beat is two paid calls, each with
  // its own authorize/finalize/release and its own stable idempotency key, so
  // a retry after a crash between the two never repeats the one that already
  // landed (materializeSeededBeat's checkpoint entry exists) or gets charged
  // twice for the one that did not.
  let nextIndex = nextBeatIndexToGenerate(progress, targetBeatCount);
  while (nextIndex !== undefined) {
    if (timeBudgetExceeded(startedAt)) {
      return {
        kind: 'deferred',
        message: `Time budget exhausted before beat ${nextIndex}/${targetBeatCount}; resuming on the next drain.`,
      };
    }

    const seedBeat = getSeedBeatByIndex(seedPlan, nextIndex);
    if (!seedBeat) {
      return { kind: 'failed', message: `Seed plan has no outline for beat ${nextIndex} of ${targetBeatCount}.` };
    }

    const sessionState: Partial<StorySession> = {
      storyConfig,
      characters: runningCharacters,
      beats: completedBeats,
      visualStyle,
      // REQUIRED, and its absence is not cosmetic. validateGeneratedBeat
      // (lib/ai/story-bible.ts) derives the beat number it expects as
      // `Math.max(1, (sessionState?.currentBeat || 0) + 1)`. Leave currentBeat
      // undefined and that pins the expectation at 1 for EVERY beat: beat 1
      // validates, beat 2 comes back correctly numbered 2, fails validation,
      // retries, fails again, and burns the whole run at
      // 'beatNumber should be 1 but was 2'. The browser path never hit this
      // because lib/store/story-store.ts always passes a real StorySession
      // that maintains currentBeat; this headless path builds its own.
      // Same derivation the store uses (story-store.ts): the last completed
      // beat's number, or 0 before any exist.
      currentBeat: completedBeats.length > 0 ? completedBeats[completedBeats.length - 1].beatNumber : 0,
    };

    const beatActionKey: PricingActionKey =
      nextIndex === 1 ? 'start_story_initial_beat_prompt_only' : 'continue_story_new_beat_prompt_only';

    const materializeIdempotencyKey = `agentic_run:${run.id}:story_generated:beat:${nextIndex}:materialize`;
    let materializeAuthorization: AgenticAuthorization;
    try {
      materializeAuthorization = await authorizeAgenticSpend(beatActionKey, materializeIdempotencyKey, {
        runId: run.id, taskId: task.id, personaId: persona.id, stage: 'story_generated', part: 'materialize', beatIndex: nextIndex,
      });
    } catch (error) {
      return toFailure(error, { stage: 'story_generated', part: 'materialize', beatIndex: nextIndex });
    }

    let beat: StoryBeat;
    try {
      const materialized = await materializeSeededBeat(
        seedBeat,
        sessionState,
        undefined,
        buildTelemetry(run, task, persona, `story_generated:beat_${nextIndex}_materialize`)
      );
      beat = mergeCharacterVisualReferences(materialized, runningCharacters);
      await finalizeAgenticSpend(materializeAuthorization.reservationId);
    } catch (error) {
      await releaseAgenticSpend(materializeAuthorization.reservationId, 'beat_materialize_failed');
      return toFailure(error, { stage: 'story_generated', part: 'materialize', beatIndex: nextIndex });
    }

    const storyboardIdempotencyKey = `agentic_run:${run.id}:story_generated:beat:${nextIndex}:storyboard`;
    let storyboardAuthorization: AgenticAuthorization;
    try {
      storyboardAuthorization = await authorizeAgenticSpend(beatActionKey, storyboardIdempotencyKey, {
        runId: run.id, taskId: task.id, personaId: persona.id, stage: 'story_generated', part: 'storyboard', beatIndex: nextIndex,
      });
    } catch (error) {
      return toFailure(error, { stage: 'story_generated', part: 'storyboard', beatIndex: nextIndex });
    }

    try {
      // Every materialized beat gets a storyboard plan, unconditionally --
      // 'prompt_only' means "produce the prompts, don't render images", not
      // "skip the plan"; a reviewer generates images from these stored
      // prompts later (Phase 10). Mirrors lib/store/story-store.ts's own
      // materializeSeededBeat -> composeStoryboardPlan sequence exactly.
      const plan = await composeStoryboardPlan(
        beat,
        sessionState,
        visualStyle,
        undefined,
        buildTelemetry(run, task, persona, `story_generated:beat_${nextIndex}_storyboard`)
      );
      beat = { ...beat, storyboardPlan: plan, storyboardPromptText: renderStoryboardPlan(plan), isStoryboard: true };
      await finalizeAgenticSpend(storyboardAuthorization.reservationId);
    } catch (error) {
      await releaseAgenticSpend(storyboardAuthorization.reservationId, 'beat_storyboard_failed');
      return toFailure(error, { stage: 'story_generated', part: 'storyboard', beatIndex: nextIndex });
    }

    completedBeats = [...completedBeats, beat];
    runningCharacters = mergeCharacterRoster(runningCharacters, beat.characters);
    progress = { ...progress, completedBeats };
    await persistStoryGenerationProgress(run, progress);
    await appendRunEvent(run.id, 'story_generated', 'info', `Beat ${nextIndex}/${targetBeatCount} materialized.`);

    nextIndex = nextBeatIndexToGenerate(progress, targetBeatCount);
  }

  try {
    buildSeededStoryMap(completedBeats);
  } catch (error) {
    if (error instanceof SeededStoryMapError) {
      return { kind: 'failed', message: error.message, error };
    }
    throw error;
  }

  return { kind: 'advanced', checkpointPayload: { beatCount: completedBeats.length, targetBeatCount } };
}

// ── Stage: draft_created ─────────────────────────────────────────────────

function buildAgentStorySession(params: {
  run: AgentRun;
  task: AgentTask;
  persona: AgentPersona;
  brief: StoryBrief;
  storyConfig: StoryConfig;
  storyMap: StoryMap;
  characters: Character[];
}): StorySession {
  const { run, task, persona, brief, storyConfig, storyMap, characters } = params;
  return {
    storySessionId: `agentic-run-${run.id}`,
    userPrompt: task.brief,
    title: brief.workingTitle,
    genre: task.genre || persona.genres[0] || '',
    tone: 'playful',
    targetAge: persona.ageGroup,
    visualStyle: deriveVisualStyleSummary(storyConfig.visualSettings),
    currentBeat: Object.keys(storyMap.nodes).length,
    maxBeats: storyConfig.maxBeats,
    status: 'completed',
    characters,
    setting: {
      world: storyConfig.settingCountry !== 'generic' ? storyConfig.settingCountry : 'unknown',
      timeOfDay: 'unknown',
      mood: 'unknown',
    },
    storyConfig,
    storyMap,
    beats: Object.values(storyMap.nodes).map((node) => node.data),
    choiceHistory: [],
    openThreads: [],
    allowedEndings: [],
    safetyProfile: persona.ageGroup.startsWith('kids') ? 'children' : 'all_ages',
  };
}

async function runDraftCreatedStage(run: AgentRun, task: AgentTask, persona: AgentPersona): Promise<StageExecutionOutcome> {
  const brief = run.checkpoint.brief_ready as StoryBrief | undefined;
  const progress = run.checkpoint[STORY_PROGRESS_CHECKPOINT_KEY] as SeedGenerationProgress | undefined;

  if (!brief) {
    return { kind: 'failed', message: 'draft_created reached with no brief_ready checkpoint present.' };
  }
  if (!progress?.sourceText || !progress.seedPlan || !progress.completedBeats?.length) {
    return { kind: 'failed', message: 'draft_created reached without a completed story_generated checkpoint.' };
  }

  const targetBeatCount = clampBeatCount(persona, task.targetBeatCount ?? Number.NaN);
  if (progress.completedBeats.length < targetBeatCount) {
    return {
      kind: 'failed',
      message: `draft_created reached with only ${progress.completedBeats.length}/${targetBeatCount} beats completed.`,
    };
  }

  const systemUserId = process.env.AGENTIC_SYSTEM_USER_ID;
  if (!systemUserId) {
    return { kind: 'failed', message: 'AGENTIC_SYSTEM_USER_ID is not set; cannot save the story draft without a system user.' };
  }

  const storyConfig = buildSeededStoryConfig(persona, brief, progress.sourceText, progress.seedPlan, targetBeatCount);

  let storyMap: StoryMap;
  try {
    storyMap = buildSeededStoryMap(progress.completedBeats);
  } catch (error) {
    if (error instanceof SeededStoryMapError) {
      return { kind: 'failed', message: error.message, error };
    }
    throw error;
  }

  const finalRoster = mergeCharacterRoster(
    briefCharactersToRoster(brief.characters),
    progress.completedBeats.flatMap((beat) => beat.characters)
  );
  const session = buildAgentStorySession({ run, task, persona, brief, storyConfig, storyMap, characters: finalRoster });

  try {
    const admin = createAdminClient();
    const { storyId } = await saveStoryForUser(admin, systemUserId, session, storyMap, {
      agentPersonaId: persona.id,
      agentTaskId: task.id,
    });

    // ORDER IS LOAD-BEARING: this check runs BEFORE the story is written into
    // agent_story_memory, never after. findSimilarStories (lib/agentic/memory.ts)
    // selects from agent_story_memory filtered only by language and age group and
    // has NO self-exclusion, so recording first makes the story its own nearest
    // neighbour -- a perfect match -- and the verdict comes back 'block' for every
    // agent story ever generated. That was measured, not theorised: the same story
    // scored 'clear' from the Test Lab's pre-save preview and 'block' from here,
    // with recordStoryMemory the only difference between the two calls. A check
    // that flags everything is worse than no check: Phase 9's reviewer queue would
    // show a block warning on every story and reviewers would learn to ignore the
    // one signal meant to catch real duplication.
    //
    // Post-generation never deletes a saved draft -- it only warns. The human
    // review gate downstream (awaiting_review) is the real safeguard.
    //
    // The more general hardening -- an excludeStoryId option threaded through
    // runNoveltyCheck into findSimilarStories -- would protect any FUTURE caller
    // that compares an already-recorded story. Deliberately not done here: it
    // changes a shared signature during a verification pass. Recorded in
    // PROJECT_STATE's deferred list instead.
    const postCheck = await runNoveltyCheck(
      'post_generation',
      {
        title: brief.workingTitle,
        premise: brief.premise,
        themes: brief.themes,
        characterNames: finalRoster.map((character) => character.name),
        language: persona.language,
        ageGroup: persona.ageGroup,
        genre: task.genre ?? null,
        seriesId: task.seriesId ?? null,
      },
      { taskId: task.id, runId: run.id, personaId: persona.id }
    ).catch(() => null);

    if (postCheck && postCheck.verdict !== 'clear') {
      await appendRunEvent(run.id, 'draft_created', 'warn', `Post-generation novelty check: ${postCheck.verdict}.`);
    }

    await recordStoryMemory({
      storyId,
      personaId: persona.id,
      title: brief.workingTitle,
      premise: brief.premise,
      language: persona.language,
      ageGroup: persona.ageGroup,
      genre: task.genre ?? persona.genres[0] ?? null,
      themes: brief.themes,
      characterNames: finalRoster.map((character) => character.name),
      origin: 'agent',
    }).catch((error) => {
      console.error('[agentic-story-assembly] failed to record story memory:', error instanceof Error ? error.message : error);
    });

    await updatePersonaMemory(persona.id, {
      title: brief.workingTitle,
      premise: brief.premise,
      themes: brief.themes,
      characterNames: finalRoster.map((character) => character.name),
      settingSummary: storyConfig.settingCountry !== 'generic' ? storyConfig.settingCountry : undefined,
    }).catch((error) => {
      console.error('[agentic-story-assembly] failed to update persona memory:', error instanceof Error ? error.message : error);
    });

    await appendRunEvent(run.id, 'draft_created', 'info', `Draft story saved (${progress.completedBeats.length} beats).`);

    // Carries the post-generation novelty verdict forward for the 'evaluated'
    // stage (lib/agentic/evaluation.shared.ts's DeterministicEvaluationInput),
    // so it does not need to re-run or re-derive a check draft_created already
    // paid for. Two runs already at awaiting_review on dev were checkpointed
    // before this field existed and carry only { storyId } here -- the
    // evaluator treats an absent postNovelty exactly like postCheck === null
    // below (noveltyVerdict: null), which its deterministic layer already
    // turns into a 'novelty_unavailable' info warning, never a failure.
    return {
      kind: 'advanced',
      checkpointPayload: {
        storyId,
        postNovelty: postCheck ? { verdict: postCheck.verdict, reason: (postCheck.reasons[0] ?? '').slice(0, 240) } : null,
      },
      storyId,
    };
  } catch (error) {
    return toFailure(error, { stage: 'draft_created' });
  }
}

// ── Stage: evaluated ─────────────────────────────────────────────────────

/**
 * THE 'evaluated' STAGE HAS NO FAILURE PATH. NONE -- not a missing persona,
 * not a missing checkpoint, not a model timeout, not an unapplied migration
 * 108. It never returns {kind: 'failed'}. See evaluation.ts's module header
 * for the full reasoning: draft_created has already saved a real story to
 * `stories` by the time this stage runs, so failing here would strand that
 * story outside every reviewer surface (they read runs at 'awaiting_review')
 * while it still sits in the database, after all the paid generation. Every
 * problem below becomes an appendRunEvent(..., 'warn', ...) line plus an
 * advance. The single exception, which is NOT a failure, is {kind:
 * 'deferred'} for the master flag or an exhausted time budget -- both lose no
 * work and the run simply resumes.
 *
 * Called directly from storyAssemblyExecutor, BEFORE the shared task/persona
 * preamble further down in this file -- that preamble can itself return
 * {kind: 'failed'} for a missing task or a deleted persona, which this stage
 * may never produce. So this function does its own loading, with its own
 * tolerant handling, instead of reusing that preamble.
 */
async function runEvaluatedStage(run: AgentRun): Promise<StageExecutionOutcome> {
  const startedAt = Date.now();

  const flags = await getAgenticFlags();
  if (!flags.creatorEnabled) {
    return { kind: 'deferred', message: 'Agentic Creator System master flag is off; leaving run pending.' };
  }

  // DECIDED ONCE PER RUN, NOT ONCE PER ATTEMPT -- and here that is genuinely
  // load-bearing, not merely defensive the way runNoveltyStage's cache is
  // (that one guards against a non-deterministic adjudicator; the
  // deterministic evaluation layer is deterministic by construction).
  // idx_agent_evaluations_pipeline_run is a PARTIAL UNIQUE INDEX on (run_id)
  // WHERE trigger_source = 'pipeline', so a second pipeline insert for the
  // same run is a constraint violation, not a benign overwrite. Without this
  // read-first check, a crash between evaluateAndRecord's insert landing and
  // the orchestrator's own end-of-stage checkpoint write would leave the run
  // still short of 'evaluated' -- and every subsequent retry would pay for a
  // fresh model call, only to have its own insert fail the unique constraint
  // and the verdict never get recorded at all.
  const existing = await getPipelineEvaluationForRun(run.id);
  if (existing) {
    await appendRunEvent(
      run.id,
      'evaluated',
      existing.verdict === 'fail' ? 'warn' : 'info',
      `Evaluation verdict decided on an earlier attempt: ${existing.verdict} (${existing.reviewReadiness}), model ${existing.modelStatus}, ${existing.warnings.length} warning(s).`
    );
    return {
      kind: 'advanced',
      checkpointPayload: {
        verdict: existing.verdict,
        reviewReadiness: existing.reviewReadiness,
        modelStatus: existing.modelStatus,
        warningCount: existing.warnings.length,
      },
    };
  }

  // From here on, EVERY problem is a warn event plus an advance -- never
  // {kind: 'failed'}.
  let task: AgentTask | null = null;
  try {
    task = await getAgentTask(run.taskId);
  } catch (error) {
    await appendRunEvent(
      run.id,
      'evaluated',
      'warn',
      `Evaluation could not load the commissioned task: ${error instanceof Error ? error.message : 'unknown error'}.`
    );
  }

  let persona: AgentPersona | null = null;
  if (run.personaId) {
    try {
      persona = await loadPersonaById(run.personaId);
    } catch (error) {
      await appendRunEvent(
        run.id,
        'evaluated',
        'warn',
        `Evaluation could not load the persona: ${error instanceof Error ? error.message : 'unknown error'}.`
      );
    }
  }

  const skippedOutcome: StageExecutionOutcome = {
    kind: 'advanced',
    checkpointPayload: { verdict: null, reviewReadiness: null, modelStatus: 'skipped', warningCount: 0 },
  };

  if (!task || !persona) {
    // Without a persona there is no language, age group or restricted-theme
    // list to grade against -- evaluate nothing and say so plainly, rather
    // than guessing at defaults that would silently misjudge the draft.
    await appendRunEvent(
      run.id,
      'evaluated',
      'warn',
      `Evaluation skipped: ${!task ? 'commissioned task' : 'persona'} unavailable.`
    );
    return skippedOutcome;
  }

  const brief = run.checkpoint.brief_ready as StoryBrief | undefined;
  const progress = run.checkpoint[STORY_PROGRESS_CHECKPOINT_KEY] as SeedGenerationProgress | undefined;
  if (!brief || !progress?.completedBeats?.length) {
    await appendRunEvent(
      run.id,
      'evaluated',
      'warn',
      'Evaluation skipped: this run has no completed beats recorded in its checkpoint.'
    );
    return skippedOutcome;
  }

  // draft_created's checkpoint carries { storyId, postNovelty } as of this
  // unit; two runs already at awaiting_review on dev were checkpointed before
  // postNovelty existed and carry only { storyId } here. Treated identically:
  // absent postNovelty becomes noveltyVerdict: null below, which the
  // deterministic layer already turns into a 'novelty_unavailable' info
  // warning, never a failure.
  const draftCreated = run.checkpoint.draft_created as
    | { storyId?: string; postNovelty?: { verdict: NoveltyVerdict; reason: string } | null }
    | undefined;
  const postNovelty = draftCreated?.postNovelty ?? null;

  const targetBeatCount = clampBeatCount(persona, task.targetBeatCount ?? Number.NaN);

  const deterministic: DeterministicEvaluationInput = {
    beats: progress.completedBeats.map((beat) => ({
      beatNumber: beat.beatNumber,
      storyText: beat.storyText,
      optionCount: beat.options.length,
      isEnding: beat.isEnding,
    })),
    targetBeatCount,
    ageGroup: persona.ageGroup,
    beatLengthLevel: resolvePersonaStoryConfig(persona).beatLength?.level,
    language: persona.language,
    restrictedThemes: persona.restrictedThemes,
    briefThemes: brief.themes,
    noveltyVerdict: postNovelty?.verdict ?? null,
    noveltyReason: postNovelty?.reason ?? null,
  };

  // Deferring on a blown time budget would be equally correct here (see
  // runStoryGeneratedStage's own deferrals for the same tradeoff elsewhere in
  // this file), but chosen differently: this stage has no paid work left
  // except the one optional model call below, a deterministic-only grade
  // costs nothing, and it is strictly more useful to a reviewer than no grade
  // at all. So this stage always evaluates and only drops the model call when
  // the budget is already gone.
  const promptInput = timeBudgetExceeded(startedAt)
    ? null
    : {
        personaDisplayName: persona.displayName,
        personaPrompt: persona.personaPrompt,
        language: persona.language,
        ageGroup: persona.ageGroup,
        genre: task.genre ?? persona.genres[0] ?? null,
        workingTitle: brief.workingTitle,
        premise: brief.premise,
        beats: deterministic.beats,
      };

  const { evaluation } = await evaluateAndRecord({
    runId: run.id,
    storyId: run.storyId ?? draftCreated?.storyId ?? null,
    personaId: persona.id,
    triggerSource: 'pipeline',
    deterministic,
    promptInput,
    telemetry: buildTelemetry(run, task, persona, 'evaluated'),
  });

  // Short and factual, per this module's own no-prose rule -- verdict,
  // readiness, model status, warning count. Never story text, never a model
  // concern verbatim.
  await appendRunEvent(
    run.id,
    'evaluated',
    evaluation.verdict === 'fail' ? 'warn' : 'info',
    `Evaluation verdict: ${evaluation.verdict} (${evaluation.reviewReadiness}), model ${evaluation.modelStatus}, ${evaluation.warnings.length} warning(s).`
  );

  return {
    kind: 'advanced',
    checkpointPayload: {
      verdict: evaluation.verdict,
      reviewReadiness: evaluation.reviewReadiness,
      modelStatus: evaluation.modelStatus,
      warningCount: evaluation.warnings.length,
    },
  };
}

// ── Entry point: the StageExecutor lib/agentic/orchestrator.ts's
// drainAgentRuns() resolves lazily and uses as its default executor ────────

/**
 * The headless story-assembly executor. For each targetStage:
 *  - evaluated: delegates to runEvaluatedStage, which has NO FAILURE PATH --
 *    see that function's own header comment. Handled FIRST, before the
 *    shared task/persona preamble below, precisely because that preamble can
 *    itself return {kind: 'failed'} for a missing task or a deleted persona,
 *    an outcome this stage may never produce; runEvaluatedStage does its own
 *    tolerant loading instead of reusing it.
 *  - narration_pending / narration_complete: advance immediately (Phase 8
 *    ships these; deferring here would return the run to 'pending' forever
 *    without consuming an attempt -- an infinite loop, not a safe wait).
 *  - awaiting_review: advance immediately. This is the automatic pipeline's
 *    hand-off point to a human reviewer, not a failure -- V1 has no
 *    autonomous publish past this point.
 *  - brief_ready / novelty_checked / story_generated / draft_created: real
 *    generation work, requiring the run's task and persona to be loaded
 *    first.
 */
export const storyAssemblyExecutor: StageExecutor = async (run, targetStage) => {
  if (targetStage === 'evaluated') {
    return runEvaluatedStage(run);
  }

  if (
    targetStage === 'narration_pending'
    || targetStage === 'narration_complete'
    || targetStage === 'awaiting_review'
  ) {
    const note = targetStage === 'awaiting_review'
      ? 'Draft is ready for human review.'
      : 'Narration is not implemented yet (Phase 8); advancing without it.';
    await appendRunEvent(run.id, targetStage, 'info', note);
    return { kind: 'advanced' };
  }

  const flags = await getAgenticFlags();
  if (!flags.creatorEnabled) {
    return { kind: 'deferred', message: 'Agentic Creator System master flag is off; leaving run pending.' };
  }

  let task: AgentTask | null;
  try {
    task = await getAgentTask(run.taskId);
  } catch (error) {
    return toFailure(error, { stage: targetStage, part: 'load_task' });
  }
  if (!task) {
    return { kind: 'deferred', message: 'agent_task not found, or migration 106 is unavailable; leaving run pending.' };
  }

  if (!run.personaId) {
    return {
      kind: 'failed',
      message: 'This run has no persona assigned; assign a persona to its task before it can generate a story.',
    };
  }

  let persona: AgentPersona | null;
  try {
    persona = await loadPersonaById(run.personaId);
  } catch (error) {
    if (isMissingPersonaSchemaError(error as { code?: string; message?: string } | null | undefined)) {
      return { kind: 'deferred', message: 'Persona storage is not available yet (migration 103 unapplied); leaving run pending.' };
    }
    return toFailure(error, { stage: targetStage, part: 'load_persona' });
  }
  if (!persona) {
    return { kind: 'failed', message: `Persona ${run.personaId} was not found; it may have been deleted.` };
  }

  switch (targetStage) {
    case 'brief_ready':
      return runBriefStage(run, task, persona);
    case 'novelty_checked':
      return runNoveltyStage(run, task, persona);
    case 'story_generated':
      return runStoryGeneratedStage(run, task, persona);
    case 'draft_created':
      return runDraftCreatedStage(run, task, persona);
    default:
      return { kind: 'deferred', message: `Stage '${targetStage}' has no story-assembly executor yet.` };
  }
};
