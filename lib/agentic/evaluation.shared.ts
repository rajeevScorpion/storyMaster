// ── Agentic Creator: draft evaluation ───────────────────────────────────
//
// Pure and isomorphic, mirroring lib/agentic/memory.shared.ts's split: the
// server half (Unit 7b, lib/agentic/evaluation.ts) will call the grading
// model, persist agent_evaluations rows (migration 108) and wire this into
// the orchestrator's 'evaluated' stage; everything that decides what a
// finished draft's grade IS lives here, so it can be tested without a
// database or a model call. See 108_agent_evaluations.sql's header comment
// for the specification this module implements.
//
// THE ONE RULE THIS MODULE EXISTS TO ENFORCE: the model gets no vote on
// `verdict` or `review_readiness`, in EITHER direction.
//
// The precedent is commit 32f2c65: in the novelty check, a model may SOFTEN
// a deterministic verdict but never HARDEN one, because a 'block' there was
// terminal -- it failed a run outright -- and a too-harsh threshold would
// otherwise have killed a good story. That asymmetric rescue valve has a
// real cost if it is removed, which is why it exists there at all.
//
// Evaluation is different, and the difference is the point: an evaluation
// NEVER STOPS A RUN. By the time the 'evaluated' stage runs, the draft is
// already saved to `stories` -- the expensive part is paid for and the row
// exists. There is therefore no terminal consequence to be rescued from: an
// over-cautious verdict costs a reviewer one closer look, nothing more. So
// the model gets no vote at all here, not even a downgrade vote -- it
// contributes only `scores` (the six subjective dimensions no deterministic
// check can judge) and advisory warnings. When the model's own
// recommendation disagrees with the deterministic outcome, that disagreement
// is recorded as a `model_recommendation_not_applied` warning -- the audit
// trail shows what the model claimed and that it did not decide, exactly the
// way applyAdjudication pushes an "Adjudication not applied" line into
// `reasons` when a model tries and fails to escalate a novelty verdict.
//
// composeEvaluation() is therefore intentionally boring: `verdict` is always
// `deterministic.verdict` and `reviewReadiness` is always
// `deriveReviewReadiness(deterministic.verdict)`, full stop, regardless of
// what `model` contains or whether it was even called. No branch in this
// file may make either of those two lines conditional on `model`.

import type { AgeGroup, SourceFidelity, StoryBeat, StoryLanguage } from '@/lib/types/story';
import { countStoryWords, getStoryAudienceProfile, resolveStoryBeatLength } from '@/lib/ai/story-audience';

// ── Types ────────────────────────────────────────────────────────────────

export type EvaluationVerdict = 'pass' | 'concerns' | 'fail';
export type ReviewReadiness = 'ready_for_review' | 'needs_rewrite';
export type EvaluationWarningSeverity = 'info' | 'warn' | 'error';
export type EvaluationWarningSource = 'deterministic' | 'model';
export type EvaluationModelStatus = 'applied' | 'unavailable' | 'skipped';

export interface EvaluationWarning {
  code: string;
  severity: EvaluationWarningSeverity;
  /** Short factual line -- a count, a script name, a threshold. Never generated prose, never chain-of-thought. */
  message: string;
  source: EvaluationWarningSource;
}

export const EVALUATION_DIMENSIONS = [
  'coherence', 'ageFit', 'personaFidelity', 'pacing', 'learningValue', 'safety',
] as const;
export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number];
export type EvaluationScores = Partial<Record<EvaluationDimension, number>>;

/** Minimal per-beat shape -- deliberately NOT StoryBeat, so this module stays pure and cheap. */
export interface EvaluatedBeat {
  beatNumber: number;
  storyText: string;
  optionCount: number;
  isEnding: boolean;
}

/**
 * The one place StoryBeat[] becomes EvaluatedBeat[]. Extracted from
 * story-assembly.ts's runEvaluatedStage (the pipeline's real evaluation call)
 * so the Test Lab's evaluation preview (Unit 7d, test-lab.ts) can build the
 * identical shape from the same parked beats it already holds. If the two
 * ever drifted -- one dropping a field the other keeps, say -- the preview
 * would silently disagree with the real grade, which is the one outcome this
 * whole feature exists to prevent. `StoryBeat` is imported type-only, so this
 * module stays pure and isomorphic.
 */
