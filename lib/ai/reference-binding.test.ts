import { describe, expect, it } from 'vitest';
import { buildReferenceBindingLines, estimateReferenceBindingChars } from './reference-binding';

describe('buildReferenceBindingLines', () => {
  it('returns empty string for no references', () => {
    expect(buildReferenceBindingLines([])).toBe('');
  });

  it('binds named character references to their provider image index', () => {
    const out = buildReferenceBindingLines([
      { type: 'character', name: 'Malik' },
      { type: 'character', name: 'Priya' },
    ]);
    expect(out).toContain('Attached reference image 1 depicts Malik');
    expect(out).toContain('Attached reference image 2 depicts Priya');
    expect(out.split('\n')).toHaveLength(2);
  });

  it('keeps indices aligned to provider order across mixed ref types', () => {
    // A scene ref occupies index 1 and now carries its own continuity line;
    // the character at position 2 must still be bound to image 2.
    const out = buildReferenceBindingLines([
      { type: 'scene', name: undefined },
      { type: 'character', name: 'Malik' },
    ]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'Attached reference image 1 is the previous storyboard: use it only for world and identity continuity; do not copy its composition, camera, poses, clothing or location.'
    );
    expect(lines[1]).toBe(
      'Attached reference image 2 depicts Malik — match this exact identity: face, skin tone, build and distinguishing features. Hair, clothing, age and pose come from the prompt; style from the story.'
    );
  });

  it('skips character refs with no name', () => {
    const out = buildReferenceBindingLines([
      { type: 'character', name: '   ' },
      { type: 'character' },
    ]);
    expect(out).toBe('');
  });

  it('emits a world-and-identity-only line for a scene reference, identical in compact and full form', () => {
    const full = buildReferenceBindingLines([{ type: 'scene' }]);
    const compact = buildReferenceBindingLines([{ type: 'scene' }], { compact: true });
    expect(full).toBe(
      'Attached reference image 1 is the previous storyboard: use it only for world and identity continuity; do not copy its composition, camera, poses, clothing or location.'
    );
    expect(compact).toBe(full);
  });

  it('emits no line for a world reference -- a NAMED scene ref, never mislabelled "the previous storyboard"', () => {
    // lib/references/direct-routing.ts's selectDirectWorldReference returns
    // { type: 'scene', name: world.label } -- the name is what distinguishes
    // it from the unnamed previous-storyboard/refine-anchor scene ref.
    expect(buildReferenceBindingLines([{ type: 'scene', name: 'Ashgrove Village' }])).toBe('');
  });

  it('emits only the index->character mapping in compact mode', () => {
    const out = buildReferenceBindingLines(
      [{ type: 'character', name: 'Malik' }],
      { compact: true }
    );
    expect(out).toBe('Attached reference image 1 depicts Malik.');
    expect(out).not.toContain('match this exact identity');
  });
});

describe('estimateReferenceBindingChars', () => {
  it('matches the compact form length exactly for the planned list', () => {
    const refs = [
      { type: 'character', name: 'Malik' },
      { type: 'scene' },
      { type: 'character', name: 'Priya' },
    ];
    expect(estimateReferenceBindingChars(refs)).toBe(
      buildReferenceBindingLines(refs, { compact: true }).length
    );
  });

  it('is 0 for no references, or a named (world) scene reference', () => {
    expect(estimateReferenceBindingChars([])).toBe(0);
    expect(estimateReferenceBindingChars([{ type: 'scene', name: 'Ashgrove Village' }])).toBe(0);
  });

  it('is not 0 for a scene reference -- it now carries its own continuity line', () => {
    expect(estimateReferenceBindingChars([{ type: 'scene' }])).toBeGreaterThan(0);
  });

  // Resolution can drop any reference (a stale signed URL, an unreachable r2
  // key). The surviving, in-order list actually sent is therefore always a
  // subset -- preserving relative order -- of the planned list the reserve
  // was computed from. Check every such subset of a sample list never needs
  // more characters than the plan reserved.
  function orderedSubsets<T>(items: T[]): T[][] {
    const subsets: T[][] = [[]];
    for (const item of items) {
      for (const existing of [...subsets]) {
        subsets.push([...existing, item]);
      }
    }
    return subsets;
  }

  it('is an upper bound for every survivor subset of a planned list', () => {
    const planned = [
      { type: 'character', name: 'Malik' },
      { type: 'scene' },
      { type: 'character', name: 'Priya, the second border guard' },
      { type: 'character', name: '' },
    ];
    const reserved = estimateReferenceBindingChars(planned);
    for (const subset of orderedSubsets(planned)) {
      const actual = buildReferenceBindingLines(subset, { compact: true }).length;
      expect(actual).toBeLessThanOrEqual(reserved);
    }
  });
});
