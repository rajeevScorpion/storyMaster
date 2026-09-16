import { describe, expect, it } from 'vitest';
import {
  buildPersonaVoiceOptions,
  buildPersonaVoiceUsage,
  resolvePersonaVoice,
  type PersonaVoiceLists,
} from './persona-voice.shared';

const LISTS: PersonaVoiceLists = {
  maleVoiceList: ['Charon', 'Puck', 'Fenrir'],
  femaleVoiceList: ['Kore', 'Aoede', 'Leda'],
};

describe('resolvePersonaVoice', () => {
  it('returns null for a null preferredVoice', () => {
    expect(resolvePersonaVoice({ preferredVoice: null }, LISTS)).toBeNull();
  });

  it('returns null for an empty-string preferredVoice', () => {
    expect(resolvePersonaVoice({ preferredVoice: '' }, LISTS)).toBeNull();
  });

  it('returns null for a whitespace-only preferredVoice', () => {
    expect(resolvePersonaVoice({ preferredVoice: '   ' }, LISTS)).toBeNull();
  });

  it('never invents a default voice for an unset persona -- null stays null regardless of list contents', () => {
    // The whole point of this function: an unset persona must never resolve to
    // LISTS.maleVoiceList[0] or any other list entry. If this ever starts
    // returning a voice id here, the fallback bug Phase 8 exists to fix is back.
    const result = resolvePersonaVoice({ preferredVoice: null }, LISTS);
    expect(result).not.toEqual({ voiceId: LISTS.maleVoiceList[0], genderBucket: 'male' });
    expect(result).not.toEqual({ voiceId: LISTS.femaleVoiceList[0], genderBucket: 'female' });
    expect(result).toBeNull();
  });

  it('resolves a male-list voice with genderBucket "male"', () => {
    expect(resolvePersonaVoice({ preferredVoice: 'Charon' }, LISTS)).toEqual({
      voiceId: 'Charon',
      genderBucket: 'male',
    });
  });

  it('resolves a female-list voice with genderBucket "female"', () => {
    expect(resolvePersonaVoice({ preferredVoice: 'Leda' }, LISTS)).toEqual({
      voiceId: 'Leda',
      genderBucket: 'female',
    });
  });

  it('trims surrounding whitespace on an otherwise-valid voice', () => {
    expect(resolvePersonaVoice({ preferredVoice: '  Aoede  ' }, LISTS)).toEqual({
      voiceId: 'Aoede',
      genderBucket: 'female',
    });
  });

  it('returns genderBucket null and the trimmed text verbatim for a voice in neither list', () => {
    expect(resolvePersonaVoice({ preferredVoice: 'Nonexistentron' }, LISTS)).toEqual({
      voiceId: 'Nonexistentron',
      genderBucket: null,
    });
  });

  it('falls back to a case-insensitive match and returns the canonical list casing (male)', () => {
    expect(resolvePersonaVoice({ preferredVoice: 'charon' }, LISTS)).toEqual({
      voiceId: 'Charon',
      genderBucket: 'male',
    });
  });

  it('falls back to a case-insensitive match and returns the canonical list casing (female)', () => {
    expect(resolvePersonaVoice({ preferredVoice: 'LEDA' }, LISTS)).toEqual({
      voiceId: 'Leda',
      genderBucket: 'female',
    });
  });
});

describe('buildPersonaVoiceUsage', () => {
  it('groups multiple personas that share one voice', () => {
    const usage = buildPersonaVoiceUsage([
      { slug: 'riya-sen', language: 'bangla', preferredVoice: 'Leda' },
      { slug: 'madhurima-bose', language: 'bangla', preferredVoice: 'Leda' },
      { slug: 'aarav-sharma', language: 'hindi', preferredVoice: 'Puck' },
    ]);

    expect(usage.get('leda')).toEqual([
      { slug: 'riya-sen', language: 'bangla' },
      { slug: 'madhurima-bose', language: 'bangla' },
    ]);
    expect(usage.get('puck')).toEqual([{ slug: 'aarav-sharma', language: 'hindi' }]);
  });

  it('omits personas with no voice set', () => {
    const usage = buildPersonaVoiceUsage([
      { slug: 'no-voice-persona', language: 'english', preferredVoice: null },
      { slug: 'blank-voice-persona', language: 'english', preferredVoice: '   ' },
      { slug: 'kabir-sinha', language: 'hindi', preferredVoice: 'Charon' },
    ]);

    expect(usage.has('no-voice-persona')).toBe(false);
    expect(Array.from(usage.values()).flat()).toEqual([{ slug: 'kabir-sinha', language: 'hindi' }]);
  });

  it('groups casing variants of the same voice under one key', () => {
    const usage = buildPersonaVoiceUsage([
      { slug: 'persona-a', language: 'english', preferredVoice: 'Charon' },
      { slug: 'persona-b', language: 'hindi', preferredVoice: 'charon' },
    ]);

    expect(usage.size).toBe(1);
    expect(usage.get('charon')).toHaveLength(2);
  });
});