export function toEvaluatedBeats(beats: StoryBeat[]): EvaluatedBeat[] {
  return beats.map((beat) => ({
    beatNumber: beat.beatNumber,
    storyText: beat.storyText,
    optionCount: beat.options.length,
    isEnding: beat.isEnding,
  }));
}

export interface DeterministicEvaluationInput {
  beats: EvaluatedBeat[];
  targetBeatCount: number;
  ageGroup: AgeGroup;
  /** Raw storyConfig.beatLength?.level; resolveStoryBeatLength normalizes it. */
  beatLengthLevel: unknown;
  /**
   * storyConfig.authoring.sourceFidelity. 'strictly_follow' means beat text is
   * source prose copied verbatim, so the beat-length bounds check below does
   * not apply to it -- see that check for why. null means fidelity is unknown
   * (e.g. a caller outside the agentic pipeline that has no such concept), in
   * which case the check runs as normal.
   */
  sourceFidelity: SourceFidelity | null;
  language: StoryLanguage;
  restrictedThemes: string[];
  briefThemes: string[];
  /** Post-generation novelty verdict carried from the draft_created checkpoint; null = not available. */
  noveltyVerdict: 'clear' | 'warn' | 'block' | null;
  noveltyReason: string | null;
}

export interface DeterministicEvaluationResult {
  verdict: EvaluationVerdict;
  warnings: EvaluationWarning[];
}

export interface EvaluationModelResult {
  scores: EvaluationScores;
  concerns: string[];
  recommendation: 'ready' | 'needs_attention' | 'needs_rewrite' | null;
}

export interface StoryEvaluation {
  verdict: EvaluationVerdict;
  reviewReadiness: ReviewReadiness;
  scores: EvaluationScores;
  warnings: EvaluationWarning[];
  modelStatus: EvaluationModelStatus;
}

export type StoryScript = 'latin' | 'devanagari' | 'bengali' | 'gujarati' | 'arabic';

export const EXPECTED_SCRIPT_BY_LANGUAGE: Record<StoryLanguage, StoryScript> = {
  english: 'latin',
  hindi: 'devanagari',
  marathi: 'devanagari',
  bangla: 'bengali',
  gujarati: 'gujarati',
  urdu: 'arabic',
};

// ── Script detection ───────────────────────────────────────────────────────

const SCRIPT_PATTERNS: Record<StoryScript, RegExp> = {
  latin: /[\u0041-\u005A\u0061-\u007A\u00C0-\u024F]/,
  devanagari: /[\u0900-\u097F]/,
  bengali: /[\u0980-\u09FF]/,
  gujarati: /[\u0A80-\u0AFF]/,
  // Presentation Forms-B stops at \uFEFC, the last Arabic form in the block --
  // NOT at \uFEFF, which is the block's final code point but is ZERO WIDTH
  // NO-BREAK SPACE (the BOM), not a letter. Including it would count a stray
  // BOM as one Arabic character in every text that carries one.
  arabic: /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFC]/,
};

/** Below this many total scripted characters, there is too little evidence to judge. */
const MIN_SCRIPTED_CHARS = 20;
/** A script must hold at least this share of scripted characters to count as dominant. */
const DOMINANT_SCRIPT_SHARE = 0.6;

/**
 * Counts characters per script, ignoring whitespace, digits and punctuation --
 * those simply match none of the five ranges above, so they fall out for
 * free without any explicit filtering step. Returns 'unknown' when there is
 * too little scripted text to judge (fewer than MIN_SCRIPTED_CHARS counted)
 * or when no single script clears DOMINANT_SCRIPT_SHARE of what was counted.
 *
 * That 60% floor, not 100%, is deliberate: it is what lets a Hindi story
 * carry Latin proper nouns and numerals without being flagged as English.
 */
export function detectDominantScript(text: string): StoryScript | 'unknown' {
  const counts: Record<StoryScript, number> = { latin: 0, devanagari: 0, bengali: 0, gujarati: 0, arabic: 0 };
  let total = 0;

  for (const char of text) {
    for (const script of Object.keys(counts) as StoryScript[]) {
      if (SCRIPT_PATTERNS[script].test(char)) {
        counts[script] += 1;
        total += 1;
        break; // The five ranges are disjoint -- a character belongs to at most one.
      }
    }
  }

  if (total < MIN_SCRIPTED_CHARS) return 'unknown';

  let topScript: StoryScript | null = null;
  let topCount = 0;
  for (const script of Object.keys(counts) as StoryScript[]) {
    if (counts[script] > topCount) {
      topCount = counts[script];
      topScript = script;
    }
  }

  return topScript && topCount / total >= DOMINANT_SCRIPT_SHARE ? topScript : 'unknown';
}

