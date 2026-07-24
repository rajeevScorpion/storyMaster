import { describe, expect, it } from 'vitest';
import { buildReferenceBindingLines } from './reference-binding';

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
    // A scene ref occupies index 1 but carries no identity line; the character
    // at position 2 must still be bound to image 2.
    const out = buildReferenceBindingLines([
      { type: 'scene', name: undefined },
      { type: 'character', name: 'Malik' },
    ]);
    expect(out).toBe(
      'Attached reference image 2 depicts Malik — match this exact identity (face, hair, build, distinguishing features). Render fully in the story\'s locked visual style; the reference defines identity, never rendering style.'
    );
  });

  it('skips character refs with no name', () => {
    const out = buildReferenceBindingLines([
      { type: 'character', name: '   ' },
      { type: 'character' },
    ]);
    expect(out).toBe('');
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
