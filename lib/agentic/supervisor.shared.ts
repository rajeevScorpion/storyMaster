// ── Agentic Creator: Editorial Supervisor, pure half ────────────────────
//
// Pure and isomorphic, mirroring lib/agentic/memory.shared.ts's split: the server
// half (lib/agentic/supervisor.ts) queries the catalogue, calls the planning model,
// and writes agent_tasks rows; everything that decides WHAT is missing from the
// catalogue and WHETHER a model-proposed commission is trustworthy lives here, so
// it can be tested without a database or a model call.
//
// Two responsibilities live in this file:
//   1. Coverage: cross the full taxonomy (language x ageGroup x genre) against what
//      personas can actually serve, then rank the resulting cells by how starved
//      they are of stories.
//   2. Commission validation: a model wrote the commission proposals coming back
//      from buildSupervisorPlanningPrompt, so validateCommissionProposals treats
//      that JSON as hostile input, exactly like validateCommissionProposals'
//      sibling in spirit -- lib/ai/generation-schemas.ts's structured-output
//      parsing -- treats every model response.
//
// VERIFIED CURRENT-STATE FACTS (do not re-derive):
//   - storylines has age_group and genre but NO language column. Language comes
//     from stories.story_config->>'language' via a join on storylines.story_id.
//   - Real genre values include 'reel', which is not in STORY_GENRES. Coverage
//     rows carrying it (or any other off-taxonomy value) must be tolerated --
//     counted into no cell, never a crash.
//   - age_group includes 'all_ages' in real data.
//   - All 15 seed personas are status='draft', not 'active' (see
//     docs/agentic-creator-working-memory.md). Coverage/ranking is fed only the
//     personas a caller has already filtered to 'active'; today that set is empty
//     in every real environment, which is why buildCoverageMatrix yielding zero
//     servable cells is the very first thing this code will do in production, not
//     an edge case.

import type { AgeGroup, StoryLanguage } from '@/lib/types/story';
import { STORY_LANGUAGE_OPTIONS } from '@/lib/ai/story-config';
import { STORY_GENRES, isStoryGenre, type StoryGenre } from '@/lib/story/genres';
import { AGE_GROUP_VALUES } from '@/lib/story/age-groups';
import type { AgentPersona } from './personas.shared';

// ── Constants ──────────────────────────────────────────────────────────
// Exported so tests pin them and callers never inline a magic number.

/** A model call is never made for more commissions than this in one tick. */
export const MAX_COMMISSIONS_PER_TICK = 5;
/** Rationale text is truncated (never rejected) past this many characters. */
export const RATIONALE_MAX_CHARS = 400;
/** How many ranked gaps are carried into one planning prompt. */
export const GAP_SHORTLIST_SIZE = 12;

const ALL_STORY_LANGUAGES: readonly StoryLanguage[] = STORY_LANGUAGE_OPTIONS.map((option) => option.value);
const AGE_GROUP_SET: ReadonlySet<string> = new Set(AGE_GROUP_VALUES);
const LANGUAGE_SET: ReadonlySet<string> = new Set(ALL_STORY_LANGUAGES);

function isAgeGroupValue(value: string): value is AgeGroup {
  return AGE_GROUP_SET.has(value);
}

function isStoryLanguageValue(value: string): value is StoryLanguage {
  return LANGUAGE_SET.has(value);
}

function cellKey(language: string, ageGroup: string, genre: string): string {
  return `${language}|${ageGroup}|${genre}`;
}

// ── Types ──────────────────────────────────────────────────────────────

/** The subset of an AgentPersona this module needs. Reused rather than redeclared. */
export type SupervisorPersona = Pick<AgentPersona, 'id' | 'slug' | 'status' | 'language' | 'ageGroup' | 'genres'>;

/** One observed row from the catalogue: a published storyline or an agent_story_memory entry. */
export interface CoverageRow {
  language: string;
  ageGroup: string;
  genre: string;
  count: number;
  origin: 'published' | 'agent';
}

export interface CoverageCell {
  language: StoryLanguage;
  ageGroup: AgeGroup;
  genre: StoryGenre;
  publishedCount: number;
  agentCount: number;
}

export interface CoverageGap extends CoverageCell {
  /** 1-based rank after sorting -- 1 is the single most urgent gap. */
  priority: number;
  servingPersonaIds: string[];
}

