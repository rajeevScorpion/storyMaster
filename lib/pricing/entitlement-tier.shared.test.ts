import { describe, expect, it } from 'vitest';

import { PLAN_KEYS } from '@/lib/types/pricing';
import {
  isPromotedEntitlementTier,
  normalizeEntitlementPlanKey,
  resolveEffectiveEntitlementTier,
} from './entitlement-tier.shared';

// Payments Phase 3, Unit A: 'audience' joined PLAN_KEYS between 'free' and 'plus'.
describe('PLAN_KEYS', () => {
  it('contains audience', () => {
    expect(PLAN_KEYS).toContain('audience');
  });
});

describe('resolveEffectiveEntitlementTier', () => {
  it('leaves an un-promoted account on its billing plan', () => {
    expect(resolveEffectiveEntitlementTier({ billingPlanKey: 'free' })).toBe('free');
    expect(resolveEffectiveEntitlementTier({ billingPlanKey: 'plus', overridePlanKey: null })).toBe('plus');
  });

  it('promotes a free account to the override tier', () => {
    expect(resolveEffectiveEntitlementTier({ billingPlanKey: 'free', overridePlanKey: 'plus' })).toBe('plus');
    expect(resolveEffectiveEntitlementTier({ billingPlanKey: 'free', overridePlanKey: 'studio' })).toBe('studio');
  });

  it('promotes free to audience', () => {
    expect(resolveEffectiveEntitlementTier({ billingPlanKey: 'free', overridePlanKey: 'audience' })).toBe(
      'audience'
    );
  });

  it('promotes audience to plus', () => {
    expect(resolveEffectiveEntitlementTier({ billingPlanKey: 'audience', overridePlanKey: 'plus' })).toBe(
      'plus'
    );
  });

  it('never demotes below what the subscription already pays for', () => {
    expect(resolveEffectiveEntitlementTier({ billingPlanKey: 'plus', overridePlanKey: 'free' })).toBe('plus');
    expect(resolveEffectiveEntitlementTier({ billingPlanKey: 'studio', overridePlanKey: 'plus' })).toBe('studio');
  });

  it('refuses to pull a paying plus account down to audience', () => {
    expect(resolveEffectiveEntitlementTier({ billingPlanKey: 'plus', overridePlanKey: 'audience' })).toBe(
      'plus'
    );
  });

  it('gives the admin account studio entitlements whatever the override says', () => {
    expect(resolveEffectiveEntitlementTier({ billingPlanKey: 'free', isAdmin: true })).toBe('studio');
    expect(
      resolveEffectiveEntitlementTier({ billingPlanKey: 'free', overridePlanKey: 'free', isAdmin: true })
    ).toBe('studio');
  });
});

describe('normalizeEntitlementPlanKey', () => {
  it('accepts the four plan keys and rejects everything else', () => {
    expect(normalizeEntitlementPlanKey('studio')).toBe('studio');
    expect(normalizeEntitlementPlanKey('audience')).toBe('audience');
    expect(normalizeEntitlementPlanKey('creator')).toBeNull();
    expect(normalizeEntitlementPlanKey('')).toBeNull();
    expect(normalizeEntitlementPlanKey(undefined)).toBeNull();
    expect(normalizeEntitlementPlanKey(2)).toBeNull();
  });
});

describe('isPromotedEntitlementTier', () => {
  it('flags only tiers above the billing plan', () => {
    expect(isPromotedEntitlementTier({ billingPlanKey: 'free', entitlementPlanKey: 'plus' })).toBe(true);
    expect(isPromotedEntitlementTier({ billingPlanKey: 'plus', entitlementPlanKey: 'plus' })).toBe(false);
    expect(isPromotedEntitlementTier({ billingPlanKey: 'studio', entitlementPlanKey: 'plus' })).toBe(false);
  });
});
