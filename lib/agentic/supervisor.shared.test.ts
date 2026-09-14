import { describe, expect, it } from 'vitest';
import {
  GAP_SHORTLIST_SIZE,
  MAX_COMMISSIONS_PER_TICK,
  RATIONALE_MAX_CHARS,
  buildCoverageMatrix,
  buildSupervisorPlanningPrompt,
  isMissingTaskSchemaError,
  rankCoverageGaps,
  validateCommissionProposals,
  type CoverageGap,
  type CoverageRow,
  type SupervisorPersona,
} from './supervisor.shared';

function persona(overrides: Partial<SupervisorPersona> = {}): SupervisorPersona {
  return {
    id: 'persona-1',
    slug: 'luna-teller',
    status: 'active',
    language: 'english',
    ageGroup: 'kids_8_12',
    genres: ['fantasy', 'adventure'],
    ...overrides,
  };
}

function row(overrides: Partial<CoverageRow> = {}): CoverageRow {
  return {
    language: 'english',
    ageGroup: 'kids_8_12',
    genre: 'fantasy',
    count: 1,
    origin: 'published',
    ...overrides,
  };
}

describe('buildCoverageMatrix — no active personas', () => {
  it('produces no servable cells at all when the persona list is empty', () => {
    const cells = buildCoverageMatrix([row(), row({ origin: 'agent' })], []);
    expect(cells).toEqual([]);
  });

  it('feeding that empty matrix into rankCoverageGaps yields no gaps, not a crash', () => {
    const cells = buildCoverageMatrix([row()], []);
    const gaps = rankCoverageGaps(cells, []);
    expect(gaps).toEqual([]);
  });
});

describe('buildCoverageMatrix — off-taxonomy tolerance', () => {
  it('does not crash on the real off-taxonomy genre "reel" and creates no cell for it', () => {
    const personas = [persona()];
    const rows: CoverageRow[] = [
      row({ genre: 'reel' }),
      row({ genre: 'reel', origin: 'agent' }),
      row({ genre: 'fantasy' }), // the one real, servable row
    ];

    expect(() => buildCoverageMatrix(rows, personas)).not.toThrow();
    const cells = buildCoverageMatrix(rows, personas);

    expect(cells.some((cell) => (cell.genre as string) === 'reel')).toBe(false);
    const fantasyCell = cells.find((cell) => cell.genre === 'fantasy');
    expect(fantasyCell?.publishedCount).toBe(1);
    expect(fantasyCell?.agentCount).toBe(0);
  });

  it('tolerates an off-taxonomy ageGroup and language without crashing or counting them', () => {
    const personas = [persona()];
    const rows: CoverageRow[] = [
      row({ ageGroup: 'toddlers' }),
      row({ language: 'klingon' }),
    ];
    expect(() => buildCoverageMatrix(rows, personas)).not.toThrow();
    const cells = buildCoverageMatrix(rows, personas);
    const totalCounted = cells.reduce((sum, cell) => sum + cell.publishedCount + cell.agentCount, 0);
    expect(totalCounted).toBe(0);
  });
});

describe('buildCoverageMatrix — servability restriction', () => {
  it('only produces cells a supplied persona could actually serve', () => {
    const personas = [persona({ language: 'english', ageGroup: 'kids_8_12', genres: ['fantasy'] })];
    const cells = buildCoverageMatrix([], personas);

    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ language: 'english', ageGroup: 'kids_8_12', genre: 'fantasy' });
  });

  it('a row matching no servable cell (persona covers a different genre) is counted into nothing', () => {
    const personas = [persona({ genres: ['fantasy'] })];
    const rows = [row({ genre: 'horror' })]; // in STORY_GENRES, but this persona doesn't cover it
    const cells = buildCoverageMatrix(rows, personas);
    expect(cells.every((cell) => cell.genre !== 'horror')).toBe(true);
  });
});

