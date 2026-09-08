import { describe, expect, it } from 'vitest';
import {
  EVALUATION_DIMENSIONS,
  EXPECTED_SCRIPT_BY_LANGUAGE,
  buildStoryEvaluationPrompt,
  composeEvaluation,
  deriveReviewReadiness,
  detectDominantScript,
  isMissingEvaluationSchemaError,
  parseEvaluationModelResult,
  runDeterministicEvaluation,
  type DeterministicEvaluationInput,
  type DeterministicEvaluationResult,
  type EvaluatedBeat,
  type EvaluationModelResult,
  type EvaluationVerdict,
} from './evaluation.shared';
import { AGENTIC_SOURCE_FIDELITY } from './story-assembly.shared';

// ── Fixture text ───────────────────────────────────────────────────────
// Word counts were verified against countStoryWords (Intl.Segmenter) before
// being pinned here, not guessed -- resolveStoryBeatLength('kids_8_12', 3)
// yields hardMinWords=56, hardMaxWords=120 (the audience's own [level 1,
// level 5] targets), and every "clean" fixture below sits inside that band
// on purpose so beat_length_out_of_bounds never fires as an accidental
// side effect of an unrelated test.

/** 68 words -- inside the kids_8_12/level-3 band [56, 120]. */
const CLEAN_BEAT_TEXT =
  'Meera crept along the flooded lane with her lantern held high, listening for the tide beneath the old stone steps while the harbour bell rang faintly through drifting mist and steady rain. She counted every doorway, remembering which ones still opened, and pressed onward toward the customs house with careful, deliberate resolve, certain that Uncle Bashir would already be waiting there with dry matches and a warm blanket.';

/** 61 words -- also inside the band, used for the closing beat. */
const ENDING_BEAT_TEXT =
  'At last Meera reached the customs house, pushed open the heavy door, and found Uncle Bashir waiting with a lantern of his own, the storm finally quiet behind them both as the harbour settled into an easy, forgiving calm, and for the first time all night she let herself believe that everyone she loved was safe and warm and accounted for.';

/** 3 words -- deliberately far short of the 56-word floor. */
const SHORT_BEAT_TEXT = 'Meera ran fast.';

/** 64 words, containing "warm" and "toward" but never "war" as its own word. */
const WARM_NOT_WAR_TEXT =
  'The morning felt warm and calm as Meera walked slowly toward the harbour, thinking about everything that had happened the night before and how relieved she finally felt now that it was over and everyone she loved was safe and sound, and she smiled quietly to herself as the gulls circled overhead in the pale, gentle light, glad the long night had finally ended.';

/** 57 words, containing "war" as its own word. */
const WAR_TEXT =
  'The morning felt calm as Meera walked slowly toward the harbour, but the old sailors still spoke quietly of the war that had once tried to claim these quiet shores, and everyone listened closely to their careful, measured words, remembering just how much had been lost before peace finally returned to the weary little town at last.';

/** All-digit text: word-like per Intl.Segmenter, but zero characters in any of the five script ranges. */
const NUMERIC_TEXT_70_WORDS = Array.from({ length: 70 }, (_unused, index) => index + 1).join(' ');
const NUMERIC_TEXT_61_WORDS = Array.from({ length: 61 }, (_unused, index) => index + 100).join(' ');

function beat(overrides: Partial<EvaluatedBeat> = {}): EvaluatedBeat {
  return {
    beatNumber: 1,
    storyText: CLEAN_BEAT_TEXT,
    optionCount: 3,
    isEnding: false,
    ...overrides,
  };
}