// ── Deterministic evaluation ────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Runs every deterministic check against a finished draft. This is the ONLY
 * function that decides `verdict` -- see the module header. Emits at most
 * one warning per code; `message` is always a short factual line (a count, a
 * script name, a threshold), never story text or generated prose.
 */
export function runDeterministicEvaluation(input: DeterministicEvaluationInput): DeterministicEvaluationResult {
  const { beats, targetBeatCount, ageGroup, beatLengthLevel, sourceFidelity, language, restrictedThemes, briefThemes, noveltyVerdict, noveltyReason } = input;
  const warnings: EvaluationWarning[] = [];
  const push = (code: string, severity: EvaluationWarningSeverity, message: string) =>
    warnings.push({ code, severity, message, source: 'deterministic' });

  if (beats.length < targetBeatCount) {
    push('beat_count_short', 'error', `Beat count ${beats.length} is short of the target ${targetBeatCount}.`);
  } else if (beats.length > targetBeatCount) {
    push('beat_count_over', 'warn', `Beat count ${beats.length} exceeds the target ${targetBeatCount}.`);
  }

  // Written as the spec states it -- "the last beat is not isEnding, or no
  // beat is" -- rather than collapsed to the (equivalent) shorter check, so a
  // future change to either half of the rule can't silently drop the other.
  const lastBeat = beats[beats.length - 1];
  const hasEndingBeat = beats.some((beat) => beat.isEnding);
  if (!lastBeat || !lastBeat.isEnding || !hasEndingBeat) {
    push('ending_missing', 'error', 'The story does not end on a beat marked as an ending.');
  }

  const endingsWithOptions = beats.filter((beat) => beat.isEnding && beat.optionCount > 0).map((beat) => beat.beatNumber);
  if (endingsWithOptions.length > 0) {
    push('ending_has_options', 'error', `Ending beat(s) ${endingsWithOptions.join(', ')} still carry options.`);
  }

  const audienceProfile = getStoryAudienceProfile(ageGroup);
  const offOptionCountBeats = beats
    .filter((beat) => !beat.isEnding)
    .filter((beat) =>
      audienceProfile.optionCount === 'exactly_3'
        ? beat.optionCount !== 3
        : beat.optionCount !== 3 && beat.optionCount !== 4
    )
    .map((beat) => beat.beatNumber);
  if (offOptionCountBeats.length > 0) {
    const expected = audienceProfile.optionCount === 'exactly_3' ? '3' : '3 or 4';
    push('option_count_off', 'warn', `Beat(s) ${offOptionCountBeats.join(', ')} do not have ${expected} options.`);
  }

  // Under 'strictly_follow', beat storyText is the author's source prose
  // copied verbatim -- lib/ai/seed-authoring.ts splices strictSourceSegments
  // straight into the plan's storyText and its own validatePlan deliberately
  // skips this same word-count check in that mode, because there is nothing
  // to validate: the words are the author's, not a model's, to fit a band.
  // Re-litigating that decision here would grade every strictly-followed
  // source against a target it was never asked to hit -- on the first real
  // run this fired on all 8 beats and pushed the verdict from pass to
  // concerns, which would make 'concerns' the permanent verdict for
  // essentially every agentic story. So this check is skipped in that mode,
  // and an 'info' warning is emitted instead of going silent, so the panel
  // still records why the check did not run -- the same shape as
  // language_script_unverified below: 'info' does not move the verdict.
  //
  // This compares against the LITERAL 'strictly_follow', deliberately, and
  // NOT against story-assembly.shared.ts's AGENTIC_SOURCE_FIDELITY. The
  // exemption belongs to the fidelity mode, not to whichever mode the agentic
  // pipeline currently picks: it is justified only because seed-authoring.ts
  // keys its verbatim splice and its own skipped validation to this same
  // literal (:95). Were this pinned to the pipeline's constant instead, then
  // changing that constant to, say, 'creative_expansion' -- where beats ARE
  // model-authored and the band DOES apply -- would silently switch this
  // check off at exactly the moment it became meaningful. The generator
  // moving must never disable a grader's check by side effect.
  if (sourceFidelity === 'strictly_follow') {
    push(
      'beat_length_unenforced',
      'info',
      'Beat length was not checked: beat text is verbatim source prose under strict source fidelity, so the word band does not apply.'
    );
  } else {
    const beatLength = resolveStoryBeatLength(ageGroup, beatLengthLevel);
    const outOfBoundsBeats = beats
      .filter((beat) => {
        const words = countStoryWords(beat.storyText);
        return words < beatLength.hardMinWords || words > beatLength.hardMaxWords;
      })
      .map((beat) => beat.beatNumber);
    if (outOfBoundsBeats.length > 0) {
      push(
        'beat_length_out_of_bounds',
        'warn',
        `Beat(s) ${outOfBoundsBeats.join(', ')} fall outside ${beatLength.hardMinWords}-${beatLength.hardMaxWords} words.`
      );
    }
  }

  const joinedStoryText = beats.map((beat) => beat.storyText).join(' ');
  const detectedScript = detectDominantScript(joinedStoryText);
  const expectedScript = EXPECTED_SCRIPT_BY_LANGUAGE[language];
  if (detectedScript === 'unknown') {
    push('language_script_unverified', 'info', 'Too little scripted text to verify the language script.');
  } else if (detectedScript !== expectedScript) {
    push(
      'language_script_mismatch',
      'error',
      `Detected script '${detectedScript}' does not match '${expectedScript}' expected for language '${language}'.`
    );
  }

  // Word-boundary, case-insensitive matching so "war" cannot match inside
  // "warm" or "toward" -- \b only holds at a transition into/out of a \w
  // character, and the letters either side of "war" in both words are \w.
  //
  // KNOWN LIMIT, verified against the seeded personas rather than assumed:
  // all 15 seeds carry their restricted_themes as ENGLISH phrases ("graphic
  // violence", "self-harm"), including the 12 whose stories are written in
  // Hindi, Bangla, Gujarati or Marathi. JS \b is defined over \w
  // ([A-Za-z0-9_]), so it never holds beside a Devanagari/Bengali/Gujarati/
  // Arabic character -- and the English phrase would not appear in that prose
  // anyway. So the beat-text half of this check is effectively English-only.
  // The briefThemes half works for every persona, because buildStoryBriefPrompt
  // asks for themes "in English" while the title, premise and prose go in the
  // target language.
  //
  // This fails OPEN (a missed restriction, never a false one) and the model's
  // `safety` dimension covers the same ground advisorily, so it is a gap in
  // coverage, not a wrong answer. Closing it properly needs script-aware
  // boundaries plus translated restriction vocabularies -- recorded as
  // deferred work in PROJECT_STATE.md rather than half-done here.
  const matchedThemes = new Set<string>();
  for (const theme of restrictedThemes) {
    const trimmed = theme.trim();
    if (!trimmed) continue;
    const matcher = new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'iu');
    const inBriefThemes = briefThemes.some((briefTheme) => matcher.test(briefTheme));
    const inBeatText = beats.some((beat) => matcher.test(beat.storyText));
    if (inBriefThemes || inBeatText) matchedThemes.add(trimmed);
  }
  if (matchedThemes.size > 0) {
    push('restricted_theme_present', 'error', `Restricted theme(s) present: ${[...matchedThemes].join(', ')}.`);
  }

  if (noveltyVerdict === null) {
    push('novelty_unavailable', 'info', 'No post-generation novelty verdict was available.');
  } else if (noveltyVerdict === 'warn' || noveltyVerdict === 'block') {
    const reason = (noveltyReason ?? 'No reason recorded.').slice(0, 240);
    push('novelty_flagged', noveltyVerdict === 'block' ? 'error' : 'warn', `Novelty check ${noveltyVerdict}: ${reason}`);
  }

  const verdict: EvaluationVerdict = warnings.some((warning) => warning.severity === 'error')
    ? 'fail'
    : warnings.some((warning) => warning.severity === 'warn')
      ? 'concerns'
      : 'pass';

  return { verdict, warnings };
}