describe('rankCoverageGaps — determinism', () => {
  const personas = [
    persona({ id: 'p1', slug: 'p1', genres: ['fantasy', 'adventure', 'mystery'] }),
    persona({ id: 'p2', slug: 'p2', genres: ['fantasy'] }),
  ];

  function scenarioRows(): CoverageRow[] {
    return [
      row({ genre: 'fantasy', count: 3 }),
      row({ genre: 'adventure', count: 0 }),
      row({ genre: 'mystery', count: 1, origin: 'agent' }),
    ];
  }

  it('returns the identical order on repeated calls with the same input', () => {
    const cellsA = buildCoverageMatrix(scenarioRows(), personas);
    const cellsB = buildCoverageMatrix(scenarioRows(), personas);

    const gapsA = rankCoverageGaps(cellsA, personas);
    const gapsB = rankCoverageGaps(cellsB, personas);

    expect(gapsA).toEqual(gapsB);
  });

  it('sorts zero-coverage cells first, then ascending total coverage', () => {
    const cells = buildCoverageMatrix(scenarioRows(), personas);
    const gaps = rankCoverageGaps(cells, personas);

    const totals = gaps.map((gap) => gap.publishedCount + gap.agentCount);
    for (let i = 1; i < totals.length; i += 1) {
      expect(totals[i]).toBeGreaterThanOrEqual(totals[i - 1]);
    }
    expect(totals[0]).toBe(0);
  });

  it('assigns sequential 1-based priority matching sort order', () => {
    const cells = buildCoverageMatrix(scenarioRows(), personas);
    const gaps = rankCoverageGaps(cells, personas);
    gaps.forEach((gap, index) => expect(gap.priority).toBe(index + 1));
  });

  it('ties on coverage break toward more serving personas, then alphabetically', () => {
    // Both 'fantasy' (2 personas) and 'adventure' (1 persona) are at zero coverage.
    const cells = buildCoverageMatrix([], personas);
    const gaps = rankCoverageGaps(cells, personas);

    const fantasyIndex = gaps.findIndex((gap) => gap.genre === 'fantasy');
    const adventureIndex = gaps.findIndex((gap) => gap.genre === 'adventure');
    expect(fantasyIndex).toBeGreaterThanOrEqual(0);
    expect(adventureIndex).toBeGreaterThanOrEqual(0);
    expect(fantasyIndex).toBeLessThan(adventureIndex); // more serving personas (2) sorts first
  });

  it('respects the limit option and defaults to GAP_SHORTLIST_SIZE', () => {
    const manyPersonas: SupervisorPersona[] = ['adventure', 'mystery', 'fantasy', 'comedy', 'drama', 'horror', 'romance', 'sci-fi'].map(
      (genre, index) => persona({ id: `many-${index}`, slug: `many-${index}`, genres: [genre] })
    );
    const cells = buildCoverageMatrix([], manyPersonas);
    const gaps = rankCoverageGaps(cells, manyPersonas, { limit: 3 });
    expect(gaps).toHaveLength(3);
    expect(rankCoverageGaps(cells, manyPersonas).length).toBeLessThanOrEqual(GAP_SHORTLIST_SIZE);
  });
});

