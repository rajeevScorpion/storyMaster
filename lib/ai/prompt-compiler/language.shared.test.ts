import { describe, expect, it } from 'vitest';
import { isEnglishText } from './language.shared';

describe('isEnglishText', () => {
  it('accepts plain English', () => {
    expect(isEnglishText('A wide establishing shot of the harbor at dawn.')).toBe(true);
  });

  it('rejects Hindi', () => {
    expect(isEnglishText('वह सुबह बंदरगाह पर खड़ी थी।')).toBe(false);
  });

  it('accepts an English sentence containing a Devanagari name when ignored', () => {
    // Short on purpose: the name must be a large-enough share of the letters
    // that ignoring it actually flips the 90% Latin threshold below.
    expect(isEnglishText('अन्वी smiles at dawn.', { ignore: ['अन्वी'] })).toBe(true);
  });

  it('rejects the same sentence without the ignore list', () => {
    expect(isEnglishText('अन्वी smiles at dawn.')).toBe(false);
  });

  it('treats an empty string as English (vacuously true)', () => {
    expect(isEnglishText('')).toBe(true);
  });

  it('rejects Japanese', () => {
    expect(isEnglishText('彼女は夜明けに港に立っていた。')).toBe(false);
  });

  it('ignores case and every occurrence of an ignore entry', () => {
    expect(
      isEnglishText('Anvi and ANVI walk together while अन्वी watches from afar.', { ignore: ['अन्वी'] })
    ).toBe(true);
  });

  it('is vacuously English for text with no letters at all', () => {
    expect(isEnglishText('42 - 17 = 25')).toBe(true);
  });
});
