/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit C): pure filter/ranking logic for
 * `FilterDropdown`'s `searchable` mode, pulled out of the component so it can be unit tested
 * without a DOM. The repo has no @testing-library/react or jsdom/happy-dom dependency yet (see
 * package.json), so `FilterDropdown.tsx` itself stays untested directly; this module is the
 * testable surface for the one behaviour worth pinning down precisely.
 */

export interface FilterDropdownOptionLike {
  value: string;
  label: string;
}

/**
 * Case-insensitive filter of `options` on `label` against `query`. A label that STARTS WITH the
 * query ranks before one that merely CONTAINS it elsewhere; within each of those two groups,
 * relative order is unchanged (a stable partition, not a sort by index).
 *
 * An empty (or all-whitespace) query returns every option, in its original order, as a new
 * array (never the same reference as `options`), so callers can always treat the result as a
 * fresh list to render.
 */
export function filterAndRankOptions<T extends FilterDropdownOptionLike>(
  options: readonly T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options.slice();

  const startsWith: T[] = [];
  const contains: T[] = [];
  for (const option of options) {
    const index = option.label.toLowerCase().indexOf(needle);
    if (index === 0) startsWith.push(option);
    else if (index > 0) contains.push(option);
  }
  return [...startsWith, ...contains];
}