/**
 * The sole place `verdict` becomes `review_readiness`. Stored, not
 * recomputed, per 108_agent_evaluations.sql's header comment -- every reader
 * (Phase 9's reviewer queue, the Run monitor, any later surface) must agree,
 * so the mapping lives in exactly one function and is unit-tested here.
 */
export function deriveReviewReadiness(verdict: EvaluationVerdict): ReviewReadiness {
  return verdict === 'fail' ? 'needs_rewrite' : 'ready_for_review';
}

// ── Composition ──────────────────────────────────────────────────────────

/**
 * Combines the deterministic result with the model's advisory opinion.
 * `verdict` and `reviewReadiness` are ALWAYS the deterministic layer's -- see
 * the module header for why that is not a judgement call left to a branch
 * here. `model` can only ever add advisory warnings on top.
 */
export function composeEvaluation(params: {
  deterministic: DeterministicEvaluationResult;
  model: EvaluationModelResult | null;
  modelCalled: boolean;
}): StoryEvaluation {
  const { deterministic, model, modelCalled } = params;
  const verdict = deterministic.verdict;
  const reviewReadiness = deriveReviewReadiness(verdict);

  if (!modelCalled) {
    return { verdict, reviewReadiness, scores: {}, warnings: deterministic.warnings, modelStatus: 'skipped' };
  }

  if (!model) {
    const warnings: EvaluationWarning[] = [
      ...deterministic.warnings,
      {
        code: 'model_unavailable',
        severity: 'info',
        source: 'model',
        message: 'Model evaluation was requested but produced no usable result.',
      },
    ];
    return { verdict, reviewReadiness, scores: {}, warnings, modelStatus: 'unavailable' };
  }

  const modelWarnings: EvaluationWarning[] = model.concerns.map((concern) => ({
    code: 'model_concern',
    severity: 'info',
    source: 'model',
    message: concern,
  }));

  if (model.recommendation) {
    // 'ready' and 'needs_attention' both map to ready_for_review -- neither
    // one is treated as a rewrite request, only 'needs_rewrite' is.
    const modelReadiness: ReviewReadiness = model.recommendation === 'needs_rewrite' ? 'needs_rewrite' : 'ready_for_review';
    if (modelReadiness !== reviewReadiness) {
      modelWarnings.push({
        code: 'model_recommendation_not_applied',
        severity: 'info',
        source: 'model',
        message: `Model recommended '${model.recommendation}' (readiness '${modelReadiness}'); deterministic layer decided '${reviewReadiness}'.`,
      });
    }
  }

  return {
    verdict,
    reviewReadiness,
    scores: model.scores,
    warnings: [...deterministic.warnings, ...modelWarnings],
    modelStatus: 'applied',
  };
}

