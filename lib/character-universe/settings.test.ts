import { describe, expect, it } from 'vitest';
import {
  CHARACTER_UNIVERSE_FLAG_KEYS,
  DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS,
  RUNTIME_SETTING_BY_FLAG_KEY,
} from './settings';

describe('character-universe settings', () => {
  it('fails closed: every default is off', () => {
    expect(Object.values(DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS)).toEqual(
      Object.values(DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS).map(() => false)
    );
  });

  it('maps every flag key to a distinct runtime setting', () => {
    const mapped = CHARACTER_UNIVERSE_FLAG_KEYS.map((key) => RUNTIME_SETTING_BY_FLAG_KEY[key]);
    expect(new Set(mapped).size).toBe(CHARACTER_UNIVERSE_FLAG_KEYS.length);
    for (const setting of mapped) {
      expect(setting in DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS).toBe(true);
    }
  });

  it('covers every runtime setting with a flag', () => {
    expect(Object.keys(DEFAULT_CHARACTER_UNIVERSE_RUNTIME_SETTINGS).sort()).toEqual(
      [...new Set(Object.values(RUNTIME_SETTING_BY_FLAG_KEY))].sort()
    );
  });
});
