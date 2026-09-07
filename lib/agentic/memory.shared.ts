// ── Agentic Creator: novelty scoring ───────────────────────────────────
//
// Pure and isomorphic. The server half (lib/agentic/memory.ts) fetches
// candidate priors and records verdicts; everything that decides whether a
// story is too similar to one we already have lives here, so it can be tested
// without a database.
//
// DECISION D3 (docs/agentic-creator-decisions.md): there is no pgvector in this
// database and none is being added. Similarity is deterministic text scoring
// plus, only inside a narrow ambiguous band, one economy-tier model call.
//
// What is reused rather than rewritten, from lib/ai/character-novelty.shared.ts
// (already proven, already tested, already covered by a smoke suite):
//   - normalizeCharacterName / findSimilarRecentName for cast reuse. That
//     module's name matching already handles titles ("Captain X"), single-token
//     containment and one-character edits, which is exactly the problem here.
//   - appearanceSimilarity as the token-overlap measure for PROSE fields
//     (premise, setting). It is a Dice coefficient over content tokens and
//     requires >= 5 tokens on each side, which premises and setting summaries
//     comfortably clear.
//
// What is new here, and why: titles are two to five words, so they fall under
// appearanceSimilarity's 5-token floor and always score 0. Titles therefore get
// trigramSimilarity() below, which reimplements Postgres pg_trgm's algorithm
// (word padding + 3-grams + Jaccard). That is deliberate: lib/agentic/memory.ts
// retrieves candidate priors with SQL similarity() over pg_trgm GIN indexes, and
// the in-process scorer needs to agree with the index that selected the rows.
// Two different notions of "similar" across those layers would silently drop
// candidates the scorer would have flagged.

import {
  appearanceSimilarity,
  findSimilarRecentName,
  normalizeCharacterName,
  type RecentCharacterNoveltyEntry,
} from '@/lib/ai/character-novelty.shared';

// ── Thresholds ─────────────────────────────────────────────────────────
// Exported so tests pin them and so an operator reading a verdict can see the
// number it was measured against. Never inline these values at a call site.

/** Title trigram similarity at or above this is a duplicate outright. */
export const TITLE_BLOCK_THRESHOLD = 0.72;
/** Title trigram similarity at or above this is worth a human glance. */
export const TITLE_WARN_THRESHOLD = 0.45;

/** Premise token overlap at or above this means the same story premise. */
export const PREMISE_BLOCK_THRESHOLD = 0.55;
export const PREMISE_WARN_THRESHOLD = 0.35;

/** Setting token overlap at or above this means the same place, again. */
export const SETTING_WARN_THRESHOLD = 0.5;

/** How many reused cast names across UNRELATED stories before we warn. */
export const CHARACTER_REUSE_WARN_COUNT = 2;
/** ...and before we block. */
export const CHARACTER_REUSE_BLOCK_COUNT = 4;

/** How many unrelated priors may share a theme before the theme is saturated. */
export const THEME_SATURATION_WARN_COUNT = 6;

/**
 * The band where deterministic scoring is genuinely unsure. Below it, the
 * candidate is clearly novel; above it, clearly derivative. Only inside it is a
 * model call worth paying for.
 */
export const AMBIGUOUS_BAND_LOW = 0.35;
export const AMBIGUOUS_BAND_HIGH = 0.62;

/** Priors carried into one scoring pass. Matches the SQL side's top-N fetch. */
export const NOVELTY_PRIOR_FETCH_LIMIT = 20;

// ── Types ──────────────────────────────────────────────────────────────

export type NoveltyVerdict = 'clear' | 'warn' | 'block';
export type NoveltyStage = 'pre_generation' | 'post_generation';

/** What we are about to write, or have just written. */
export interface NoveltyCandidate {
  title: string;
  premise: string;
  themes: string[];
  characterNames: string[];
  settingSummary?: string | null;
  language?: string | null;
  ageGroup?: string | null;
  genre?: string | null;
  /** Set when this story is an episode of an existing series. */
  seriesId?: string | null;
}