describe('validateCommissionProposals — hostile input, one rejection reason at a time', () => {
  const activePersona = persona({ id: 'p1', slug: 'active-slug', status: 'active', language: 'english', ageGroup: 'kids_8_12', genres: ['fantasy'] });
  const inactivePersona = persona({ id: 'p2', slug: 'inactive-slug', status: 'draft', language: 'english', ageGroup: 'kids_8_12', genres: ['fantasy'] });
  const personas = [activePersona, inactivePersona];
  const gaps: CoverageGap[] = [];

  function validRaw(overrides: Record<string, unknown> = {}) {
    return {
      personaSlug: 'active-slug',
      language: 'english',
      ageGroup: 'kids_8_12',
      genre: 'fantasy',
      brief: 'A lantern-keeper discovers her light has started answering questions.',
      rationale: 'Fills the English kids_8_12 fantasy gap with a persona already suited to it.',
      targetBeatCount: 8,
      seriesId: null,
      ...overrides,
    };
  }

  it('accepts a well-formed proposal', () => {
    const result = validateCommissionProposals([validRaw()], { personas, gaps });
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]).toMatchObject({ personaId: 'p1', personaSlug: 'active-slug', language: 'english', ageGroup: 'kids_8_12', genre: 'fantasy' });
  });

  it('rejects a response that is not a JSON array', () => {
    const result = validateCommissionProposals({ not: 'an array' }, { personas, gaps });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/not a JSON array/i);
  });

  it('rejects an unknown persona slug', () => {
    const result = validateCommissionProposals([validRaw({ personaSlug: 'no-such-persona' })], { personas, gaps });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/unknown or inactive persona slug/i);
  });

  it('rejects an inactive persona slug', () => {
    const result = validateCommissionProposals([validRaw({ personaSlug: 'inactive-slug', ageGroup: 'kids_8_12' })], { personas, gaps });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/unknown or inactive persona slug/i);
  });

  it('rejects a genre outside STORY_GENRES', () => {
    const result = validateCommissionProposals([validRaw({ genre: 'reel' })], { personas, gaps });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/not in STORY_GENRES/i);
  });

  it('rejects a genre the named persona does not cover', () => {
    const result = validateCommissionProposals([validRaw({ genre: 'horror' })], { personas, gaps });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/does not cover genre/i);
  });

  it('rejects an ageGroup outside the taxonomy', () => {
    const result = validateCommissionProposals([validRaw({ ageGroup: 'toddlers' })], { personas, gaps });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/age group.*not in the taxonomy/i);
  });

  it('rejects a language outside the taxonomy', () => {
    const result = validateCommissionProposals([validRaw({ language: 'klingon' })], { personas, gaps });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/language.*not in the taxonomy/i);
  });

  it('rejects a proposal whose language/ageGroup does not match its own persona', () => {
    const result = validateCommissionProposals([validRaw({ ageGroup: 'teens' })], { personas, gaps });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/does not match persona/i);
  });

  it('rejects a missing brief', () => {
    const result = validateCommissionProposals([validRaw({ brief: undefined })], { personas, gaps });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/missing or empty brief/i);
  });

  it('rejects an empty (whitespace-only) brief', () => {
    const result = validateCommissionProposals([validRaw({ brief: '   ' })], { personas, gaps });
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/missing or empty brief/i);
  });

  it('rejects anything past MAX_COMMISSIONS_PER_TICK', () => {
    const many = Array.from({ length: MAX_COMMISSIONS_PER_TICK + 2 }, () => validRaw());
    const result = validateCommissionProposals(many, { personas, gaps });
    expect(result.accepted).toHaveLength(MAX_COMMISSIONS_PER_TICK);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected.every((entry) => /MAX_COMMISSIONS_PER_TICK/.test(entry.reason))).toBe(true);
  });

  it('truncates a too-long rationale rather than rejecting it', () => {
    const longRationale = 'x'.repeat(RATIONALE_MAX_CHARS + 250);
    const result = validateCommissionProposals([validRaw({ rationale: longRationale })], { personas, gaps });
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].rationale).toHaveLength(RATIONALE_MAX_CHARS);
  });

  it('attaches the matching gap priority when the proposal targets a known gap', () => {
    const matchingGap: CoverageGap = {
      language: 'english',
      ageGroup: 'kids_8_12',
      genre: 'fantasy',
      publishedCount: 0,
      agentCount: 0,
      priority: 1,
      servingPersonaIds: ['p1'],
    };
    const result = validateCommissionProposals([validRaw()], { personas, gaps: [matchingGap] });
    expect(result.accepted[0].gapPriority).toBe(1);
  });

  it('leaves gapPriority null when the proposal matches no supplied gap', () => {
    const result = validateCommissionProposals([validRaw()], { personas, gaps: [] });
    expect(result.accepted[0].gapPriority).toBeNull();
  });
});

describe('buildSupervisorPlanningPrompt', () => {
  it('lists gaps and personas and asks for strict JSON', () => {
    const gap: CoverageGap = {
      language: 'english',
      ageGroup: 'kids_8_12',
      genre: 'fantasy',
      publishedCount: 0,
      agentCount: 0,
      priority: 1,
      servingPersonaIds: ['p1'],
    };
    const prompt = buildSupervisorPlanningPrompt([gap], [persona()]);
    expect(prompt).toContain('luna-teller');
    expect(prompt).toContain('"personaSlug"');
    expect(prompt).toMatch(/JSON only/i);
  });

  it('instructs a concise editorial rationale, never chain-of-thought', () => {
    const prompt = buildSupervisorPlanningPrompt([], []);
    expect(prompt).toMatch(/one or two sentences/i);
    expect(prompt).toMatch(/never chain-of-thought/i);
  });

  it('handles empty gaps and personas without crashing', () => {
    expect(() => buildSupervisorPlanningPrompt([], [])).not.toThrow();
  });
});

describe('isMissingTaskSchemaError', () => {
  it('recognizes undefined_table and undefined_column', () => {
    expect(isMissingTaskSchemaError({ code: '42P01' })).toBe(true);
    expect(isMissingTaskSchemaError({ code: '42703' })).toBe(true);
  });

  it('recognizes the PostgREST schema-cache codes', () => {
    expect(isMissingTaskSchemaError({ code: 'PGRST200' })).toBe(true);
    expect(isMissingTaskSchemaError({ code: 'PGRST204' })).toBe(true);
  });

  it('does not treat a constraint violation naming the table as a missing schema', () => {
    expect(
      isMissingTaskSchemaError({
        code: '23514',
        message: 'new row for relation "agent_tasks" violates check constraint "agent_tasks_status_check"',
      })
    ).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isMissingTaskSchemaError(null)).toBe(false);
    expect(isMissingTaskSchemaError(undefined)).toBe(false);
  });
});
