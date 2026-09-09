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
  shouldRetry,
  type AgentRunCheckpoint,
} from '@/lib/agentic/orchestrator.shared';
import {
  AGENTIC_SOURCE_FIDELITY,
  buildSeededStoryMap,
  getSeedBeatByIndex,
  mergeNoveltyAvoidTitles,
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
import { runNoveltyCheck, recordStoryMemory, updatePersonaMemory, loadPersonaMemory } from '@/lib/agentic/memory';
import { formatPersonaMemoryForBrief, sanitizeNoveltyTitleForDisplay } from '@/lib/agentic/memory.shared';
import type { NoveltyCandidate, NoveltyTopCandidate, NoveltyVerdict } from '@/lib/agentic/memory.shared';
import { evaluateAndRecord, getPipelineEvaluationForRun } from '@/lib/agentic/evaluation';
import { toEvaluatedBeats, type DeterministicEvaluationInput } from '@/lib/agentic/evaluation.shared';
import { generateSeedPlanPreview, materializeSeededBeat } from '@/lib/ai/seed-authoring';
import { composeStoryboardPlan, renderStoryboardPlan, mergeCharacterVisualReferences } from '@/lib/ai/beat-orchestration';
import { saveStoryForUser } from '@/lib/story/save-story';
import { callGeminiAgenticJson } from '@/app/actions/gemini-proxy';
import { getModelConfig } from '@/lib/ai/model-config';
import { authorizeBillableAction, finalizeBillableAction, releaseBillableAction } from '@/lib/pricing/enforcement';
import type { PricingActionKey } from '@/lib/types/pricing';
import { normalizeStoryConfig, deriveVisualStyleSummary } from '@/lib/ai/story-config';
import { resolveStoryBeatLength, type ResolvedStoryBeatLength } from '@/lib/ai/story-audience';
import { getNarrationVoiceSettings } from '@/lib/ai/narration-voice-settings';
import { resolvePersonaVoice } from '@/lib/agentic/persona-voice.shared';
import {
  resolveStoryNarrationLanguage,
  type NarrationGenderBucket,
  type NarrationLanguageCode,
  type StoryNarrationVoiceSelection,
} from '@/lib/ai/narration-voices';
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

/**
 * `memoryBlock` is formatPersonaMemoryForBrief's rendered output (memory.shared.ts)
 * -- '' when the persona has no memory worth mentioning, or when loading it
 * failed (see loadPersonaMemoryBlockForBrief below). Spliced in after the
 * persona identity and commission brief, before the JSON output contract, so
 * it reads as context the model has by the time it is asked to write, not as
 * a trailing afterthought below the response-shape instructions.
 *
 * THIS IS A NUDGE, NOT A NOVELTY GUARANTEE. It reduces how often an identical
 * boilerplate brief reproduces an identical story; it never decides whether a
 * story IS too similar to a prior one. That authority stays entirely with
 * runNoveltyCheck (memory.ts), per decision D9. Do not remove or weaken that
 * check on the theory that this prompt block makes it redundant -- a missing
 * or empty memoryBlock only costs one extra chance of a collision, which the
 * novelty check still catches downstream.
 *
 * `avoidTitles` is a DIFFERENT, SHARPER signal than memoryBlock and is
 * rendered as its own labelled instruction rather than folded into it.
 * memoryBlock is "this persona's general recent output, spread over many past
 * stories" -- a soft nudge against staleness. avoidTitles is "these specific
 * titles were just rejected THIS run, this attempt" -- see runNoveltyStage's
 * re-brief path -- and deserves to read as a hard instruction, not diluted
 * into the same paragraph as a much softer one.
 */
function buildStoryBriefPrompt(
  persona: AgentPersona,
  task: AgentTask,
  memoryBlock: string,
  avoidTitles: string[] = []
): string {
  const restricted = persona.restrictedThemes.length
    ? `Restricted themes -- never use these: ${persona.restrictedThemes.join(', ')}.`
    : '';
  const constraintKeys = task.constraints && typeof task.constraints === 'object' ? Object.keys(task.constraints) : [];
  const constraints = constraintKeys.length
    ? `Additional commissioning constraints (JSON): ${JSON.stringify(task.constraints)}.`
    : '';
  const avoidBlock = avoidTitles.length
    ? `A previous attempt at this exact commission was rejected as too similar to existing catalogue content. Do NOT reuse, or write a close variant of, any of these titles or the stories they name -- write a clearly different working title, premise, principal cast and setting: ${avoidTitles.join(' | ')}`
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
    memoryBlock,
    avoidBlock,
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

// Beat length is passed in, resolved once by the caller (runStoryGeneratedStage)
// from the same StoryConfig it already built via resolvePersonaStoryConfig --
// this function must NOT re-resolve persona.ageGroup/beatLength itself. Two
// places deriving "how long should this be" independently is exactly how the
// prior version's contradiction (a fixed word cap fighting a per-scene target)
// arose; there must be exactly one source of truth for it.
function buildSeedSourcePrompt(
  persona: AgentPersona,
  brief: StoryBrief,
  targetBeatCount: number,
  beatLength: ResolvedStoryBeatLength
): string {
  const cast = brief.characters
    .map((character) => `- ${character.name} (${character.role}): ${character.appearanceSummary}. ${character.personalitySummary}`)
    .join('\n');
  const approxTotalWords = beatLength.targetWords * targetBeatCount;

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
    // A target to aim for, not a hard limit -- nothing downstream validates this
    // any more (see parseSeedSourceText). A prompt that threatens a cap nothing
    // enforces is worse than one that simply asks for a length.
    `Aim for roughly ${beatLength.targetWords} words per scene (about ${approxTotalWords} words in total across all ${targetBeatCount} scenes) -- a pacing target, not a hard limit.`,
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
  // No word-count validation here on purpose. SEED_SOURCE_WORD_CAP is a
  // product limit on human-pasted input (lib/story/authoring-limits.ts) and
  // has no business bounding machine-generated source prose -- length here is
  // governed by the persona's beat-length range via buildSeedSourcePrompt's
  // guidance instead. See generateSeedPlanPreview's enforceSourceWordCap
  // parameter for the other half of this: the same cap used to be re-checked
  // there too, against the same 500-word ceiling that 8 beats' worth of
  // beat-length target already exceeds.
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
      sourceFidelity: AGENTIC_SOURCE_FIDELITY,
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

/**
 * Loads this persona's recent-story memory and formats it for the brief
 * prompt, degrading to '' on ANY failure.
 *
 * FAILS SOFT, AND MUST NEVER FAIL brief_ready ON ITS OWN. loadPersonaMemory
 * (memory.ts) already returns null for "no memory row" and for an unapplied
 * migration 103, but it rethrows anything else -- a transient read error, say
 * -- and this wrapper is what turns that rethrow into "no memory block"
 * rather than failing the stage. The cost of that is bounded and known: one
 * more chance the persona's brief repeats a recent title, premise, cast or
 * setting. runNoveltyCheck (memory.ts) is still the gate that actually
 * catches that downstream (D9) -- this block only makes the collision less
 * likely to happen in the first place, so losing it costs a possible
 * collision, never a lost run.
 */
async function loadPersonaMemoryBlockForBrief(personaId: string): Promise<string> {
  try {
    const memory = await loadPersonaMemory(personaId);
    return formatPersonaMemoryForBrief(memory);
  } catch (error) {
    console.error(
      '[agentic-story-assembly] failed to load persona memory for brief prompt; continuing without it:',
      error instanceof Error ? error.message : error
    );
    return '';
  }
}

/**
 * Builds, pays for and parses one story brief. Shared by runBriefStage's
 * initial call (the only stage the orchestrator's own forward walk ever
 * dispatches to 'brief_ready' for -- see runNoveltyStage's header comment on
 * why every SUBSEQUENT brief, after a novelty block, is generated from
 * inside 'novelty_checked' instead) and that re-brief path, so both pay for
 * and validate a brief exactly the same way. Throws on any failure; the
 * caller owns authorize/release bookkeeping around the throw.
 */
async function generateStoryBrief(
  run: AgentRun,
  task: AgentTask,
  persona: AgentPersona,
  avoidTitles: string[],
  idempotencyKey: string
): Promise<StoryBrief> {
  const authorization = await authorizeAgenticSpend('preview_seed_plan', idempotencyKey, {
    runId: run.id,
    taskId: task.id,
    personaId: persona.id,
    stage: 'brief_ready',
  });

  try {
    const config = await getModelConfig('agent_story_brief');
    const memoryBlock = await loadPersonaMemoryBlockForBrief(persona.id);
    const prompt = buildStoryBriefPrompt(persona, task, memoryBlock, avoidTitles);
    const raw = await callGeminiAgenticJson({
      task: 'agent_story_brief',
      model: config.model,
      prompt,
      temperature: config.temperature ?? 0.6,
      telemetry: buildTelemetry(run, task, persona, 'brief_ready'),
    });
    const brief = parseStoryBrief(raw);
    await finalizeAgenticSpend(authorization.reservationId);
    return brief;
  } catch (error) {
    await releaseAgenticSpend(authorization.reservationId, 'brief_generation_failed');
    throw error;
  }
}

async function runBriefStage(run: AgentRun, task: AgentTask, persona: AgentPersona): Promise<StageExecutionOutcome> {
  try {
    const brief = await generateStoryBrief(run, task, persona, [], `agentic_run:${run.id}:brief_ready`);
    await appendRunEvent(
      run.id,
      'brief_ready',
      'info',
      `Story brief generated (${brief.themes.length} themes, ${brief.characters.length} characters).`
    );
    return { kind: 'advanced', checkpointPayload: brief };
  } catch (error) {
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

/**
 * Key the accumulated re-brief avoid-list is carried under -- again inside the
 * shared checkpoint object, again never a stage name (resumeStageFromCheckpoint
 * in orchestrator.shared.ts iterates STAGE_SEQUENCE, not this object's own
 * keys, precisely so side-channel keys like this one and
 * STORY_PROGRESS_CHECKPOINT_KEY are never mistaken for a stage). See
 * mergeNoveltyAvoidTitles (story-assembly.shared.ts) for why this ACCUMULATES
 * across attempts rather than being overwritten by each one.
 */
const NOVELTY_AVOID_TITLES_CHECKPOINT_KEY = 'novelty_checked_avoid_titles';

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

/**
 * On a 'block' verdict, clears checkpoint.brief_ready and the cached verdict so
 * the NEXT attempt regenerates a fresh brief instead of adjudicating the same
 * rejected one again, and records what to avoid on that fresh brief.
 *
 * MIRRORS persistNoveltyVerdict's mechanism exactly: a targeted UPDATE guarded
 * on this run still owning the claim (`status = 'processing'`), never a blind
 * read-modify-write of the whole checkpoint object -- the class of hazard
 * commit 3455430 fixed for the Test Lab's own checkpoint write. That fix
 * additionally re-read the row immediately before merging, because ITS code
 * path runs from OUTSIDE the run's claim and can race a concurrent executor.
 * This function runs from INSIDE the executor call that already exclusively
 * owns the row while status='processing' -- the same position
 * persistNoveltyVerdict and persistStoryGenerationProgress are already in --
 * so `run.checkpoint` is this run's only writer's own up-to-date view and a
 * re-read would buy nothing real.
 *
 * REMOVES KEYS, which nothing else in this codebase does -- recordCheckpoint
 * only ever adds. Deleting brief_ready is what makes runNoveltyStage's own
 * "no cached brief" branch fire on the next attempt and regenerate one; see
 * that function's header for why the row's `stage` column is deliberately
 * left untouched here (handleStageFailure owns that transition, and it never
 * needs to move for this mechanism to work: this run resolves to
 * novelty_checked's executor on every attempt regardless).
 *
 * BEST-EFFORT AND FAIL-SOFT, DELIBERATELY: if this UPDATE does not land,
 * run.checkpoint is left exactly as it was, so the next attempt replays the
 * still-cached block exactly as it would have before this feature existed --
 * today's known-safe behaviour -- rather than throwing and failing a run for a
 * reason unrelated to novelty.
 */
async function clearBriefForRebrief(
  run: AgentRun,
  rejectedTitle: string,
  collidingTitles: string[]
): Promise<boolean> {
  const priorAvoidList = (run.checkpoint[NOVELTY_AVOID_TITLES_CHECKPOINT_KEY] as string[] | undefined) ?? [];
  const nextAvoidList = mergeNoveltyAvoidTitles(priorAvoidList, [rejectedTitle, ...collidingTitles]);

  const nextCheckpoint: AgentRunCheckpoint = { ...run.checkpoint };
  delete nextCheckpoint.brief_ready;
  delete nextCheckpoint[NOVELTY_VERDICT_CHECKPOINT_KEY];
  nextCheckpoint[NOVELTY_AVOID_TITLES_CHECKPOINT_KEY] = nextAvoidList;

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('agent_runs')
      .update({ checkpoint: nextCheckpoint })
      .eq('id', run.id)
      .eq('status', 'processing');
    if (error) {
      console.error(
        '[agentic-story-assembly] failed to clear brief for re-brief; next attempt will replay the cached block:',
        error.message
      );
      return false;
    }
    run.checkpoint = nextCheckpoint;
    return true;
  } catch (error) {
    console.error(
      '[agentic-story-assembly] failed to clear brief for re-brief; next attempt will replay the cached block:',
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

/**
 * novelty_checked -- and, after the first attempt, THE ONLY PLACE A BRIEF IS
 * EVER (RE-)GENERATED.
 *
 * A run's `stage` column only ever advances forward (persistStageAdvance), and
 * a retryable failure leaves it exactly where it was -- at 'brief_ready',
 * novelty_checked's predecessor -- for as long as this run exists;
 * handleStageFailure's retry branch (orchestrator.ts) touches `status` and the
 * error columns only, never `stage`. So on every attempt after the very
 * first, advanceRun computes nextStage('brief_ready') as 'novelty_checked'
 * again and dispatches back to THIS function, never to runBriefStage. If a
 * block is ever going to be corrected with a different brief, generating that
 * brief has to happen here: clearBriefForRebrief (above) deletes
 * checkpoint.brief_ready on a block, and the branch immediately below
 * regenerates one -- right here, before doing the actual novelty check --
 * whenever it finds that key missing.
 */
async function runNoveltyStage(run: AgentRun, task: AgentTask, persona: AgentPersona): Promise<StageExecutionOutcome> {
  let brief = run.checkpoint.brief_ready as StoryBrief | undefined;

  if (!brief) {
    // No cached brief. In practice this means a prior attempt's block just
    // cleared it (clearBriefForRebrief) -- generate a fresh one, steered away
    // from whatever this run has learned to avoid so far, before checking
    // novelty again.
    const avoidTitles = (run.checkpoint[NOVELTY_AVOID_TITLES_CHECKPOINT_KEY] as string[] | undefined) ?? [];

    let freshBrief: StoryBrief;
    try {
      freshBrief = await generateStoryBrief(
        run,
        task,
        persona,
        avoidTitles,
        `agentic_run:${run.id}:brief_ready:rebrief:${run.attemptCount}`
      );
    } catch (error) {
      return toFailure(error, { stage: 'novelty_checked', part: 'rebrief' });
    }

    // Persisted with the SAME targeted-UPDATE-plus-in-place-mutation pattern as
    // persistNoveltyVerdict/persistStoryGenerationProgress above: story_generated
    // and draft_created both read checkpoint.brief_ready later in the pipeline,
    // so the fresh brief must actually land in the row, not just live in this
    // function's local variable.
    const nextCheckpoint: AgentRunCheckpoint = { ...run.checkpoint, brief_ready: freshBrief };
    try {
      const admin = createAdminClient();
      const { error } = await admin
        .from('agent_runs')
        .update({ checkpoint: nextCheckpoint })
        .eq('id', run.id)
        .eq('status', 'processing');
      if (error) throw new Error(error.message);
      run.checkpoint = nextCheckpoint;
    } catch (error) {
      return toFailure(error, { stage: 'novelty_checked', part: 'persist_rebrief' });
    }

    brief = freshBrief;
    await appendRunEvent(
      run.id,
      'novelty_checked',
      'info',
      `Brief regenerated after a prior collision (${brief.themes.length} themes, ${brief.characters.length} characters, avoiding ${avoidTitles.length} prior title(s)).`
    );
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
  //
  // A block now clears BOTH this cache and brief_ready (clearBriefForRebrief)
  // before the run is retried, precisely so this cache is never asked to
  // answer for a brief that no longer exists -- see this function's header.
  // A `cached` block found here therefore only ever means that clearing write
  // failed (logged in clearBriefForRebrief) and this attempt is replaying it,
  // exactly as it would have before this feature existed.
  const cached = run.checkpoint[NOVELTY_VERDICT_CHECKPOINT_KEY] as CachedNoveltyVerdict | undefined;

  let verdict: string;
  let score: number;
  let adjudicated: boolean;
  let reason: string;
  // Only ever populated on a freshly-computed (non-cached) verdict -- see the
  // `cached` branch below. Drives the avoid-list and the collision name in
  // the block event; a cached-replay has neither available and degrades to
  // naming only the persona's own rejected title.
  let topCandidates: NoveltyTopCandidate[] = [];

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
    topCandidates = result.topCandidates;
    await persistNoveltyVerdict(run, { verdict, score, adjudicated, reason });
  }

  if (verdict === 'block') {
    // Legible to an unattended operator: which prior it collided with, and
    // whether this run will correct itself or is done trying. Short and
    // factual throughout, per this module's no-prose rule -- a title, a
    // count, never a model's reasoning verbatim.
    const collidingTitles = topCandidates.map((entry) => entry.title);
    const namedCollision = sanitizeNoveltyTitleForDisplay(collidingTitles[0]);
    const collisionNote = namedCollision ? ` Collided with "${namedCollision}".` : '';
    const willRetry = shouldRetry({ attemptCount: run.attemptCount, maxAttempts: run.maxAttempts });

    let outcomeNote: string;
    if (willRetry) {
      const cleared = await clearBriefForRebrief(run, brief.workingTitle, collidingTitles);
      outcomeNote = cleared
        ? ' Regenerating the brief before the next attempt.'
        : ' Could not clear the brief for a retry; the next attempt will replay this verdict.';
    } else {
      outcomeNote = ' No attempts remain; this run will fail.';
    }

    await appendRunEvent(
      run.id,
      'novelty_checked',
      'warn',
      `Novelty check blocked generation${cached ? ' (verdict decided on the first attempt)' : ''}: ${reason}${collisionNote}${outcomeNote}`
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
  // Resolved ONCE here and threaded into both buildSeedSourcePrompt (part 1)
  // and generateSeedPlanPreview (part 2) below -- never re-resolved from
  // persona inside either. A single source of truth for "how long should this
  // be" is the fix for the bug this replaced: a fixed SEED_SOURCE_WORD_CAP
  // fighting this same persona's own beat-length target.
  const baseConfig = resolvePersonaStoryConfig(persona);
  const beatLength = resolveStoryBeatLength(baseConfig.ageGroup, baseConfig.beatLength?.level);
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
      const prompt = buildSeedSourcePrompt(persona, brief, targetBeatCount, beatLength);
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
      const seedPlan = await generateSeedPlanPreview({
        storyConfig: baseConfig,
        sourceText: progress.sourceText!,
        beatCount: targetBeatCount,
        workingTitle: brief.workingTitle,
        sourceFidelity: AGENTIC_SOURCE_FIDELITY,
        costTelemetry: buildTelemetry(run, task, persona, 'story_generated:seed_plan'),
        // See SeedPlanPreviewInput.enforceSourceWordCap: the human-facing
        // 500-word cap has no business bounding this persona's own generated
        // prose. Length here is governed by beatLength (resolved above and
        // already threaded into buildSeedSourcePrompt's guidance), not a
        // fixed word ceiling.
        enforceSourceWordCap: false,
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

/**
 * What runDraftCreatedStage found for this persona's fixed narration voice
 * (D11), ready to write into both the session's narrator_voice-shaped fields
 * and storyConfig.narrationVoice so the two agree.
 */
interface AgentNarrationVoiceLock {
  voiceId: string;
  genderBucket: NarrationGenderBucket | null;
  languageCode: NarrationLanguageCode;
}

/**
 * Resolves the persona's fixed narration voice against the live voice lists,
 * or returns null when the persona has none configured.
 *
 * FAILS SOFT, NEVER FAILS THE DRAFT. This runs inside draft_created BEFORE
 * saveStoryForUser writes the story row -- there is no draft yet for D10's
 * "invisible to review" rule to apply to, but the same spirit does: a voice
 * problem here must not cost the draft its save. Any throw out of
 * getNarrationVoiceSettings() (a missing flag row, a transient read error)
 * degrades to "no voice locked" rather than propagating.
 *
 * Deliberately does NOT fall back to a default voice, either on this failure
 * path or when the persona simply has no preferredVoice set:
 * resolvePersonaVoice (persona-voice.shared.ts) is written so an unset voice
 * STAYS unset, and inventing one here would reintroduce exactly the bug D11
 * exists to close -- a model-chosen voice locking onto the story (and every
 * episode extended from it) forever. Leaving it null just reproduces today's
 * known-recoverable behavior: the legacy Gemini selector runs at first
 * narration, and a reviewer can set a voice and re-narrate.
 */
async function resolveAgentNarrationVoiceLock(persona: AgentPersona): Promise<AgentNarrationVoiceLock | null> {
  let maleVoiceList: string[];
  let femaleVoiceList: string[];
  try {
    const settings = await getNarrationVoiceSettings();
    maleVoiceList = settings.maleVoiceList;
    femaleVoiceList = settings.femaleVoiceList;
  } catch (error) {
    console.error(
      '[agentic-story-assembly] failed to load narration voice settings; leaving this draft with no locked voice:',
      error instanceof Error ? error.message : error
    );
    return null;
  }

  const resolved = resolvePersonaVoice(persona, { maleVoiceList, femaleVoiceList });
  if (!resolved) return null;

  const { languageCode } = resolveStoryNarrationLanguage(persona.language);
  return { voiceId: resolved.voiceId, genderBucket: resolved.genderBucket, languageCode };
}

function buildAgentStorySession(params: {
  run: AgentRun;
  task: AgentTask;
  persona: AgentPersona;
  brief: StoryBrief;
  storyConfig: StoryConfig;
  storyMap: StoryMap;
  characters: Character[];
  narrationVoiceLock: AgentNarrationVoiceLock | null;
}): StorySession {
  const { run, task, persona, brief, storyConfig, storyMap, characters, narrationVoiceLock } = params;

  // D11: a persona choosing its own fixed voice IS a deliberate selection, so
  // it locks in as 'user_selected' -- never 'legacy_auto'. That is what makes
  // the lock survive narration_user_led_voice_selection_enabled being
  // switched off later: resolveNarrationVoiceDecision
  // (lib/ai/narration-voice-resolver.ts) takes its user-selected branch
  // whenever the PERSISTED mode already reads 'user_selected', unconditionally
  // -- it never re-checks that global flag once a story's mode says so.
  const narrationVoiceSelection: StoryNarrationVoiceSelection | undefined = narrationVoiceLock
    ? {
        mode: 'user_selected',
        voiceId: narrationVoiceLock.voiceId,
        languageCode: narrationVoiceLock.languageCode,
        ...(narrationVoiceLock.genderBucket ? { genderBucket: narrationVoiceLock.genderBucket } : {}),
      }
    : undefined;

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
    // Keep storyConfig.narrationVoice and the four session fields below in
    // agreement -- one is the config a reader-facing picker would show back,
    // the other four are exactly what saveStoryForUser (lib/story/save-story.ts)
    // writes onto the stories row.
    storyConfig: narrationVoiceSelection ? { ...storyConfig, narrationVoice: narrationVoiceSelection } : storyConfig,
    storyMap,
    beats: Object.values(storyMap.nodes).map((node) => node.data),
    choiceHistory: [],
    openThreads: [],
    allowedEndings: [],
    safetyProfile: persona.ageGroup.startsWith('kids') ? 'children' : 'all_ages',
    // saveStoryForUser writes narrator_voice ONLY from session.narratorVoice --
    // unlike the other three narration columns, it deliberately does NOT fall
    // back to storyConfig.narrationVoice?.voiceId. Both must be set here or
    // the lock would silently not take.
    narratorVoice: narrationVoiceLock?.voiceId,
    narrationVoiceMode: narrationVoiceLock ? 'user_selected' : undefined,
    narrationVoiceGenderBucket: narrationVoiceLock?.genderBucket ?? undefined,
    narrationLanguageCode: narrationVoiceLock?.languageCode,
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

  // Locked regardless of persona.allowNarration. That flag gates PRODUCING
  // audio -- the reviewer's narrate button, per D10 -- not DECLARING which
  // voice a narration would use. A locked voice on a persona with
  // allowNarration === false generates nothing and costs nothing; leaving it
  // unlocked instead is what actually costs something, because a null
  // narrator_voice is exactly what makes resolveNarrationVoiceServer fall
  // through to the legacy Gemini selector at first narration -- the bug D11
  // exists to close. So this never reads allowNarration.
  const narrationVoiceLock = await resolveAgentNarrationVoiceLock(persona);

  const session = buildAgentStorySession({
    run, task, persona, brief, storyConfig, storyMap, characters: finalRoster, narrationVoiceLock,
  });

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

    // Reported AFTER the save, not before it. The voice is only actually
    // locked once saveStoryForUser has written stories.narrator_voice -- a
    // line saying "locked" in a timeline whose save then threw would assert
    // something that never happened, and the run timeline is the only window
    // an operator has into which voice a story ended up with.
    await appendRunEvent(
      run.id,
      'draft_created',
      'info',
      narrationVoiceLock
        ? `Narration voice locked from persona: ${narrationVoiceLock.voiceId}.`
        : 'No fixed narration voice on this persona; narration will fall back to automatic selection.'
    );

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
  // MEASURED FROM claimed_at, NOT FROM THE TOP OF THIS FUNCTION. Every other
  // timeBudgetExceeded() call site in this file (runStoryGeneratedStage) opens
  // with `Date.now()` and then checks the budget AFTER doing seconds of paid
  // generation, so a local origin is the right one there. This stage does no
  // such work before its check -- only a flag read and three short queries --
  // so a local origin would put roughly 200ms against a 20s budget and the
  // guard could never fire. The meaningful origin is when the worker claimed
  // this run: if draft_created already burned the pass's budget, this stage
  // starts already over it. A null claimed_at (an unclaimed run should never
  // reach an executor) falls back to "not exceeded" rather than silently
  // skipping the model call.
  const claimedAtMs = run.claimedAt ? Date.parse(run.claimedAt) : Number.NaN;
  const budgetOriginMs = Number.isFinite(claimedAtMs) ? claimedAtMs : Date.now();

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
  //
  // Wrapped, because getPipelineEvaluationForRun RETHROWS anything that is not
  // a schema-missing error (it only swallows the 108 latch cases). An executor
  // that throws is caught by advanceRun and routed straight into
  // handleStageFailure -- so one transient Postgres error on this read would
  // fail the run at 'evaluated' and strand the saved draft, which is precisely
  // the outcome this stage exists to make impossible. Losing the read degrades
  // to computing a fresh evaluation; if a row really did already exist, the
  // insert then trips the partial unique index and evaluateAndRecord records
  // that as persisted: false. A duplicate grade is not written, and the run
  // still advances.
  let existing: Awaited<ReturnType<typeof getPipelineEvaluationForRun>> = null;
  try {
    existing = await getPipelineEvaluationForRun(run.id);
  } catch (error) {
    await appendRunEvent(
      run.id,
      'evaluated',
      'warn',
      `Could not read this run's existing evaluation: ${error instanceof Error ? error.message : 'unknown error'}.`
    );
  }
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
    beats: toEvaluatedBeats(progress.completedBeats),
    targetBeatCount,
    ageGroup: persona.ageGroup,
    beatLengthLevel: resolvePersonaStoryConfig(persona).beatLength?.level,
    // The pipeline has no other fidelity mode -- every seeded run is built
    // with AGENTIC_SOURCE_FIDELITY (see buildSeededStoryConfig and the
    // generateSeedPlanPreview call above). Passing the shared constant here,
    // rather than re-deriving it from a storyConfig this stage does not
    // reconstruct, is what lets the evaluator's beat-length exemption stay
    // keyed to the generator's actual behavior instead of an assumption.
    sourceFidelity: AGENTIC_SOURCE_FIDELITY,
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
  const promptInput = timeBudgetExceeded(budgetOriginMs)
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
 *  - narration_pending / narration_complete: advance immediately. D10 made
 *    narration a reviewer action on the finished draft, not a pipeline stage
 *    -- these two stage names stay in STAGE_SEQUENCE but do no work here.
 *    Deferring here instead would return the run to 'pending' forever without
 *    consuming an attempt -- an infinite loop, not a safe wait -- which is
 *    still the reason to advance rather than defer, independent of D10.
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
      : 'Narration is a reviewer action on the finished draft, not a pipeline step; advancing without it.';
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