/** One row of agent_story_memory, as the scorer sees it. */
export interface NoveltyPrior {
  id: string;
  title: string;
  premise: string;
  themes: string[];
  characterNames: string[];
  settingSummary?: string | null;
  seriesId?: string | null;
  episodeNumber?: number | null;
}

export interface NoveltyTopCandidate {
  priorId: string;
  title: string;
  signal: 'title' | 'premise' | 'setting' | 'character_reuse';
  score: number;
  /** True when this prior is another episode of the candidate's own series. */
  sameSeries: boolean;
}

export interface NoveltyScoreResult {
  verdict: NoveltyVerdict;
  /** Strongest single signal, 0..1. Drives needsModelAdjudication(). */
  score: number;
  reasons: string[];
  topCandidates: NoveltyTopCandidate[];
}

export interface ScoreNoveltyInput {
  candidate: NoveltyCandidate;
  priors: NoveltyPrior[];
  /**
   * Explicit series context. Normally left unset — the candidate's own
   * seriesId is used. Pass it to score a candidate as part of a series before
   * the series id has been written onto it.
   */
  seriesContext?: { seriesId: string | null };
}

// ── pg_trgm-compatible trigram similarity ──────────────────────────────

/**
 * Postgres pg_trgm's tokenization: lowercase, split on non-alphanumerics, pad
 * each word with two leading spaces and one trailing space, then take every
 * 3-character window. Reimplemented rather than approximated so the in-process
 * score agrees with the SQL similarity() that selected the candidate rows.
 */
function trigrams(value: string): Set<string> {
  const out = new Set<string>();
  const words = value
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  for (const word of words) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      out.add(padded.slice(i, i + 3));
    }
  }
  return out;
}

/** Jaccard over trigram sets, matching pg_trgm's similarity(). Range 0..1. */
export function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Scoring ────────────────────────────────────────────────────────────

function toRecentEntries(names: string[]): RecentCharacterNoveltyEntry[] {
  return names
    .filter((name) => typeof name === 'string' && name.trim().length > 0)
    .map((name) => ({ displayName: name, normalizedName: normalizeCharacterName(name) }));
}

