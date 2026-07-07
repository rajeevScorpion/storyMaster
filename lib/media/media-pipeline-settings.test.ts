import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MEDIA_PIPELINE_SETTINGS,
  normalizeCanaryUserIds,
  normalizeMediaPipelineSettings,
  normalizeMediaProcessingMode,
  parseMediaPipelineSettingsValue,
  resolveEffectiveProcessingModeShared,
} from './media-pipeline-settings';

describe('normalizeMediaProcessingMode', () => {
  it('accepts known modes', () => {
    expect(normalizeMediaProcessingMode('client_legacy')).toBe('client_legacy');
    expect(normalizeMediaProcessingMode('server_pipeline')).toBe('server_pipeline');
    expect(normalizeMediaProcessingMode('hybrid_canary')).toBe('hybrid_canary');
  });

  it('falls back to client_legacy for unknown input', () => {
    expect(normalizeMediaProcessingMode('server')).toBe('client_legacy');
    expect(normalizeMediaProcessingMode(null)).toBe('client_legacy');
    expect(normalizeMediaProcessingMode(undefined)).toBe('client_legacy');
    expect(normalizeMediaProcessingMode(42)).toBe('client_legacy');
  });
});

describe('normalizeCanaryUserIds', () => {
  it('parses a JSON string array and trims entries', () => {
    expect(normalizeCanaryUserIds('["a", " b ", ""]')).toEqual(['a', 'b']);
  });

  it('accepts an already-parsed array', () => {
    expect(normalizeCanaryUserIds(['x', 3, 'y'])).toEqual(['x', 'y']);
  });

  it('returns empty for malformed input', () => {
    expect(normalizeCanaryUserIds('not json')).toEqual([]);
    expect(normalizeCanaryUserIds('{"a":1}')).toEqual([]);
    expect(normalizeCanaryUserIds(null)).toEqual([]);
  });
});

describe('normalizeMediaPipelineSettings', () => {
  it('returns defaults for empty input', () => {
    expect(normalizeMediaPipelineSettings(null)).toEqual(DEFAULT_MEDIA_PIPELINE_SETTINGS);
    expect(normalizeMediaPipelineSettings(undefined)).toEqual(DEFAULT_MEDIA_PIPELINE_SETTINGS);
  });

  it('clamps out-of-range numbers', () => {
    const settings = normalizeMediaPipelineSettings({
      freeRetentionHours: -5,
      displayWebpQuality: 500,
      cleanupBatchSize: 0,
      maxAttempts: 99,
    });
    expect(settings.freeRetentionHours).toBe(0);
    expect(settings.displayWebpQuality).toBe(100);
    expect(settings.cleanupBatchSize).toBe(1);
    expect(settings.maxAttempts).toBe(10);
  });

  it('coerces string booleans', () => {
    const settings = normalizeMediaPipelineSettings({
      cleanupEnabled: 'false' as unknown as boolean,
      variantsForBulkJobs: 'true' as unknown as boolean,
    });
    expect(settings.cleanupEnabled).toBe(false);
    expect(settings.variantsForBulkJobs).toBe(true);
  });
});

describe('parseMediaPipelineSettingsValue', () => {
  it('parses the stored JSON blob', () => {
    const parsed = parseMediaPipelineSettingsValue('{"plusRetentionDays": 14}');
    expect(parsed.plusRetentionDays).toBe(14);
    expect(parsed.studioRetentionDays).toBe(DEFAULT_MEDIA_PIPELINE_SETTINGS.studioRetentionDays);
  });

  it('falls back to defaults on malformed JSON or null', () => {
    expect(parseMediaPipelineSettingsValue('nope')).toEqual(DEFAULT_MEDIA_PIPELINE_SETTINGS);
    expect(parseMediaPipelineSettingsValue(null)).toEqual(DEFAULT_MEDIA_PIPELINE_SETTINGS);
  });
});

describe('resolveEffectiveProcessingModeShared', () => {
  const base = {
    canaryUserIds: ['canary-user'],
    userId: 'canary-user',
    serverPipelineAvailable: true,
  };

  it('forces client_legacy when the server pipeline is unavailable', () => {
    expect(
      resolveEffectiveProcessingModeShared({ ...base, mode: 'server_pipeline', serverPipelineAvailable: false })
    ).toBe('client_legacy');
    expect(
      resolveEffectiveProcessingModeShared({ ...base, mode: 'hybrid_canary', serverPipelineAvailable: false })
    ).toBe('client_legacy');
  });

  it('routes server_pipeline mode to the server flow', () => {
    expect(resolveEffectiveProcessingModeShared({ ...base, mode: 'server_pipeline' })).toBe('server_pipeline');
  });

  it('keeps client_legacy mode on the legacy flow', () => {
    expect(resolveEffectiveProcessingModeShared({ ...base, mode: 'client_legacy' })).toBe('client_legacy');
  });

  it('routes only allowlisted users in hybrid_canary mode', () => {
    expect(resolveEffectiveProcessingModeShared({ ...base, mode: 'hybrid_canary' })).toBe('server_pipeline');
    expect(
      resolveEffectiveProcessingModeShared({ ...base, mode: 'hybrid_canary', userId: 'other-user' })
    ).toBe('client_legacy');
    expect(
      resolveEffectiveProcessingModeShared({ ...base, mode: 'hybrid_canary', userId: null })
    ).toBe('client_legacy');
  });
});