describe('buildPersonaVoiceOptions', () => {
  it('puts the unset option first, describing the automatic-selection fallback', () => {
    const options = buildPersonaVoiceOptions({
      lists: LISTS,
      storedVoice: null,
      usage: new Map(),
      currentSlug: 'riya-sen',
      currentLanguage: 'bangla',
    });

    expect(options[0].value).toBe('');
    expect(
      `${options[0].label} ${options[0].hint ?? ''}`.toLowerCase()
    ).toContain('automatic');
  });

  it('includes every voice from both lists', () => {
    const options = buildPersonaVoiceOptions({
      lists: LISTS,
      storedVoice: null,
      usage: new Map(),
      currentSlug: 'riya-sen',
      currentLanguage: 'bangla',
    });

    const values = options.map((option) => option.value);
    for (const voice of [...LISTS.maleVoiceList, ...LISTS.femaleVoiceList]) {
      expect(values).toContain(voice);
    }
  });

  it('never names the current persona as a sharer of its own voice', () => {
    const usage = buildPersonaVoiceUsage([
      { slug: 'riya-sen', language: 'bangla', preferredVoice: 'Leda' },
    ]);

    const options = buildPersonaVoiceOptions({
      lists: LISTS,
      storedVoice: 'Leda',
      usage,
      currentSlug: 'riya-sen',
      currentLanguage: 'bangla',
    });

    const ledaOption = options.find((option) => option.value === 'Leda');
    expect(ledaOption?.hint).not.toContain('riya-sen');
  });

  it('mentions a cross-language sharer without reading as a warning', () => {
    const usage = buildPersonaVoiceUsage([
      { slug: 'riya-sen', language: 'bangla', preferredVoice: 'Leda' },
      { slug: 'niyati-shah', language: 'gujarati', preferredVoice: 'Aoede' },
    ]);

    const options = buildPersonaVoiceOptions({
      lists: LISTS,
      storedVoice: null,
      usage,
      currentSlug: 'riya-sen',
      currentLanguage: 'bangla',
    });

    const aoedeOption = options.find((option) => option.value === 'Aoede');
    expect(aoedeOption?.hint).toContain('niyati-shah');
    expect(aoedeOption?.hint).toContain('gujarati');
    expect(aoedeOption?.hint?.toLowerCase()).not.toContain('warning');
    expect(aoedeOption?.hint?.toLowerCase()).not.toContain('identical');
  });

  it('distinguishes a same-language sharer from a cross-language one', () => {
    const usage = buildPersonaVoiceUsage([
      { slug: 'riya-sen', language: 'bangla', preferredVoice: 'Leda' },
      { slug: 'madhurima-bose', language: 'bangla', preferredVoice: 'Leda' },
      { slug: 'someone-else', language: 'hindi', preferredVoice: 'Leda' },
    ]);

    const options = buildPersonaVoiceOptions({
      lists: LISTS,
      storedVoice: null,
      usage,
      currentSlug: 'riya-sen',
      currentLanguage: 'bangla',
    });

    const ledaOption = options.find((option) => option.value === 'Leda');
    // Same-language sharer (madhurima-bose, bangla) is called out distinctly...
    expect(ledaOption?.hint).toContain('madhurima-bose');
    expect(ledaOption?.hint?.toLowerCase()).toContain('identical');
    // ...while the cross-language sharer (someone-else, hindi) is still named,
    // just not folded into the same-language warning language.
    expect(ledaOption?.hint).toContain('someone-else');
  });

  it('appends a trailing option for a storedVoice that matches neither list', () => {
    const options = buildPersonaVoiceOptions({
      lists: LISTS,
      storedVoice: 'Umbriel',
      usage: new Map(),
      currentSlug: 'mihir-desai',
      currentLanguage: 'gujarati',
    });

    const extra = options[options.length - 1];
    expect(extra.value).toBe('Umbriel');
    expect(extra.hint).toContain('earlier configuration');
  });

  it('does not append a trailing option when storedVoice is already in a list', () => {
    const options = buildPersonaVoiceOptions({
      lists: LISTS,
      storedVoice: 'Charon',
      usage: new Map(),
      currentSlug: 'kabir-sinha',
      currentLanguage: 'hindi',
    });

    const values = options.map((option) => option.value);
    expect(values.filter((value) => value === 'Charon')).toHaveLength(1);
  });

  it('does not append a trailing option when storedVoice is blank', () => {
    const options = buildPersonaVoiceOptions({
      lists: LISTS,
      storedVoice: null,
      usage: new Map(),
      currentSlug: 'kabir-sinha',
      currentLanguage: 'hindi',
    });

    // unset option + 3 male + 3 female, nothing extra
    expect(options).toHaveLength(1 + LISTS.maleVoiceList.length + LISTS.femaleVoiceList.length);
  });
});