export interface CommissionProposal {
  personaId: string;
  personaSlug: string;
  language: StoryLanguage;
  ageGroup: AgeGroup;
  genre: StoryGenre;
  brief: string;
  /** Concise editorial rationale, never chain-of-thought. Truncated to RATIONALE_MAX_CHARS. */
  rationale: string;
  targetBeatCount: number | null;
  seriesId: string | null;
  /** Priority of the coverage gap this commission targets, when it matches one. */
  gapPriority: number | null;
}

export interface RejectedCommission {
  reason: string;
  raw: unknown;
}

export interface ValidateCommissionProposalsResult {
  accepted: CommissionProposal[];
  rejected: RejectedCommission[];
}

// ── Coverage matrix ────────────────────────────────────────────────────

function findServingPersonaIds(
  cell: { language: string; ageGroup: string; genre: string },
  personas: readonly SupervisorPersona[]
): string[] {
  return personas
    .filter((persona) => persona.language === cell.language && persona.ageGroup === cell.ageGroup && persona.genres.includes(cell.genre))
    .map((persona) => persona.id);
}

/**
 * Crosses the full taxonomy (language x ageGroup x genre) and keeps only the
 * combinations at least one supplied persona could actually serve -- a cell no
 * persona can write is not a commissionable gap, it's just unreachable, so there is
 * no point tracking it. `rows` are summed into whichever cell they match by origin;
 * a row whose language/ageGroup/genre is off-taxonomy (e.g. the real 'reel' genre
 * value, which is not in STORY_GENRES) or matches no servable cell is silently
 * counted into nothing. That is a feature, not a gap in validation: this function
 * must never throw on catalogue data it doesn't recognize.
 */
export function buildCoverageMatrix(rows: readonly CoverageRow[], personas: readonly SupervisorPersona[]): CoverageCell[] {
  const cellsByKey = new Map<string, CoverageCell>();

  for (const language of ALL_STORY_LANGUAGES) {
    for (const ageGroup of AGE_GROUP_VALUES) {
      for (const genreOption of STORY_GENRES) {
        const genre = genreOption.value;
        if (findServingPersonaIds({ language, ageGroup, genre }, personas).length === 0) continue;
        cellsByKey.set(cellKey(language, ageGroup, genre), { language, ageGroup, genre, publishedCount: 0, agentCount: 0 });
      }
    }
  }

  for (const row of rows) {
    if (!isStoryLanguageValue(row.language) || !isAgeGroupValue(row.ageGroup) || !isStoryGenre(row.genre)) continue;
    const cell = cellsByKey.get(cellKey(row.language, row.ageGroup, row.genre));
    if (!cell) continue; // Off-taxonomy, or no persona can serve it: counted into no cell.

    if (row.origin === 'published') cell.publishedCount += row.count;
    else cell.agentCount += row.count;
  }

  return [...cellsByKey.values()];
}

/**
 * Ranks coverage cells into gaps worth commissioning against, most urgent first.
 * Deterministic total order, never random:
 *   1. Ascending total coverage (publishedCount + agentCount) -- zero-coverage
 *      cells sort first because zero is the smallest possible sum.
 *   2. More serving personas first (a gap more personas could fill is easier to
 *      act on this tick).
 *   3. Alphabetical by "language|ageGroup|genre" as the final, always-distinct
 *      tiebreaker, since taxonomy combinations are unique.
 * `personas` recomputes each cell's serving personas rather than trusting a field
 * on CoverageCell (which carries none), so this function is usable on any
 * CoverageCell list, not only one buildCoverageMatrix just produced.
 */
export function rankCoverageGaps(
  cells: readonly CoverageCell[],
  personas: readonly SupervisorPersona[],
  options: { limit?: number } = {}
): CoverageGap[] {
  const limit = options.limit ?? GAP_SHORTLIST_SIZE;

  const withServingPersonas = cells.map((cell) => ({
    cell,
    servingPersonaIds: findServingPersonaIds(cell, personas),
  }));

  withServingPersonas.sort((left, right) => {
    const totalLeft = left.cell.publishedCount + left.cell.agentCount;
    const totalRight = right.cell.publishedCount + right.cell.agentCount;
    if (totalLeft !== totalRight) return totalLeft - totalRight;

    if (left.servingPersonaIds.length !== right.servingPersonaIds.length) {
      return right.servingPersonaIds.length - left.servingPersonaIds.length; // more serving personas first
    }

    const keyLeft = cellKey(left.cell.language, left.cell.ageGroup, left.cell.genre);
    const keyRight = cellKey(right.cell.language, right.cell.ageGroup, right.cell.genre);
    return keyLeft < keyRight ? -1 : keyLeft > keyRight ? 1 : 0;
  });

  return withServingPersonas.slice(0, Math.max(0, limit)).map((entry, index) => ({
    ...entry.cell,
    priority: index + 1,
    servingPersonaIds: entry.servingPersonaIds,
  }));
}

