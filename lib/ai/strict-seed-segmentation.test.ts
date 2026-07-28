import { describe, expect, it } from 'vitest';
import { splitStrictSeedSource } from './strict-seed-segmentation';

function compactWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

describe('Strictly Follow seed segmentation', () => {
  it('creates the selected number of non-empty beats without changing source words', () => {
    const source = [
      'Mira opened the old gate. A silver bird waited beyond it.',
      'The bird crossed the moonlit garden. Mira followed without speaking.',
      'At the fountain, it dropped a tiny brass key. Mira finally understood.',
    ].join('\n\n');

    const segments = splitStrictSeedSource(source, 3);

    expect(segments).toHaveLength(3);
    expect(segments.every(Boolean)).toBe(true);
    expect(compactWhitespace(segments.join(' '))).toBe(compactWhitespace(source));
    expect(segments[0]).toContain('old gate.');
    expect(segments[2]).toContain('brass key.');
  });

  it('falls back to word boundaries when sentence boundaries are sparse', () => {
    const source = 'one two three four five six seven eight nine ten eleven twelve';
    const segments = splitStrictSeedSource(source, 4);

    expect(segments).toEqual([
      'one two three',
      'four five six',
      'seven eight nine',
      'ten eleven twelve',
    ]);
  });

  it('rejects a source that cannot form the requested number of non-empty beats', () => {
    expect(() => splitStrictSeedSource('too short', 3)).toThrow(
      'Strictly Follow needs at least 3 words'
    );
  });
});
