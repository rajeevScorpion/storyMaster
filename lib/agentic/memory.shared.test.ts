import { describe, expect, it } from 'vitest';
import {
  applyAdjudication,
  NOVELTY_VERDICT_SEVERITY,
  AMBIGUOUS_BAND_HIGH,
  AMBIGUOUS_BAND_LOW,
  CHARACTER_REUSE_BLOCK_COUNT,
  CHARACTER_REUSE_WARN_COUNT,
  THEME_SATURATION_WARN_COUNT,
  TITLE_BLOCK_THRESHOLD,
  TITLE_WARN_THRESHOLD,
  buildNoveltyAdjudicationPrompt,
  isMissingMemorySchemaError,
  needsModelAdjudication,
  scoreNovelty,
  trigramSimilarity,
  type NoveltyCandidate,
  type NoveltyPrior,
} from './memory.shared';

const SERIES = '11111111-1111-1111-1111-111111111111';

function candidate(overrides: Partial<NoveltyCandidate> = {}): NoveltyCandidate {
  return {
    title: 'The Lantern That Would Not Go Out',
    premise:
      'A curious child discovers an old brass lantern in a flooded cellar and learns that it burns brighter whenever someone nearby tells the truth about something difficult.',
    themes: ['honesty', 'courage'],
    characterNames: ['Meera', 'Uncle Bashir'],
    settingSummary: 'A monsoon-soaked coastal town with narrow lanes, a flooded cellar and a fishing harbour.',
    language: 'english',
    ageGroup: 'kids_8_12',
    genre: 'fantasy',
    seriesId: null,
    ...overrides,
  };
}

function prior(overrides: Partial<NoveltyPrior> = {}): NoveltyPrior {
  return {
    id: 'prior-1',
    title: 'The Clockwork Sparrow',
    premise:
      'Two siblings repair a mechanical bird and discover it has been carrying messages between two feuding neighbourhoods for forty years.',
    themes: ['forgiveness'],
    characterNames: ['Dev', 'Anjali'],
    settingSummary: 'A dry inland city of workshops, rooftop water tanks and long summer afternoons.',
    seriesId: null,
    episodeNumber: null,
    ...overrides,
  };
}

describe('trigramSimilarity', () => {
  it('is 1 for identical strings and 0 for disjoint ones', () => {
    expect(trigramSimilarity('the silver kite', 'the silver kite')).toBe(1);
    expect(trigramSimilarity('zebra', 'quixotic')).toBe(0);
  });

  it('is symmetric', () => {
    const a = trigramSimilarity('the silver kite', 'a silver kite');
    const b = trigramSimilarity('a silver kite', 'the silver kite');
    expect(a).toBe(b);
  });

  it('returns 0 when either side has no alphanumeric content', () => {
    expect(trigramSimilarity('', 'something')).toBe(0);
    expect(trigramSimilarity('!!! ---', 'something')).toBe(0);
  });

  // Parity with Postgres pg_trgm.similarity(). These expected values were read
  // off the live staging database, not derived from this implementation:
  //   select similarity('the silver kite', 'a silver kite');  -- 0.666667
  //
  // This matters because lib/agentic/memory.ts selects candidate priors with
  // SQL similarity() over the pg_trgm GIN indexes from migration 105, then
  // scores them in-process with this function. If the two drift apart, the
  // index silently stops returning rows the scorer would have flagged, and the
  // failure is invisible — no error, just weaker novelty checking. Lock it.
  it('matches Postgres pg_trgm.similarity() exactly', () => {
    const cases: [string, string, number][] = [
      ['The Lantern That Would Not Go Out', 'The Lantern That Would Not Go Out', 1],
      ['The Lantern That Would Not Go Out', 'The Lantern That Never Went Out', 0.512195],
      ['The Clockwork Sparrow', 'The Lantern That Would Not Go Out', 0.08],
      ['the silver kite', 'a silver kite', 0.666667],
      ['Meera and the Harbour Bell', 'The Harbour Bell', 0.62963],
    ];
    for (const [left, right, postgres] of cases) {
      expect(trigramSimilarity(left, right)).toBeCloseTo(postgres, 5);
    }
  });

  // Calibration check on that same real pair: two titles a reader would call
  // "basically the same story" land between warn and block, which is where a
  // human should look rather than the system deciding alone.
  it('places a plausibly-duplicate title between the warn and block thresholds', () => {
    const score = trigramSimilarity('The Lantern That Would Not Go Out', 'The Lantern That Never Went Out');
    expect(score).toBeGreaterThanOrEqual(TITLE_WARN_THRESHOLD);
    expect(score).toBeLessThan(TITLE_BLOCK_THRESHOLD);
  });
});