// ── Commission proposal validation ────────────────────────────────────

/**
 * Validates the JSON array a model returned from buildSupervisorPlanningPrompt.
 * The model wrote `raw`; every field is treated as hostile until checked. Rejected
 * for: an unknown or inactive persona slug, a genre outside STORY_GENRES, a genre
 * the named persona doesn't cover, an ageGroup or language outside the taxonomy, a
 * proposal whose stated language/ageGroup doesn't match its own persona's, and a
 * missing or empty brief. Anything beyond MAX_COMMISSIONS_PER_TICK accepted
 * proposals is rejected rather than silently dropped, so a caller can see the
 * model over-proposed. Rationale is truncated to RATIONALE_MAX_CHARS, never
 * rejected for length -- a long rationale is a formatting problem, not a hostile
 * one.
 */
export function validateCommissionProposals(
  raw: unknown,
  { personas, gaps }: { personas: readonly SupervisorPersona[]; gaps: readonly CoverageGap[] }
): ValidateCommissionProposalsResult {
  const accepted: CommissionProposal[] = [];
  const rejected: RejectedCommission[] = [];

  if (!Array.isArray(raw)) {
    rejected.push({ reason: 'Model response was not a JSON array of proposals.', raw });
    return { accepted, rejected };
  }

  const personaBySlug = new Map(personas.map((persona) => [persona.slug, persona]));
  const gapByKey = new Map(gaps.map((gap) => [cellKey(gap.language, gap.ageGroup, gap.genre), gap]));

  for (const entry of raw) {
    if (accepted.length >= MAX_COMMISSIONS_PER_TICK) {
      rejected.push({ reason: `Exceeds MAX_COMMISSIONS_PER_TICK (${MAX_COMMISSIONS_PER_TICK}).`, raw: entry });
      continue;
    }

    if (!entry || typeof entry !== 'object') {
      rejected.push({ reason: 'Proposal is not a JSON object.', raw: entry });
      continue;
    }
    const candidate = entry as Record<string, unknown>;

    const slug = typeof candidate.personaSlug === 'string' ? candidate.personaSlug.trim() : '';
    const persona = slug ? personaBySlug.get(slug) : undefined;
    if (!persona) {
      rejected.push({ reason: `Unknown or inactive persona slug: "${slug || '(missing)'}".`, raw: entry });
      continue;
    }
    if (persona.status !== 'active') {
      rejected.push({ reason: `Unknown or inactive persona slug: "${slug}" (status: ${persona.status}).`, raw: entry });
      continue;
    }

    const genre = typeof candidate.genre === 'string' ? candidate.genre.trim().toLowerCase() : '';
    if (!isStoryGenre(genre)) {
      rejected.push({ reason: `Genre "${genre || '(missing)'}" is not in STORY_GENRES.`, raw: entry });
      continue;
    }
    if (!persona.genres.includes(genre)) {
      rejected.push({ reason: `Persona "${slug}" does not cover genre "${genre}".`, raw: entry });
      continue;
    }

    const language = typeof candidate.language === 'string' ? candidate.language.trim().toLowerCase() : '';
    if (!isStoryLanguageValue(language)) {
      rejected.push({ reason: `Language "${language || '(missing)'}" is not in the taxonomy.`, raw: entry });
      continue;
    }

    const ageGroup = typeof candidate.ageGroup === 'string' ? candidate.ageGroup.trim() : '';
    if (!isAgeGroupValue(ageGroup)) {
      rejected.push({ reason: `Age group "${ageGroup || '(missing)'}" is not in the taxonomy.`, raw: entry });
      continue;
    }

    if (language !== persona.language || ageGroup !== persona.ageGroup) {
      rejected.push({
        reason: `Proposal language/ageGroup (${language}/${ageGroup}) does not match persona "${slug}"'s own (${persona.language}/${persona.ageGroup}).`,
        raw: entry,
      });
      continue;
    }

    const brief = typeof candidate.brief === 'string' ? candidate.brief.trim() : '';
    if (!brief) {
      rejected.push({ reason: 'Missing or empty brief.', raw: entry });
      continue;
    }

    const rationaleRaw = typeof candidate.rationale === 'string' ? candidate.rationale.trim() : '';
    const rationale = rationaleRaw.slice(0, RATIONALE_MAX_CHARS);

    const targetBeatCount =
      typeof candidate.targetBeatCount === 'number' && Number.isFinite(candidate.targetBeatCount)
        ? Math.round(candidate.targetBeatCount)
        : null;
    const seriesId = typeof candidate.seriesId === 'string' && candidate.seriesId.trim() ? candidate.seriesId.trim() : null;

    const matchedGap = gapByKey.get(cellKey(language, ageGroup, genre));

    accepted.push({
      personaId: persona.id,
      personaSlug: persona.slug,
      language,
      ageGroup,
      genre,
      brief,
      rationale,
      targetBeatCount,
      seriesId,
      gapPriority: matchedGap ? matchedGap.priority : null,
    });
  }

  return { accepted, rejected };
}