// ── Model result parsing ─────────────────────────────────────────────────

/**
 * Strips a ```json fence if the model wrapped its response in one.
 *
 * DELIBERATELY STRICTER THAN THE NEIGHBOURING PARSERS, not consistent with
 * them. parseStoryBrief (story-assembly.ts) and the novelty adjudicator's
 * parser both hand `raw` straight to JSON.parse and let a fenced response
 * throw, relying entirely on the prompt's "no markdown fences" instruction.
 * That is defensible where a throw fails a stage that will be retried. It is
 * not defensible here: a fenced response would be scored as
 * modelStatus 'unavailable', silently discarding a grade the model actually
 * produced, and nothing downstream would ever retry it -- the run advances
 * either way. Stripping the fence costs one regex and removes that whole
 * failure mode.
 */
function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : trimmed;
}

/**
 * Parses the grading model's JSON response. The model wrote `raw`; every
 * field is treated as hostile, mirroring
 * lib/agentic/supervisor.shared.ts's validateCommissionProposals. Never
 * throws -- returns null when the response is not usable, and the caller
 * records that honestly as modelStatus: 'unavailable' (via
 * composeEvaluation's modelCalled=true/model=null branch) rather than
 * crashing the evaluation or letting garbage scores through.
 */
export function parseEvaluationModelResult(raw: string): EvaluationModelResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownFences(raw));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;

  const scores: EvaluationScores = {};
  if (record.scores && typeof record.scores === 'object' && !Array.isArray(record.scores)) {
    const rawScores = record.scores as Record<string, unknown>;
    for (const dimension of EVALUATION_DIMENSIONS) {
      const value = rawScores[dimension];
      if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5) {
        scores[dimension] = value;
      }
    }
  }

  const concerns = Array.isArray(record.concerns)
    ? record.concerns
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim().slice(0, 240))
        .filter((entry) => entry.length > 0)
        .slice(0, 5)
    : [];

  const recommendation: EvaluationModelResult['recommendation'] =
    record.recommendation === 'ready' || record.recommendation === 'needs_attention' || record.recommendation === 'needs_rewrite'
      ? record.recommendation
      : null;

  // A result with zero valid scores is still valid on its own -- the caller
  // records modelStatus: 'applied' with an empty score set -- but a result
  // with NOTHING usable at all (no scores, no recommendation, no concerns) is
  // indistinguishable from a garbage response and is rejected outright.
  if (Object.keys(scores).length === 0 && recommendation === null && concerns.length === 0) return null;

  return { scores, concerns, recommendation };
}

