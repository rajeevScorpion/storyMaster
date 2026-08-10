/** Longer than this is a paste, not a search; the ILIKE cost is not worth it. */
const MAX_TERM_LENGTH = 80;

/**
 * Characters that must not reach PostgREST verbatim.
 *
 * `%` `_` `*` are LIKE/PostgREST wildcards, so a typed one would silently widen
 * the match. `(` `)` `,` delimit the `or(...)` group itself. `"` closes the
 * quoted value, and a backslash escapes within it. Everything else — including
 * `.`, apostrophes, hyphens and non-Latin scripts — is kept, because titles
 * contain them and the value is double-quoted for exactly that reason.
 */
const UNSAFE_PATTERN = new RegExp('[%_*\\\\"(),]|[\\u0000-\\u001f\\u007f]', 'g');

export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(UNSAFE_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TERM_LENGTH)
    .trim();
}

/**
 * One PostgREST `or=` group matching the term against every searchable column.
 *
 * Title-only search was fine when this was a filter box at the bottom of the
 * page. As the primary way to find anything it is not: people search for the
 * author they liked, or the genre, or a phrase they remember from the blurb.
 *
 * Returns null when nothing searchable survives sanitizing, which the caller
 * must treat as "no search", not as "matches nothing".
 */
export function buildSearchOrFilter(term: string, columns: string[]): string | null {
  const safe = sanitizeSearchTerm(term);
  if (!safe || columns.length === 0) return null;

  return columns.map((column) => `${column}.ilike."%${safe}%"`).join(',');
}
