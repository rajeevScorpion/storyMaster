import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXPORT_PRESETS,
  getDefaultAvailablePreset,
  normalizeExportPresets,
  resolveExportPresetsForPlan,
  serializeExportPresets,
} from './presets';

describe('normalizeExportPresets', () => {
  it('falls back to the recommended defaults for missing or malformed config', () => {
    expect(normalizeExportPresets(null)).toEqual(DEFAULT_EXPORT_PRESETS);
    expect(normalizeExportPresets('not json {')).toEqual(DEFAULT_EXPORT_PRESETS);
    expect(normalizeExportPresets('[]')).toEqual(DEFAULT_EXPORT_PRESETS);
    expect(normalizeExportPresets(42)).toEqual(DEFAULT_EXPORT_PRESETS);
  });

  it('round-trips the serialized default presets', () => {
    const parsed = normalizeExportPresets(serializeExportPresets(DEFAULT_EXPORT_PRESETS));
    expect(parsed).toEqual(DEFAULT_EXPORT_PRESETS);
  });

  it('clamps out-of-range values and forces even H.264 dimensions', () => {
    const [preset] = normalizeExportPresets(JSON.stringify([{
      id: 'sd',
      width: 721,
      height: 999999,
      fps: 45,
      videoBitrate: 1,
      audioBitrate: 999_999_999,
      audioSampleRate: 12345,
      allowedTiers: ['free', 'bogus', 'free'],
      sortOrder: -5,
    }]));

    expect(preset.width % 2).toBe(0);
    expect(preset.width).toBe(720);
    expect(preset.height).toBe(2160);
    expect(preset.fps).toBe(30);
    expect(preset.videoBitrate).toBe(500_000);
    expect(preset.audioBitrate).toBe(320_000);
    expect(preset.audioSampleRate).toBe(48_000);
    expect(preset.allowedTiers).toEqual(['free']);
    expect(preset.sortOrder).toBe(0);
  });

  it('drops duplicate ids and sorts by sortOrder', () => {
    const presets = normalizeExportPresets(JSON.stringify([
      { id: 'hd', sortOrder: 20 },
      { id: 'sd', sortOrder: 5 },
      { id: 'sd', sortOrder: 99 },
    ]));

    expect(presets.map((preset) => preset.id)).toEqual(['sd', 'hd']);
  });
});

describe('resolveExportPresetsForPlan', () => {
  it('gives free users SD available and HD locked, hiding admin-only presets', () => {
    const resolved = resolveExportPresetsForPlan(DEFAULT_EXPORT_PRESETS, 'free', false);

    expect(resolved.map((preset) => [preset.id, preset.availability])).toEqual([
      ['sd', 'available'],
      ['hd', 'locked'],
    ]);
    expect(getDefaultAvailablePreset(resolved)?.id).toBe('sd');
  });

  it('gives plus and studio users both SD and HD', () => {
    for (const plan of ['plus', 'studio'] as const) {
      const resolved = resolveExportPresetsForPlan(DEFAULT_EXPORT_PRESETS, plan, false);
      expect(resolved.map((preset) => [preset.id, preset.availability])).toEqual([
        ['sd', 'available'],
        ['hd', 'available'],
      ]);
    }
  });

  it('excludes disabled presets entirely', () => {
    const presets = DEFAULT_EXPORT_PRESETS.map((preset) => (
      preset.id === 'hd' ? { ...preset, enabled: false } : preset
    ));
    const resolved = resolveExportPresetsForPlan(presets, 'studio', false);
    expect(resolved.map((preset) => preset.id)).toEqual(['sd']);
  });

  it('shows admins every enabled preset, including admin-only, as available', () => {
    const presets = DEFAULT_EXPORT_PRESETS.map((preset) => ({ ...preset, enabled: true }));
    const resolved = resolveExportPresetsForPlan(presets, 'free', true);
    expect(resolved.map((preset) => [preset.id, preset.availability])).toEqual([
      ['sd', 'available'],
      ['hd', 'available'],
      ['ultra-smooth', 'available'],
    ]);
  });
});
