import { describe, expect, it } from 'vitest';
import { deriveDiscoveryIntro, normalizeDiscoveryIntro } from './discovery-intro';

describe('deriveDiscoveryIntro', () => {
  it('takes the first two sentences of the opening beat', () => {
    const intro = deriveDiscoveryIntro({
      storyText: 'The lighthouse went dark at midnight. Mira rowed out alone. Nobody followed her.',
    });

    expect(intro).toBe('The lighthouse went dark at midnight. Mira rowed out alone.');
  });

  it('falls back to storyTextParts when storyText is absent', () => {
    const intro = deriveDiscoveryIntro({
      storyTextParts: ['A door appears in the orchard.', 'It was not there yesterday.'],
    });

    expect(intro).toBe('A door appears in the orchard. It was not there yesterday.');
  });

  it('falls back to sceneSummary when there is no narration text', () => {
    const intro = deriveDiscoveryIntro({ sceneSummary: 'A market at dusk.' });
    expect(intro).toBe('A market at dusk.');
  });

  it('splits Hindi sentences on the danda', () => {
    const intro = deriveDiscoveryIntro({
      storyText: 'रात हो चुकी थी। मीरा अकेली चल पड़ी। कोई साथ नहीं आया।',
    });

    expect(intro).toBe('रात हो चुकी थी। मीरा अकेली चल पड़ी।');
  });

  it('trims an over-long single sentence on a word boundary', () => {
    const intro = deriveDiscoveryIntro({ storyText: `${'word '.repeat(60)}end.` });

    expect(intro).not.toBeNull();
    expect(intro!.length).toBeLessThanOrEqual(161);
    expect(intro!.endsWith('…')).toBe(true);
    expect(intro).not.toMatch(/wor…$/);
  });

  it('prefers one sentence over a truncated pair when the pair overflows', () => {
    const first = `${'a'.repeat(120)}.`;
    const intro = deriveDiscoveryIntro({ storyText: `${first} ${'b'.repeat(120)}.` });

    expect(intro).toBe(first);
  });

  it('returns null for empty or malformed beats', () => {
    expect(deriveDiscoveryIntro(null)).toBeNull();
    expect(deriveDiscoveryIntro(undefined)).toBeNull();
    expect(deriveDiscoveryIntro({})).toBeNull();
    expect(deriveDiscoveryIntro({ storyText: '   ' })).toBeNull();
    expect(deriveDiscoveryIntro('not a beat')).toBeNull();
  });
});

describe('normalizeDiscoveryIntro', () => {
  it('collapses whitespace and strips markdown and wrapping quotes', () => {
    expect(normalizeDiscoveryIntro('  "**A quiet**  town\nwakes up."  ')).toBe('A quiet town wakes up.');
  });

  it('caps stored intros at the length limit', () => {
    const result = normalizeDiscoveryIntro('word '.repeat(100));

    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(241);
  });

  it('returns null when nothing usable remains', () => {
    expect(normalizeDiscoveryIntro('')).toBeNull();
    expect(normalizeDiscoveryIntro('   ')).toBeNull();
    expect(normalizeDiscoveryIntro('***')).toBeNull();
    expect(normalizeDiscoveryIntro(42)).toBeNull();
  });
});
