import { describe, it, expect } from 'vitest';
import { resolveReferenceEntitlements } from './entitlements';
import {
  DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS,
  normalizeReferencePersonalizationSettings,
} from './reference-settings';

const settings = DEFAULT_REFERENCE_PERSONALIZATION_SETTINGS;

describe('resolveReferenceEntitlements', () => {
  it('is fully disabled when the master flag is off', () => {
    const ent = resolveReferenceEntitlements({ masterEnabled: false, planKey: 'plus', settings });
    expect(ent.enabled).toBe(false);
    expect(ent.maxCharacterRefs).toBe(0);
    expect(ent.maxWorldRefs).toBe(0);
  });

  it('resolves Free to 2 character / 1 world, description_only', () => {
    const ent = resolveReferenceEntitlements({ masterEnabled: true, planKey: 'free', settings });
    expect(ent.enabled).toBe(true);
    expect(ent.maxCharacterRefs).toBe(2);
    expect(ent.maxWorldRefs).toBe(1);
    expect(ent.worldAdoptionMode).toBe('description_only');
  });

  it('resolves Plus to 3/3 with canonical world visualization', () => {
    const ent = resolveReferenceEntitlements({ masterEnabled: true, planKey: 'plus', settings });
    expect(ent.maxCharacterRefs).toBe(3);
    expect(ent.maxWorldRefs).toBe(3);
    expect(ent.worldAdoptionMode).toBe('description_plus_canonical_visual');
  });

  it('falls back to the Free row for unknown/legacy plan keys', () => {
    const ent = resolveReferenceEntitlements({ masterEnabled: true, planKey: 'legacy_tier', settings });
    expect(ent.maxCharacterRefs).toBe(2);
    expect(ent.maxWorldRefs).toBe(1);
  });

  it('falls back to the Free row for a null plan key', () => {
    const ent = resolveReferenceEntitlements({ masterEnabled: true, planKey: null, settings });
    expect(ent.maxCharacterRefs).toBe(2);
  });

  it('disables a tier that admin turned off', () => {
    const custom = normalizeReferencePersonalizationSettings({
      tierMatrix: {
        free: { enabled: false, maxCharacterRefs: 2, maxWorldRefs: 1, worldAdoptionMode: 'description_only' },
      } as never,
    });
    const ent = resolveReferenceEntitlements({ masterEnabled: true, planKey: 'free', settings: custom });
    expect(ent.enabled).toBe(false);
  });

  it('forces description_only when the global world-visualization toggle is off', () => {
    const custom = normalizeReferencePersonalizationSettings({
      worldVisualizationEnabled: false,
    });
    const ent = resolveReferenceEntitlements({ masterEnabled: true, planKey: 'studio', settings: custom });
    expect(ent.worldAdoptionMode).toBe('description_only');
    // still allowed to upload worlds, just no canonical visual
    expect(ent.worldsEnabled).toBe(true);
    expect(ent.maxWorldRefs).toBe(3);
  });

  it('disables characters when global charactersEnabled is off', () => {
    const custom = normalizeReferencePersonalizationSettings({ charactersEnabled: false });
    const ent = resolveReferenceEntitlements({ masterEnabled: true, planKey: 'plus', settings: custom });
    expect(ent.charactersEnabled).toBe(false);
    expect(ent.maxCharacterRefs).toBe(0);
    // worlds still on → panel still enabled
    expect(ent.enabled).toBe(true);
  });

  it('disables the panel entirely when both characters and worlds are globally off', () => {
    const custom = normalizeReferencePersonalizationSettings({
      charactersEnabled: false,
      worldsEnabled: false,
    });
    const ent = resolveReferenceEntitlements({ masterEnabled: true, planKey: 'studio', settings: custom });
    expect(ent.enabled).toBe(false);
  });
});