describe('scoreNovelty — the clear cases', () => {
  it('returns clear with no priors at all', () => {
    const result = scoreNovelty({ candidate: candidate(), priors: [] });
    expect(result.verdict).toBe('clear');
    expect(result.score).toBe(0);
  });

  it('returns clear for a genuinely novel candidate', () => {
    const result = scoreNovelty({ candidate: candidate(), priors: [prior()] });
    expect(result.verdict).toBe('clear');
  });

  it('blocks a near-duplicate title', () => {
    const result = scoreNovelty({
      candidate: candidate(),
      priors: [prior({ title: 'The Lantern That Would Not Go Out' })],
    });
    expect(result.verdict).toBe('block');
    expect(result.score).toBeGreaterThanOrEqual(TITLE_BLOCK_THRESHOLD);
    expect(result.topCandidates.some((entry) => entry.signal === 'title')).toBe(true);
  });

  it('blocks a restated premise even under a different title', () => {
    const result = scoreNovelty({
      candidate: candidate(),
      priors: [
        prior({
          title: 'Completely Different Words Here',
          premise:
            'A curious child discovers an old brass lantern in a flooded cellar and learns that it burns brighter whenever someone nearby tells the truth about something difficult.',
        }),
      ],
    });
    expect(result.verdict).toBe('block');
    expect(result.reasons.join(' ')).toMatch(/premise/i);
  });
});

// The distinction this whole module exists to get right.
describe('scoreNovelty — series continuity is not duplication', () => {
  const episodeThree = candidate({
    title: 'The Harbour Bell',
    premise:
      'Meera and Uncle Bashir must convince the harbour master to delay the fishing fleet when they notice the tide behaving strangely before a storm.',
    seriesId: SERIES,
  });

  const episodeTwo = prior({
    id: 'prior-ep2',
    title: 'The Flooded Cellar',
    premise:
      'Meera and Uncle Bashir search the cellar of the old customs house for the source of a light that only appears at night.',
    characterNames: ['Meera', 'Uncle Bashir'],
    settingSummary: 'A monsoon-soaked coastal town with narrow lanes, a flooded cellar and a fishing harbour.',
    seriesId: SERIES,
    episodeNumber: 2,
  });

  it('treats recurring cast and setting inside one series as clear', () => {
    const result = scoreNovelty({ candidate: episodeThree, priors: [episodeTwo] });
    expect(result.verdict).toBe('clear');
    expect(result.reasons.join(' ')).toMatch(/series continuity/i);
  });

  it('does not count sibling-episode cast toward character reuse', () => {
    const result = scoreNovelty({ candidate: episodeThree, priors: [episodeTwo] });
    expect(result.reasons.join(' ')).not.toMatch(/character names reused/i);
  });

  it('still blocks a sibling episode that retells an earlier one', () => {
    const retread = scoreNovelty({
      candidate: { ...episodeThree, title: episodeTwo.title, premise: episodeTwo.premise },
      priors: [episodeTwo],
    });
    expect(retread.verdict).toBe('block');
  });

  it('flags the same cast reuse when the stories are NOT in one series', () => {
    const unrelated = scoreNovelty({
      candidate: { ...episodeThree, seriesId: null },
      priors: [{ ...episodeTwo, seriesId: null }],
    });
    expect(unrelated.verdict).not.toBe('clear');
    expect(unrelated.reasons.join(' ')).toMatch(/character names reused/i);
  });

  it('honours an explicit seriesContext over the candidate field', () => {
    const result = scoreNovelty({
      candidate: { ...episodeThree, seriesId: null },
      priors: [episodeTwo],
      seriesContext: { seriesId: SERIES },
    });
    expect(result.verdict).toBe('clear');
  });
});

describe('scoreNovelty — cast reuse thresholds', () => {
  const reusedNames = ['Meera', 'Bashir', 'Dev', 'Anjali'];

  it(`warns at ${CHARACTER_REUSE_WARN_COUNT} reused names`, () => {
    const result = scoreNovelty({
      candidate: candidate({ title: 'Something Else Entirely', premise: 'An unrelated premise about a bus.', characterNames: reusedNames.slice(0, CHARACTER_REUSE_WARN_COUNT) }),
      priors: [prior({ characterNames: reusedNames })],
    });
    expect(result.verdict).toBe('warn');
  });

  it(`blocks at ${CHARACTER_REUSE_BLOCK_COUNT} reused names`, () => {
    const result = scoreNovelty({
      candidate: candidate({ title: 'Something Else Entirely', premise: 'An unrelated premise about a bus.', characterNames: reusedNames.slice(0, CHARACTER_REUSE_BLOCK_COUNT) }),
      priors: [prior({ characterNames: reusedNames })],
    });
    expect(result.verdict).toBe('block');
  });

  it('stays clear when one name is shared', () => {
    const result = scoreNovelty({
      candidate: candidate({ title: 'Something Else Entirely', premise: 'An unrelated premise about a bus.', characterNames: ['Meera'] }),
      priors: [prior({ characterNames: reusedNames })],
    });
    expect(result.verdict).toBe('clear');
  });
});