function cleanBeats(): EvaluatedBeat[] {
  return [
    beat({ beatNumber: 1, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
    beat({ beatNumber: 2, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
    beat({ beatNumber: 3, storyText: ENDING_BEAT_TEXT, optionCount: 0, isEnding: true }),
  ];
}

function cleanInput(overrides: Partial<DeterministicEvaluationInput> = {}): DeterministicEvaluationInput {
  return {
    beats: cleanBeats(),
    targetBeatCount: 3,
    ageGroup: 'kids_8_12',
    beatLengthLevel: 3,
    sourceFidelity: null,
    language: 'english',
    restrictedThemes: [],
    briefThemes: [],
    noveltyVerdict: 'clear',
    noveltyReason: null,
    ...overrides,
  };
}

function codesOf(result: DeterministicEvaluationResult): string[] {
  return result.warnings.map((warning) => warning.code);
}

// ── runDeterministicEvaluation ──────────────────────────────────────────

describe('runDeterministicEvaluation — a clean draft', () => {
  it('produces pass with zero warnings', () => {
    const result = runDeterministicEvaluation(cleanInput());
    expect(result.verdict).toBe('pass');
    expect(result.warnings).toEqual([]);
  });
});

describe('runDeterministicEvaluation — one test per deterministic check code', () => {
  it('beat_count_short: fewer beats than the target -> error, fail', () => {
    const result = runDeterministicEvaluation(cleanInput({ targetBeatCount: 4 }));
    expect(codesOf(result)).toContain('beat_count_short');
    expect(result.warnings.find((w) => w.code === 'beat_count_short')?.severity).toBe('error');
    expect(result.verdict).toBe('fail');
  });

  it('beat_count_over: more beats than the target -> warn, concerns', () => {
    const result = runDeterministicEvaluation(cleanInput({ targetBeatCount: 2 }));
    expect(codesOf(result)).toContain('beat_count_over');
    expect(result.warnings.find((w) => w.code === 'beat_count_over')?.severity).toBe('warn');
    expect(result.verdict).toBe('concerns');
  });

  it('ending_missing: no beat is marked isEnding -> error, fail', () => {
    const beats: EvaluatedBeat[] = [
      beat({ beatNumber: 1, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 2, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 3, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
    ];
    const result = runDeterministicEvaluation(cleanInput({ beats }));
    expect(codesOf(result)).toContain('ending_missing');
    expect(result.verdict).toBe('fail');
  });

  it('ending_missing: the last beat is not the ending, even though an earlier one is', () => {
    const beats: EvaluatedBeat[] = [
      beat({ beatNumber: 1, storyText: ENDING_BEAT_TEXT, optionCount: 0, isEnding: true }),
      beat({ beatNumber: 2, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
    ];
    const result = runDeterministicEvaluation(cleanInput({ beats, targetBeatCount: 2 }));
    expect(codesOf(result)).toContain('ending_missing');
    expect(result.verdict).toBe('fail');
  });

  it('ending_has_options: the ending beat still carries options -> error, fail', () => {
    const beats: EvaluatedBeat[] = [
      beat({ beatNumber: 1, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 2, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 3, storyText: ENDING_BEAT_TEXT, optionCount: 2, isEnding: true }),
    ];
    const result = runDeterministicEvaluation(cleanInput({ beats }));
    expect(codesOf(result)).toContain('ending_has_options');
    expect(result.warnings.find((w) => w.code === 'ending_has_options')?.message).toContain('3');
    expect(result.verdict).toBe('fail');
    // The ending beat is excluded from option_count_off, so it must not also fire.
    expect(codesOf(result)).not.toContain('option_count_off');
  });

  it("option_count_off (exactly_3 profile): a non-ending beat's option count is not 3 -> warn, concerns", () => {
    const beats: EvaluatedBeat[] = [
      beat({ beatNumber: 1, storyText: CLEAN_BEAT_TEXT, optionCount: 2, isEnding: false }),
      beat({ beatNumber: 2, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 3, storyText: ENDING_BEAT_TEXT, optionCount: 0, isEnding: true }),
    ];
    const result = runDeterministicEvaluation(cleanInput({ beats }));
    expect(codesOf(result)).toContain('option_count_off');
    expect(result.warnings.find((w) => w.code === 'option_count_off')?.message).toContain('1');
    expect(result.verdict).toBe('concerns');
  });

  it('option_count_off (3_or_4 profile): 4 options is fine, 2 is not', () => {
    const beats: EvaluatedBeat[] = [
      beat({ beatNumber: 1, storyText: CLEAN_BEAT_TEXT, optionCount: 2, isEnding: false }),
      beat({ beatNumber: 2, storyText: CLEAN_BEAT_TEXT, optionCount: 4, isEnding: false }),
      beat({ beatNumber: 3, storyText: CLEAN_BEAT_TEXT, optionCount: 0, isEnding: true }),
    ];
    const result = runDeterministicEvaluation(cleanInput({ beats, ageGroup: 'teens' }));
    const warning = result.warnings.find((w) => w.code === 'option_count_off');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('1');
    expect(warning?.message).not.toContain('2,'); // beat 2 (four options) must not be listed
    expect(result.verdict).toBe('concerns');
  });

  it('beat_length_out_of_bounds: a beat far under the hard minimum -> warn, concerns', () => {
    const beats: EvaluatedBeat[] = [
      beat({ beatNumber: 1, storyText: SHORT_BEAT_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 2, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 3, storyText: ENDING_BEAT_TEXT, optionCount: 0, isEnding: true }),
    ];
    const result = runDeterministicEvaluation(cleanInput({ beats }));
    expect(codesOf(result)).toContain('beat_length_out_of_bounds');
    expect(result.warnings.find((w) => w.code === 'beat_length_out_of_bounds')?.message).toContain('56');
    expect(result.verdict).toBe('concerns');
  });

  // The agentic pipeline always generates under AGENTIC_SOURCE_FIDELITY
  // ('strictly_follow'), where beat storyText is source prose copied
  // verbatim (see lib/ai/seed-authoring.ts) and the generation layer
  // deliberately does not enforce a word band on it. On the first real run
  // this beat-length check fired on all 8 beats and pushed the verdict from
  // pass to concerns -- these two tests are the fix: the exemption must
  // apply when fidelity is strict, and must NOT apply otherwise.
  describe('beat_length_out_of_bounds is exempted under strict source fidelity', () => {
    const beatsFarUnderBand: EvaluatedBeat[] = [
      beat({ beatNumber: 1, storyText: SHORT_BEAT_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 2, storyText: SHORT_BEAT_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 3, storyText: SHORT_BEAT_TEXT, optionCount: 0, isEnding: true }),
    ];

    it("sourceFidelity 'strictly_follow': no beat_length_out_of_bounds, an info beat_length_unenforced instead, and the verdict stays pass", () => {
      const result = runDeterministicEvaluation(
        cleanInput({ beats: beatsFarUnderBand, sourceFidelity: AGENTIC_SOURCE_FIDELITY })
      );
      expect(codesOf(result)).not.toContain('beat_length_out_of_bounds');
      expect(codesOf(result)).toContain('beat_length_unenforced');
      expect(result.warnings.find((w) => w.code === 'beat_length_unenforced')?.severity).toBe('info');
      expect(result.verdict).toBe('pass');
    });

    it('sourceFidelity null: the same beats still fail the bounds check -> warn, concerns', () => {
      const result = runDeterministicEvaluation(cleanInput({ beats: beatsFarUnderBand, sourceFidelity: null }));
      expect(codesOf(result)).toContain('beat_length_out_of_bounds');
      expect(codesOf(result)).not.toContain('beat_length_unenforced');
      expect(result.warnings.find((w) => w.code === 'beat_length_out_of_bounds')?.severity).toBe('warn');
      expect(result.verdict).toBe('concerns');
    });
  });

  it('language_script_mismatch: English prose under language "hindi" -> error, fail', () => {
    const result = runDeterministicEvaluation(cleanInput({ language: 'hindi' }));
    expect(codesOf(result)).toContain('language_script_mismatch');
    expect(result.warnings.find((w) => w.code === 'language_script_mismatch')?.severity).toBe('error');
    expect(result.verdict).toBe('fail');
  });

  it('language_script_unverified: too little scripted text to judge -> info, pass', () => {
    const beats: EvaluatedBeat[] = [
      beat({ beatNumber: 1, storyText: NUMERIC_TEXT_70_WORDS, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 2, storyText: NUMERIC_TEXT_70_WORDS, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 3, storyText: NUMERIC_TEXT_61_WORDS, optionCount: 0, isEnding: true }),
    ];
    const result = runDeterministicEvaluation(cleanInput({ beats }));
    expect(codesOf(result)).toContain('language_script_unverified');
    expect(result.warnings.find((w) => w.code === 'language_script_unverified')?.severity).toBe('info');
    expect(result.verdict).toBe('pass');
  });

  it('restricted_theme_present: a restricted theme appears as a whole word -> error, fail', () => {
    const beats: EvaluatedBeat[] = [
      beat({ beatNumber: 1, storyText: WAR_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 2, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 3, storyText: ENDING_BEAT_TEXT, optionCount: 0, isEnding: true }),
    ];
    const result = runDeterministicEvaluation(cleanInput({ beats, restrictedThemes: ['war'] }));
    expect(codesOf(result)).toContain('restricted_theme_present');
    expect(result.warnings.find((w) => w.code === 'restricted_theme_present')?.message).toContain('war');
    expect(result.verdict).toBe('fail');
  });

  it('restricted_theme_present: also fires on a match inside briefThemes', () => {
    const result = runDeterministicEvaluation(cleanInput({ restrictedThemes: ['honesty'], briefThemes: ['honesty', 'courage'] }));
    expect(codesOf(result)).toContain('restricted_theme_present');
    expect(result.verdict).toBe('fail');
  });

  it('does NOT fire restricted_theme_present on "war" inside "warm" or "toward"', () => {
    const beats: EvaluatedBeat[] = [
      beat({ beatNumber: 1, storyText: WARM_NOT_WAR_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 2, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false }),
      beat({ beatNumber: 3, storyText: ENDING_BEAT_TEXT, optionCount: 0, isEnding: true }),
    ];
    const result = runDeterministicEvaluation(cleanInput({ beats, restrictedThemes: ['war'] }));
    expect(codesOf(result)).not.toContain('restricted_theme_present');
    expect(result.verdict).toBe('pass');
  });

  it("novelty_flagged: verdict 'warn' -> warn, concerns, and includes the reason", () => {
    const result = runDeterministicEvaluation(
      cleanInput({ noveltyVerdict: 'warn', noveltyReason: 'Premise overlaps an existing story by 40%.' })
    );
    const warning = result.warnings.find((w) => w.code === 'novelty_flagged');
    expect(warning?.severity).toBe('warn');
    expect(warning?.message).toContain('Premise overlaps');
    expect(result.verdict).toBe('concerns');
  });

  it("novelty_flagged: verdict 'block' -> error, fail, and truncates a long reason to 240 chars", () => {
    const longReason = 'x'.repeat(400);
    const result = runDeterministicEvaluation(cleanInput({ noveltyVerdict: 'block', noveltyReason: longReason }));
    const warning = result.warnings.find((w) => w.code === 'novelty_flagged');
    expect(warning?.severity).toBe('error');
    expect(warning?.message.length).toBeLessThanOrEqual(240 + 'Novelty check block: '.length);
    expect(warning?.message.includes('x'.repeat(240))).toBe(true);
    expect(warning?.message.includes('x'.repeat(241))).toBe(false);
    expect(result.verdict).toBe('fail');
  });

  it('novelty_unavailable: no verdict was carried forward -> info, pass', () => {
    const result = runDeterministicEvaluation(cleanInput({ noveltyVerdict: null, noveltyReason: null }));
    expect(codesOf(result)).toContain('novelty_unavailable');
    expect(result.warnings.find((w) => w.code === 'novelty_unavailable')?.severity).toBe('info');
    expect(result.verdict).toBe('pass');
  });

  it("a 'clear' novelty verdict triggers neither novelty_flagged nor novelty_unavailable", () => {
    const result = runDeterministicEvaluation(cleanInput({ noveltyVerdict: 'clear', noveltyReason: null }));
    expect(codesOf(result)).not.toContain('novelty_flagged');
    expect(codesOf(result)).not.toContain('novelty_unavailable');
  });
});

// ── deriveReviewReadiness ────────────────────────────────────────────────

describe('deriveReviewReadiness', () => {
  it('maps fail to needs_rewrite, and pass/concerns to ready_for_review', () => {
    expect(deriveReviewReadiness('fail')).toBe('needs_rewrite');
    expect(deriveReviewReadiness('pass')).toBe('ready_for_review');
    expect(deriveReviewReadiness('concerns')).toBe('ready_for_review');
  });
});

// ── composeEvaluation ──────────────────────────────────────────────────────

const ALL_VERDICTS: EvaluationVerdict[] = ['pass', 'concerns', 'fail'];
const ALL_RECOMMENDATIONS: Array<EvaluationModelResult['recommendation']> = ['ready', 'needs_attention', 'needs_rewrite', null];

describe('composeEvaluation — the model gets no vote on verdict or reviewReadiness, in either direction', () => {
  for (const verdict of ALL_VERDICTS) {
    const deterministic: DeterministicEvaluationResult = { verdict, warnings: [] };
    const expectedReadiness = deriveReviewReadiness(verdict);

    it(`verdict=${verdict}, modelCalled=false: verdict/readiness pass through unchanged`, () => {
      const result = composeEvaluation({ deterministic, model: null, modelCalled: false });
      expect(result.verdict).toBe(verdict);
      expect(result.reviewReadiness).toBe(expectedReadiness);
    });

    it(`verdict=${verdict}, modelCalled=true, model=null: verdict/readiness pass through unchanged`, () => {
      const result = composeEvaluation({ deterministic, model: null, modelCalled: true });
      expect(result.verdict).toBe(verdict);
      expect(result.reviewReadiness).toBe(expectedReadiness);
    });

    for (const recommendation of ALL_RECOMMENDATIONS) {
      it(`verdict=${verdict}, model.recommendation=${recommendation}: verdict/readiness pass through unchanged`, () => {
        const model: EvaluationModelResult = { scores: {}, concerns: [], recommendation };
        const result = composeEvaluation({ deterministic, model, modelCalled: true });
        expect(result.verdict).toBe(verdict);
        expect(result.reviewReadiness).toBe(expectedReadiness);
      });
    }
  }
});

describe('composeEvaluation — a disagreeing model recommendation is recorded, never applied', () => {
  it("model says 'needs_rewrite' but the deterministic layer passed -> a model_recommendation_not_applied warning, verdict still pass", () => {
    const deterministic: DeterministicEvaluationResult = { verdict: 'pass', warnings: [] };
    const model: EvaluationModelResult = { scores: {}, concerns: [], recommendation: 'needs_rewrite' };
    const result = composeEvaluation({ deterministic, model, modelCalled: true });

    expect(result.verdict).toBe('pass');
    expect(result.reviewReadiness).toBe('ready_for_review');
    const warning = result.warnings.find((w) => w.code === 'model_recommendation_not_applied');
    expect(warning).toBeDefined();
    expect(warning?.source).toBe('model');
    expect(warning?.message).toContain('needs_rewrite');
  });

  it("model says 'ready' but the deterministic layer failed -> a model_recommendation_not_applied warning, verdict still fail", () => {
    const deterministic: DeterministicEvaluationResult = { verdict: 'fail', warnings: [] };
    const model: EvaluationModelResult = { scores: {}, concerns: [], recommendation: 'ready' };
    const result = composeEvaluation({ deterministic, model, modelCalled: true });

    expect(result.verdict).toBe('fail');
    expect(result.reviewReadiness).toBe('needs_rewrite');
    expect(result.warnings.some((w) => w.code === 'model_recommendation_not_applied')).toBe(true);
  });

  it('does not record the warning when the model agrees with the deterministic outcome', () => {
    const deterministic: DeterministicEvaluationResult = { verdict: 'fail', warnings: [] };
    const model: EvaluationModelResult = { scores: {}, concerns: [], recommendation: 'needs_rewrite' };
    const result = composeEvaluation({ deterministic, model, modelCalled: true });
    expect(result.warnings.some((w) => w.code === 'model_recommendation_not_applied')).toBe(false);
  });
});

describe('composeEvaluation — modelStatus reflects what actually happened', () => {
  const deterministic: DeterministicEvaluationResult = { verdict: 'pass', warnings: [] };

  it('is "skipped" when the model was never called', () => {
    const result = composeEvaluation({ deterministic, model: null, modelCalled: false });
    expect(result.modelStatus).toBe('skipped');
    expect(result.scores).toEqual({});
    expect(result.warnings).toEqual(deterministic.warnings);
  });

  it('is "unavailable" when the model was called but produced nothing usable', () => {
    const result = composeEvaluation({ deterministic, model: null, modelCalled: true });
    expect(result.modelStatus).toBe('unavailable');
    expect(result.scores).toEqual({});
    expect(result.warnings.some((w) => w.code === 'model_unavailable' && w.source === 'model')).toBe(true);
  });

  it('is "applied" when the model returned a usable result, and carries its scores', () => {
    const model: EvaluationModelResult = { scores: { coherence: 4, safety: 5 }, concerns: ['Pacing drags in beat 2.'], recommendation: 'ready' };
    const result = composeEvaluation({ deterministic, model, modelCalled: true });
    expect(result.modelStatus).toBe('applied');
    expect(result.scores).toEqual({ coherence: 4, safety: 5 });
    expect(result.warnings.some((w) => w.code === 'model_concern' && w.message === 'Pacing drags in beat 2.')).toBe(true);
  });
});

// ── detectDominantScript ─────────────────────────────────────────────────

describe('detectDominantScript', () => {
  it('detects latin', () => {
    expect(detectDominantScript('The quick brown fox jumps over the lazy dog again and again under the bright moon.')).toBe('latin');
  });

  it('detects devanagari', () => {
    expect(
      detectDominantScript('मीरा ने पुराने घर में एक जलती हुई लालटेन देखी और धीरे धीरे आगे बढ़ी। बाहर बारिश हो रही थी।')
    ).toBe('devanagari');
  });

  it('detects bengali', () => {
    expect(
      detectDominantScript('আমার সোনার বাংলা আমি তোমায় ভালোবাসি চিরদিন তোমার আকাশ তোমার বাতাস আমার প্রাণে বাজায় বাঁশি।')
    ).toBe('bengali');
  });

  it('detects gujarati', () => {
    expect(
      detectDominantScript('તમે કેમ છો ? હું મજામાં છું અને આજે ખૂબ સરસ દિવસ છે. ચાલો આપણે સાથે ફરવા જઈએ.')
    ).toBe('gujarati');
  });

  it('detects arabic', () => {
    expect(
      detectDominantScript('مرحبا بكم في هذه القصة الجميلة والممتعة جدا نتمنى لكم وقتا سعيدا مع هذه الحكاية الرائعة')
    ).toBe('arabic');
  });

  it("returns 'unknown' on a short sample -- too little evidence to judge", () => {
    expect(detectDominantScript('Hi there.')).toBe('unknown');
    expect(detectDominantScript('')).toBe('unknown');
  });

  it("returns 'latin' for English text -- the Hindi-language mismatch case comes from comparing this against EXPECTED_SCRIPT_BY_LANGUAGE.hindi", () => {
    const englishText = 'The lantern glowed warmly as Meera walked home through the quiet market street tonight.';
    expect(detectDominantScript(englishText)).toBe('latin');
    expect(EXPECTED_SCRIPT_BY_LANGUAGE.hindi).toBe('devanagari');
  });

  it('tolerates a minority of Latin proper nouns inside a dominant-script story (the 60% floor)', () => {
    const mostlyHindiWithALatinName =
      'मीरा ने पुराने घर में एक जलती हुई Lantern देखी और धीरे धीरे आगे बढ़ी। बाहर बारिश हो रही थी और हवा ठंडी थी।';
    expect(detectDominantScript(mostlyHindiWithALatinName)).toBe('devanagari');
  });
});

// ── parseEvaluationModelResult ───────────────────────────────────────────

describe('parseEvaluationModelResult — the input is hostile until proven otherwise', () => {
  it('returns null for non-JSON text', () => {
    expect(parseEvaluationModelResult('this is not json at all')).toBeNull();
  });

  it('returns null for a JSON array (not a plain object)', () => {
    expect(parseEvaluationModelResult('[1, 2, 3]')).toBeNull();
  });

  it('returns null for a JSON object with nothing usable in it', () => {
    expect(parseEvaluationModelResult('{"foo":"bar"}')).toBeNull();
  });

  it('drops out-of-range and non-integer scores, keeping valid ones', () => {
    const result = parseEvaluationModelResult(
      JSON.stringify({ scores: { coherence: 6, pacing: 3.5, safety: 0, ageFit: 4 } })
    );
    expect(result).not.toBeNull();
    expect(result?.scores).toEqual({ ageFit: 4 });
  });

  it('returns null when every score is invalid and nothing else is usable', () => {
    const result = parseEvaluationModelResult(JSON.stringify({ scores: { coherence: 6, pacing: -1 } }));
    expect(result).toBeNull();
  });

  it('drops unknown dimension keys, keeping recognised ones', () => {
    const result = parseEvaluationModelResult(JSON.stringify({ scores: { worldbuilding: 5, coherence: 4 } }));
    expect(result?.scores).toEqual({ coherence: 4 });
    expect(Object.keys(result?.scores ?? {})).not.toContain('worldbuilding');
  });

  it('strips a ```json fence and parses the JSON inside it', () => {
    const fenced = '```json\n' + JSON.stringify({ recommendation: 'ready' }) + '\n```';
    const result = parseEvaluationModelResult(fenced);
    expect(result).not.toBeNull();
    expect(result?.recommendation).toBe('ready');
  });

  it('caps concerns at 5 entries, trims and truncates them, and drops empties', () => {
    const raw = JSON.stringify({
      concerns: ['  Beat 2 rushes the discovery.  ', '', '   ', 'x'.repeat(300), 'c', 'd', 'e', 'f'],
    });
    const result = parseEvaluationModelResult(raw);
    expect(result?.concerns.length).toBeLessThanOrEqual(5);
    expect(result?.concerns[0]).toBe('Beat 2 rushes the discovery.');
    expect(result?.concerns.some((c) => c.length > 240)).toBe(false);
  });

  it('accepts only the three known recommendation literals, else null', () => {
    expect(parseEvaluationModelResult(JSON.stringify({ recommendation: 'ready' }))?.recommendation).toBe('ready');
    expect(parseEvaluationModelResult(JSON.stringify({ recommendation: 'needs_attention' }))?.recommendation).toBe('needs_attention');
    expect(parseEvaluationModelResult(JSON.stringify({ recommendation: 'needs_rewrite' }))?.recommendation).toBe('needs_rewrite');
    expect(parseEvaluationModelResult(JSON.stringify({ recommendation: 'excellent', concerns: ['ok'] }))?.recommendation).toBeNull();
  });

  it('a result with zero valid scores is still valid when a recommendation or a concern survives', () => {
    const result = parseEvaluationModelResult(JSON.stringify({ scores: { coherence: 99 }, recommendation: 'ready' }));
    expect(result).not.toBeNull();
    expect(result?.scores).toEqual({});
    expect(result?.recommendation).toBe('ready');
  });
});

// ── EVALUATION_DIMENSIONS / EXPECTED_SCRIPT_BY_LANGUAGE ─────────────────

describe('EVALUATION_DIMENSIONS', () => {
  it('has exactly the six subjective dimensions the model may score', () => {
    expect(EVALUATION_DIMENSIONS).toEqual(['coherence', 'ageFit', 'personaFidelity', 'pacing', 'learningValue', 'safety']);
  });
});

describe('EXPECTED_SCRIPT_BY_LANGUAGE', () => {
  it('maps every StoryLanguage to its expected script', () => {
    expect(EXPECTED_SCRIPT_BY_LANGUAGE).toEqual({
      english: 'latin',
      hindi: 'devanagari',
      marathi: 'devanagari',
      bangla: 'bengali',
      gujarati: 'gujarati',
      urdu: 'arabic',
    });
  });
});

// ── buildStoryEvaluationPrompt ───────────────────────────────────────────

describe('buildStoryEvaluationPrompt', () => {
  const params = {
    personaDisplayName: 'The Lantern Keeper',
    personaPrompt: 'Write gentle, hopeful stories for middle-grade readers.',
    language: 'english' as const,
    ageGroup: 'kids_8_12' as const,
    genre: 'fantasy',
    workingTitle: 'The Lantern That Would Not Go Out',
    premise: 'A curious child discovers an old brass lantern in a flooded cellar.',
    beats: [
      { beatNumber: 1, storyText: CLEAN_BEAT_TEXT, optionCount: 3, isEnding: false },
      { beatNumber: 2, storyText: ENDING_BEAT_TEXT, optionCount: 0, isEnding: true },
    ],
  };

  it('names the persona, the title and asks for JSON only', () => {
    const prompt = buildStoryEvaluationPrompt(params);
    expect(prompt).toContain('The Lantern Keeper');
    expect(prompt).toContain('The Lantern That Would Not Go Out');
    expect(prompt).toContain('"recommendation"');
    expect(prompt).toMatch(/advisory only/i);
  });

  it('caps each beat\'s text at 600 characters in the prompt', () => {
    const longBeat = { beatNumber: 1, storyText: 'a'.repeat(2000), optionCount: 3, isEnding: false };
    const prompt = buildStoryEvaluationPrompt({ ...params, beats: [longBeat] });
    expect(prompt).not.toContain('a'.repeat(601));
    expect(prompt).toContain('a'.repeat(600));
  });
});

// ── isMissingEvaluationSchemaError ───────────────────────────────────────

describe('isMissingEvaluationSchemaError', () => {
  it('recognizes undefined_table and undefined_column', () => {
    expect(isMissingEvaluationSchemaError({ code: '42P01' })).toBe(true);
    expect(isMissingEvaluationSchemaError({ code: '42703' })).toBe(true);
  });

  it('recognizes the PostgREST schema-cache codes', () => {
    expect(isMissingEvaluationSchemaError({ code: 'PGRST200' })).toBe(true);
    expect(isMissingEvaluationSchemaError({ code: 'PGRST204' })).toBe(true);
  });

  it('does not treat an unrelated error code as a missing schema', () => {
    expect(
      isMissingEvaluationSchemaError({
        code: '23514',
        message: 'new row for relation "agent_evaluations" violates check constraint "agent_evaluations_verdict_check"',
      })
    ).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isMissingEvaluationSchemaError(null)).toBe(false);
    expect(isMissingEvaluationSchemaError(undefined)).toBe(false);
  });
});
