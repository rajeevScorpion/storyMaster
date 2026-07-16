import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REFERENCE_INPUT_MODE,
  DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS,
  REFERENCE_PLATFORM_MAX_CHARACTER_REFS,
  REFERENCE_PLATFORM_MAX_WORLD_REFS,
  normalizeReferenceInputMode,
  normalizeReferencePersonalizationSettings,
  parseReferencePersonalizationSettingsValue,
  serializeReferencePersonalizationSettings,
} from './reference-settings';

describe('normalizeReferencePersonalizationSettings', () => {
  it('returns defaults for empty input', () => {
    expect(normalizeReferencePersonalizationSettings(undefined)).toEqual(
      DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS
    );
    expect(normalizeReferencePersonalizationSettings({})).toEqual(
      DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS
    );
  });

  it('seeds Free at 2 character / 1 world with description_only worlds', () => {
    const free = DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS.tierMatrix.free;
    expect(free.maxCharacterRefs).toBe(2);
    expect(free.maxWorldRefs).toBe(1);
    expect(free.worldAdoptionMode).toBe('description_only');
  });

  it('clamps tier limits to the platform ceiling', () => {
    const normalized = normalizeReferencePersonalizationSettings({
      tierMatrix: {
        free: { enabled: true, maxCharacterRefs: 99, maxWorldRefs: 99, worldAdoptionMode: 'description_only' },
        plus: { enabled: true, maxCharacterRefs: 3, maxWorldRefs: 3, worldAdoptionMode: 'description_plus_canonical_visual' },
        studio: { enabled: true, maxCharacterRefs: 3, maxWorldRefs: 3, worldAdoptionMode: 'description_plus_canonical_visual' },
      },
    });
    expect(normalized.tierMatrix.free.maxCharacterRefs).toBe(REFERENCE_PLATFORM_MAX_CHARACTER_REFS);
    expect(normalized.tierMatrix.free.maxWorldRefs).toBe(REFERENCE_PLATFORM_MAX_WORLD_REFS);
  });

  it('clamps negatives to zero and rounds fractions', () => {
    const normalized = normalizeReferencePersonalizationSettings({
      tierMatrix: {
        free: { maxCharacterRefs: -5, maxWorldRefs: 1.6 } as never,
      } as never,
    });
    expect(normalized.tierMatrix.free.maxCharacterRefs).toBe(0);
    expect(normalized.tierMatrix.free.maxWorldRefs).toBe(2);
  });

  it('clamps operational knobs into range', () => {
    const normalized = normalizeReferencePersonalizationSettings({
      maxAttempts: 100,
      staleReclaimMinutes: 0,
      maxFileSizeMb: 999,
      minDimensionPx: 1,
      abandonedSetupTtlHours: 100000,
    });
    expect(normalized.maxAttempts).toBe(5);
    expect(normalized.staleReclaimMinutes).toBe(2);
    expect(normalized.maxFileSizeMb).toBe(15);
    expect(normalized.minDimensionPx).toBe(128);
    expect(normalized.abandonedSetupTtlHours).toBe(720);
  });

  it('coerces string booleans', () => {
    const normalized = normalizeReferencePersonalizationSettings({
      charactersEnabled: 'false' as never,
      pauseNewAdoptions: 'true' as never,
    });
    expect(normalized.charactersEnabled).toBe(false);
    expect(normalized.pauseNewAdoptions).toBe(true);
  });

  it('round-trips through serialize/parse', () => {
    const custom = normalizeReferencePersonalizationSettings({
      worldVisualizationEnabled: false,
      tierMatrix: {
        plus: { enabled: false, maxCharacterRefs: 1, maxWorldRefs: 0, worldAdoptionMode: 'description_only' },
      } as never,
    });
    const raw = serializeReferencePersonalizationSettings(custom);
    expect(parseReferencePersonalizationSettingsValue(raw)).toEqual(custom);
  });

  it('parse falls back to defaults on malformed JSON', () => {
    expect(parseReferencePersonalizationSettingsValue('{not json')).toEqual(
      DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS
    );
    expect(parseReferencePersonalizationSettingsValue(null)).toEqual(
      DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS
    );
  });
});

describe('normalizeReferenceInputMode', () => {
  it('accepts the two valid modes', () => {
    expect(normalizeReferenceInputMode('adoption')).toBe('adoption');
    expect(normalizeReferenceInputMode('direct')).toBe('direct');
  });

  it('falls back to the default (direct) for anything else', () => {
    expect(DEFAULT_REFERENCE_INPUT_MODE).toBe('direct');
    expect(normalizeReferenceInputMode('')).toBe('direct');
    expect(normalizeReferenceInputMode(null)).toBe('direct');
    expect(normalizeReferenceInputMode('legacy')).toBe('direct');
    expect(normalizeReferenceInputMode(42)).toBe('direct');
  });
});
