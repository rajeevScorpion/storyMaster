import { describe, expect, it } from 'vitest';
import { filterAndRankOptions } from './filter-dropdown.shared';

describe('filterAndRankOptions', () => {
  const options = [
    { value: 'wb', label: 'West Bengal' },
    { value: 'up', label: 'Uttar Pradesh' },
    { value: 'mp', label: 'Madhya Pradesh' },
    { value: 'ka', label: 'Karnataka' },
    { value: 'ap', label: 'Andhra Pradesh' },
  ];

  it('returns every option, unchanged, for an empty query', () => {
    expect(filterAndRankOptions(options, '')).toEqual(options);
  });

  it('returns every option, unchanged, for a whitespace-only query', () => {
    expect(filterAndRankOptions(options, '   ')).toEqual(options);
  });

  it('matches case-insensitively', () => {
    const result = filterAndRankOptions(options, 'KARNA');
    expect(result.map((o) => o.value)).toEqual(['ka']);
  });

  it('ranks a starts-with match before a contains-only match', () => {
    // "Pradesh" starts none of the labels but is contained in three; "Uttar" starts one.
    const result = filterAndRankOptions(options, 'pradesh');
    expect(result.map((o) => o.value)).toEqual(['up', 'mp', 'ap']);
  });

  it('puts starts-with matches first, then contains matches, each group in original order', () => {
    const mixed = [
      { value: 'a', label: 'Bandra' }, // contains "and"
      { value: 'b', label: 'Andheri' }, // starts with "and"
      { value: 'c', label: 'Chandivali' }, // contains "and"
      { value: 'd', label: 'Andaman' }, // starts with "and"
    ];
    const result = filterAndRankOptions(mixed, 'and');
    expect(result.map((o) => o.value)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('excludes options whose label does not contain the query at all', () => {
    const result = filterAndRankOptions(options, 'zzz');
    expect(result).toEqual([]);
  });

  it('trims the query before matching', () => {
    const result = filterAndRankOptions(options, '  karnataka  ');
    expect(result.map((o) => o.value)).toEqual(['ka']);
  });

  it('does not mutate the input array', () => {
    const copy = [...options];
    filterAndRankOptions(options, 'pradesh');
    expect(options).toEqual(copy);
  });
});