function prose(value: string | null | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Scores a candidate against recent priors.
 *
 * SERIES CONTINUITY IS NOT DUPLICATION. When a prior belongs to the same series
 * as the candidate, recurring cast and a recurring setting are the entire point
 * of a series -- suppressing those two signals for sibling episodes is what
 * stops the system from refusing to write episode 4 because it has the same
 * characters as episode 3. Theme saturation likewise ignores siblings, since a
 * series is expected to keep working the same themes.
 *
 * What is NOT suppressed for siblings: title and premise similarity. Episode 4
 * must not retell episode 2, and that is a real failure the check must still
 * catch. Getting this distinction wrong in either direction is the single most
 * likely defect in this file.
 */
export function scoreNovelty({ candidate, priors, seriesContext }: ScoreNoveltyInput): NoveltyScoreResult {
  const reasons: string[] = [];
  const topCandidates: NoveltyTopCandidate[] = [];

  const seriesId = seriesContext ? seriesContext.seriesId : (candidate.seriesId ?? null);
  const isSibling = (prior: NoveltyPrior): boolean =>
    Boolean(seriesId) && Boolean(prior.seriesId) && prior.seriesId === seriesId;

  if (priors.length === 0) {
    return { verdict: 'clear', score: 0, reasons: ['No prior stories in memory to compare against.'], topCandidates: [] };
  }

  let titleTop = 0;
  let premiseTop = 0;
  let settingTop = 0;

  for (const prior of priors) {
    const sameSeries = isSibling(prior);

    // Title and premise are scored for every prior, siblings included.
    const titleScore = trigramSimilarity(candidate.title, prior.title);
    if (titleScore > titleTop) titleTop = titleScore;
    if (titleScore >= TITLE_WARN_THRESHOLD) {
      topCandidates.push({ priorId: prior.id, title: prior.title, signal: 'title', score: titleScore, sameSeries });
    }

    const premiseScore = appearanceSimilarity(prose(candidate.premise), prose(prior.premise));
    if (premiseScore > premiseTop) premiseTop = premiseScore;
    if (premiseScore >= PREMISE_WARN_THRESHOLD) {
      topCandidates.push({ priorId: prior.id, title: prior.title, signal: 'premise', score: premiseScore, sameSeries });
    }

    // Setting repetition is expected within a series; skip siblings.
    if (!sameSeries) {
      const settingScore = appearanceSimilarity(prose(candidate.settingSummary), prose(prior.settingSummary));
      if (settingScore > settingTop) settingTop = settingScore;
      if (settingScore >= SETTING_WARN_THRESHOLD) {
        topCandidates.push({ priorId: prior.id, title: prior.title, signal: 'setting', score: settingScore, sameSeries });
      }
    }
  }

  // Cast reuse, counted only against stories outside the candidate's series.
  const unrelatedPriors = priors.filter((prior) => !isSibling(prior));
  const unrelatedCast = toRecentEntries(unrelatedPriors.flatMap((prior) => prior.characterNames ?? []));
  const reusedNames = candidate.characterNames.filter((name) => findSimilarRecentName(name, unrelatedCast));
  const reuseCount = reusedNames.length;

  if (reuseCount > 0) {
    const owner = unrelatedPriors.find((prior) =>
      (prior.characterNames ?? []).some((priorName) =>
        reusedNames.some((reused) => normalizeCharacterName(reused) === normalizeCharacterName(priorName))
      )
    );
    if (owner) {
      topCandidates.push({
        priorId: owner.id,
        title: owner.title,
        signal: 'character_reuse',
        score: Math.min(1, reuseCount / CHARACTER_REUSE_BLOCK_COUNT),
        sameSeries: false,
      });
    }
  }

  // Theme saturation, likewise ignoring the candidate's own series.
  const candidateThemes = new Set(candidate.themes.map((theme) => theme.trim().toLowerCase()).filter(Boolean));
  const saturatedCount = candidateThemes.size === 0
    ? 0
    : unrelatedPriors.filter((prior) =>
        (prior.themes ?? []).some((theme) => candidateThemes.has(theme.trim().toLowerCase()))
      ).length;

  // ── Verdict ──────────────────────────────────────────────────────────
  let verdict: NoveltyVerdict = 'clear';
  const raise = (next: NoveltyVerdict) => {
    if (next === 'block' || (next === 'warn' && verdict === 'clear')) verdict = next;
  };

  if (titleTop >= TITLE_BLOCK_THRESHOLD) {
    raise('block');
    reasons.push(`Title is ${(titleTop * 100).toFixed(0)}% similar to an existing story (block at ${TITLE_BLOCK_THRESHOLD * 100}%).`);
  } else if (titleTop >= TITLE_WARN_THRESHOLD) {
    raise('warn');
    reasons.push(`Title is ${(titleTop * 100).toFixed(0)}% similar to an existing story.`);
  }

  if (premiseTop >= PREMISE_BLOCK_THRESHOLD) {
    raise('block');
    reasons.push(`Premise overlaps an existing story by ${(premiseTop * 100).toFixed(0)}% (block at ${PREMISE_BLOCK_THRESHOLD * 100}%).`);
  } else if (premiseTop >= PREMISE_WARN_THRESHOLD) {
    raise('warn');
    reasons.push(`Premise overlaps an existing story by ${(premiseTop * 100).toFixed(0)}%.`);
  }

  if (reuseCount >= CHARACTER_REUSE_BLOCK_COUNT) {
    raise('block');
    reasons.push(`${reuseCount} character names reused from unrelated stories: ${reusedNames.join(', ')}.`);
  } else if (reuseCount >= CHARACTER_REUSE_WARN_COUNT) {
    raise('warn');
    reasons.push(`${reuseCount} character names reused from unrelated stories: ${reusedNames.join(', ')}.`);
  }

  if (settingTop >= SETTING_WARN_THRESHOLD) {
    raise('warn');
    reasons.push(`Setting repeats an unrelated story by ${(settingTop * 100).toFixed(0)}%.`);
  }

  if (saturatedCount >= THEME_SATURATION_WARN_COUNT) {
    raise('warn');
    reasons.push(`${saturatedCount} recent unrelated stories already share these themes.`);
  }

  if (seriesId && priors.some(isSibling)) {
    reasons.push('Series continuity: recurring cast and setting from sibling episodes were not counted as repetition.');
  }

  if (verdict === 'clear' && reasons.length === 0) {
    reasons.push('No significant similarity to recent stories.');
  }

  const score = Math.max(
    titleTop,
    premiseTop,
    settingTop,
    reuseCount / CHARACTER_REUSE_BLOCK_COUNT,
    saturatedCount / THEME_SATURATION_WARN_COUNT
  );

  topCandidates.sort((left, right) => right.score - left.score);

  return { verdict, score: Math.min(1, score), reasons, topCandidates: topCandidates.slice(0, 5) };
}

/**
 * True only inside the band where deterministic scoring is genuinely unsure.
 * Outside it a model call buys nothing: below the band the candidate is clearly
 * novel, above it clearly derivative, and either way the verdict stands.
 */
export function needsModelAdjudication(score: number): boolean {
  return score >= AMBIGUOUS_BAND_LOW && score < AMBIGUOUS_BAND_HIGH;
}

/** Prompt for the economy-tier adjudication call (TaskKey agent_novelty_assessment). */
export function buildNoveltyAdjudicationPrompt(
  candidate: NoveltyCandidate,
  topCandidates: NoveltyTopCandidate[]
): string {
  const priorLines = topCandidates.length
    ? topCandidates
        .map((entry, index) =>
          `${index + 1}. "${entry.title}" — flagged on ${entry.signal} at ${(entry.score * 100).toFixed(0)}%${entry.sameSeries ? ' (same series as the candidate)' : ''}`
        )
        .join('\n')
    : '(none)';

  return [
    'You are checking whether a proposed new story is too similar to stories a platform has already published.',
    '',
    'Proposed story:',
    `Title: ${candidate.title}`,
    `Premise: ${candidate.premise}`,
    `Themes: ${candidate.themes.join(', ') || '(none given)'}`,
    `Characters: ${candidate.characterNames.join(', ') || '(none given)'}`,
    `Setting: ${prose(candidate.settingSummary) || '(none given)'}`,
    candidate.seriesId ? 'This story is an episode of an existing series.' : 'This story is standalone.',
    '',
    'Existing stories flagged as similar by deterministic scoring:',
    priorLines,
    '',
    'Judge whether the proposed story is genuinely derivative, or merely shares surface features',
    'such as a genre, an age group, or a common setting. If the proposed story is an episode of a',
    'series, shared characters and settings with its own series are expected and are NOT duplication —',
    'only a repeated plot is.',
    '',
    'Respond with JSON only, no prose outside it:',
    '{"verdict":"clear|warn|block","reason":"one sentence"}',
  ].join('\n');
}

/**
 * True when a Postgres/PostgREST error means migration 105 has not run on this
 * database, as opposed to any other failure that should surface as a real error.
 *
 * Codes only, deliberately. Phase 2a shipped a defect where the personas latch
 * also matched the table name in the error message, which made a duplicate-key
 * violation look like an unapplied migration -- the most misleading diagnosis
 * available. See isMissingPersonaSchemaError in personas.shared.ts.
 *
 * This is a latch for migration 105 alone. Per GOTCHAS.md, latches are one per
 * migration group and are never shared across groups.
 */
export function isMissingMemorySchemaError(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||    // undefined_table: agent_story_memory / agent_novelty_checks absent
    error.code === '42703' ||    // undefined_column
    error.code === 'PGRST200' || // PostgREST: relationship not found in schema cache
    error.code === 'PGRST204'    // PostgREST: column not found in schema cache
  );
}