// ── Planning prompt ────────────────────────────────────────────────────

/**
 * Prompt for the planning call (TaskKey agent_supervisor_planning), assembled in
 * code exactly like buildNoveltyAdjudicationPrompt in memory.shared.ts -- this is
 * not an admin-editable template (see prompt-config.shared.ts's PromptTaskKey
 * exclusion list), so there is no template to inject values into.
 */
export function buildSupervisorPlanningPrompt(gaps: readonly CoverageGap[], personas: readonly SupervisorPersona[]): string {
  const gapLines = gaps.length
    ? gaps
        .map(
          (gap, index) =>
            `${index + 1}. language=${gap.language}, ageGroup=${gap.ageGroup}, genre=${gap.genre}` +
            ` — published=${gap.publishedCount}, agent-authored=${gap.agentCount}, servable by ${gap.servingPersonaIds.length} persona(s)`
        )
        .join('\n')
    : '(no coverage gaps)';

  const personaLines = personas.length
    ? personas
        .map((persona) => `- slug: "${persona.slug}" — language: ${persona.language}, ageGroup: ${persona.ageGroup}, genres: ${persona.genres.join(', ') || '(none)'}`)
        .join('\n')
    : '(no active personas)';

  return [
    'You are the Editorial Supervisor for an interactive story platform. Your job is to commission new stories that fill real gaps in the published catalogue.',
    '',
    'Coverage gaps, most urgent first (least existing coverage and most servable personas rank first):',
    gapLines,
    '',
    'Active personas available to commission:',
    personaLines,
    '',
    `Propose at most ${MAX_COMMISSIONS_PER_TICK} commissions. Each commission must name an existing persona by its exact slug. Its language and ageGroup must exactly match that persona's own language and ageGroup, and its genre must be one the persona already covers.`,
    '',
    'For each commission, write a brief: a concrete, specific story premise the persona can start writing from -- not a genre label or a restatement of the gap.',
    '',
    'Also write a rationale: one or two sentences of plain editorial reasoning for why this commission is worth making now (e.g. which gap it closes, or why this persona fits it). The rationale must be a concise editorial conclusion only -- never chain-of-thought, never step-by-step reasoning, never your internal deliberation.',
    '',
    'Respond with JSON only, no prose outside it: a JSON array, each entry with exactly these keys:',
    '{"personaSlug":"string","language":"string","ageGroup":"string","genre":"string","brief":"string","rationale":"string","targetBeatCount":number|null,"seriesId":string|null}',
    'Return an empty array [] if no commission is actually worth making.',
  ].join('\n');
}

// ── Schema-availability latch classifier ──────────────────────────────

/**
 * True when a Postgres/PostgREST error means "migration 106 hasn't run on this
 * database yet", as opposed to any other failure that should surface as a real
 * error. Codes only, deliberately -- see isMissingPersonaSchemaError in
 * personas.shared.ts and isMissingMemorySchemaError in memory.shared.ts for the
 * defect this guards against: a bare message match on the table name would also
 * catch a real constraint violation (agent_tasks carries CHECK constraints on
 * origin/status) and misreport it as an unapplied migration. Per GOTCHAS.md,
 * latches (and their classifiers) are kept one per migration group.
 */
export function isMissingTaskSchemaError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||    // undefined_table: agent_tasks absent
    error.code === '42703' ||    // undefined_column: stories.agent_task_id absent
    error.code === 'PGRST200' || // PostgREST: relationship not found in schema cache
    error.code === 'PGRST204'    // PostgREST: column not found in schema cache
  );
}