describe('scoreNovelty — theme saturation', () => {
  it(`warns once ${THEME_SATURATION_WARN_COUNT} unrelated priors share a theme`, () => {
    const priors = Array.from({ length: THEME_SATURATION_WARN_COUNT }, (_unused, index) =>
      prior({ id: `prior-${index}`, title: `Unrelated Story Number ${index}`, themes: ['honesty'], characterNames: [], premise: `A distinct premise number ${index} about weather balloons.` })
    );
    const result = scoreNovelty({ candidate: candidate({ characterNames: [] }), priors });
    expect(result.verdict).toBe('warn');
    expect(result.reasons.join(' ')).toMatch(/share these themes/i);
  });

  it('stays clear one prior below the threshold', () => {
    const priors = Array.from({ length: THEME_SATURATION_WARN_COUNT - 1 }, (_unused, index) =>
      prior({ id: `prior-${index}`, title: `Unrelated Story Number ${index}`, themes: ['honesty'], characterNames: [], premise: `A distinct premise number ${index} about weather balloons.` })
    );
    const result = scoreNovelty({ candidate: candidate({ characterNames: [] }), priors });
    expect(result.verdict).toBe('clear');
  });
});

describe('needsModelAdjudication', () => {
  it('is false below the band and true inside it', () => {
    expect(needsModelAdjudication(AMBIGUOUS_BAND_LOW - 0.01)).toBe(false);
    expect(needsModelAdjudication(AMBIGUOUS_BAND_LOW)).toBe(true);
    expect(needsModelAdjudication((AMBIGUOUS_BAND_LOW + AMBIGUOUS_BAND_HIGH) / 2)).toBe(true);
  });

  it('is false at and above the top of the band — a clear duplicate needs no second opinion', () => {
    expect(needsModelAdjudication(AMBIGUOUS_BAND_HIGH)).toBe(false);
    expect(needsModelAdjudication(1)).toBe(false);
  });
});

describe('buildNoveltyAdjudicationPrompt', () => {
  it('names the candidate and each flagged prior', () => {
    const scored = scoreNovelty({ candidate: candidate(), priors: [prior({ title: 'The Lantern That Would Not Go Out' })] });
    const prompt = buildNoveltyAdjudicationPrompt(candidate(), scored.topCandidates);
    expect(prompt).toContain('The Lantern That Would Not Go Out');
    expect(prompt).toContain('"verdict"');
  });

  it('tells the model that shared cast within a series is expected', () => {
    const prompt = buildNoveltyAdjudicationPrompt(candidate({ seriesId: SERIES }), []);
    expect(prompt).toMatch(/episode of a[\s\S]*series/i);
    expect(prompt).toMatch(/NOT duplication/);
  });
});

describe('isMissingMemorySchemaError', () => {
  it('recognizes undefined_table and undefined_column', () => {
    expect(isMissingMemorySchemaError({ code: '42P01' })).toBe(true);
    expect(isMissingMemorySchemaError({ code: '42703' })).toBe(true);
  });

  it('recognizes the PostgREST schema-cache codes', () => {
    expect(isMissingMemorySchemaError({ code: 'PGRST200' })).toBe(true);
    expect(isMissingMemorySchemaError({ code: 'PGRST204' })).toBe(true);
  });

  // Guards the Phase 2a defect: a constraint violation naming the table must
  // not be reported as "migration 105 has not been applied".
  it('does not treat a constraint violation naming the table as a missing schema', () => {
    expect(
      isMissingMemorySchemaError({
        code: '23514',
        message: 'new row for relation "agent_novelty_checks" violates check constraint "agent_novelty_checks_verdict_check"',
      })
    ).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isMissingMemorySchemaError(null)).toBe(false);
    expect(isMissingMemorySchemaError(undefined)).toBe(false);
  });
});

describe('applyAdjudication — the model may soften a verdict, never harden it', () => {
  it('severity is ordered clear < warn < block', () => {
    expect(NOVELTY_VERDICT_SEVERITY.clear).toBeLessThan(NOVELTY_VERDICT_SEVERITY.warn);
    expect(NOVELTY_VERDICT_SEVERITY.warn).toBeLessThan(NOVELTY_VERDICT_SEVERITY.block);
  });

  it('a model block NEVER escalates a deterministic warn — the measured regression', () => {
    // Four adjudications of identical input (top_score 0.5000, two reused
    // character names, deterministic verdict 'warn') returned block, block,
    // warn, block. Before this rule that made a terminal run failure a coin
    // flip decided entirely by an unauditable model call.
    expect(applyAdjudication('warn', 'block')).toBe('warn');
  });

  it('a model block never escalates a deterministic clear either', () => {
    expect(applyAdjudication('clear', 'block')).toBe('clear');
    expect(applyAdjudication('clear', 'warn')).toBe('clear');
  });

  it('the model CAN downgrade, which is the job it exists for', () => {
    // Reachable in the ambiguous band: a premise scoring 0.55-0.62 crosses
    // PREMISE_BLOCK_THRESHOLD while staying below AMBIGUOUS_BAND_HIGH.
    expect(applyAdjudication('block', 'warn')).toBe('warn');
    expect(applyAdjudication('block', 'clear')).toBe('clear');
    expect(applyAdjudication('warn', 'clear')).toBe('clear');
  });

  it('agreement is a no-op at every level', () => {
    expect(applyAdjudication('clear', 'clear')).toBe('clear');
    expect(applyAdjudication('warn', 'warn')).toBe('warn');
    expect(applyAdjudication('block', 'block')).toBe('block');
  });
});