// ── Prompt ───────────────────────────────────────────────────────────────

/** Each beat's text is capped at this many characters in the grading prompt. */
const PROMPT_BEAT_TEXT_CAP = 600;

/**
 * Prompt for the grading call. Follows the shape of
 * buildNoveltyAdjudicationPrompt in memory.shared.ts: assembled in code, not
 * an admin-editable template. Explicitly tells the model its answer is
 * advisory, since the module header's whole point is that the model has no
 * vote on the outcome.
 */
export function buildStoryEvaluationPrompt(params: {
  personaDisplayName: string;
  personaPrompt: string;
  language: StoryLanguage;
  ageGroup: AgeGroup;
  genre: string | null;
  workingTitle: string;
  premise: string;
  beats: EvaluatedBeat[];
}): string {
  const beatLines = params.beats
    .map((beat) => `${beat.beatNumber}${beat.isEnding ? ' (ending)' : ''}: ${beat.storyText.slice(0, PROMPT_BEAT_TEXT_CAP)}`)
    .join('\n\n');

  return [
    `You are grading a finished draft written by ${params.personaDisplayName}, a story-writing persona on the Kissago platform.`,
    params.personaPrompt,
    '',
    `Language: ${params.language}. Audience: ${params.ageGroup}.${params.genre ? ` Genre: ${params.genre}.` : ''}`,
    `Working title: ${params.workingTitle}`,
    `Premise: ${params.premise}`,
    '',
    'Beats, in order:',
    beatLines,
    '',
    'Score six dimensions, each an integer from 1 (poor) to 5 (excellent):',
    '- coherence: does the plot hang together across beats?',
    '- ageFit: is the content and tone appropriate for the stated audience?',
    "- personaFidelity: does the writing match this persona's voice?",
    '- pacing: does each beat move the story forward without dragging or rushing?',
    '- learningValue: does the story offer age-appropriate value beyond entertainment?',
    '- safety: is the content free of anything genuinely unsafe for the audience?',
    '',
    'List any concrete concerns (short, factual, at most 5) and give one overall recommendation.',
    '',
    'This grading is advisory only -- a deterministic check, not you, decides whether this draft is ready for review or needs a rewrite.',
    '',
    'Respond with JSON only, no prose outside it, no markdown fences:',
    '{"scores":{"coherence":number,"ageFit":number,"personaFidelity":number,"pacing":number,"learningValue":number,"safety":number},"concerns":string[],"recommendation":"ready|needs_attention|needs_rewrite"}',
  ].join('\n');
}

// ── Schema-availability latch classifier ─────────────────────────────────

/**
 * True when a Postgres/PostgREST error means "migration 108 hasn't run on
 * this database yet", as opposed to any other failure that should surface as
 * a real error. Codes only, deliberately -- see isMissingMemorySchemaError in
 * memory.shared.ts for the defect this guards against: a bare message match
 * on the table name would also catch a real constraint violation (e.g. the
 * verdict/review_readiness/model_status CHECK constraints on
 * agent_evaluations) and misreport it as an unapplied migration.
 *
 * This is a latch for migration 108 ALONE. Per GOTCHAS.md ("Column-
 * availability latches are per migration group"), isMissingRunSchemaError
 * (107), isMissingTaskSchemaError (106) and isMissingMemorySchemaError (105)
 * are code-identical to this one and must never be substituted for it: they
 * are told apart only by which table the failing query touched, never by the
 * error itself, so "try another migration's classifier" always matches the
 * first one you check and misattributes the cause. Classify by the query,
 * not by the error.
 */
export function isMissingEvaluationSchemaError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||    // undefined_table: agent_evaluations absent
    error.code === '42703' ||    // undefined_column
    error.code === 'PGRST200' || // PostgREST: relationship not found in schema cache
    error.code === 'PGRST204'    // PostgREST: column not found in schema cache
  );
}
