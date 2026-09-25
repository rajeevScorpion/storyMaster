import { describe, it, expect } from 'vitest';
import {
  describeVideoExportQuality,
  describeWatchAllowance,
  formatPlanPriceCell,
  resolvePlansCta,
  type PlansCtaOffer,
} from './plans-comparison.shared';

function offer(overrides: Partial<PlansCtaOffer> & Pick<PlansCtaOffer, 'planKey'>): PlansCtaOffer {
  return {
    name: overrides.planKey.charAt(0).toUpperCase() + overrides.planKey.slice(1),
    isCurrentPlan: false,
    monthlyPlanVersionId: 'version-1',
    monthlyPriceMinor: 20000,
    ...overrides,
  };
}

describe('resolvePlansCta', () => {
  it('Free has no price and no CTA regardless of sign-in or price fields', () => {
    const free = offer({ planKey: 'free', monthlyPlanVersionId: null, monthlyPriceMinor: 0 });
    expect(resolvePlansCta({ offer: free, currentPlanKey: 'free', userId: null, checkoutEnabled: true })).toEqual({ kind: 'free' });
    expect(resolvePlansCta({ offer: free, currentPlanKey: 'free', userId: 'user-1', checkoutEnabled: true })).toEqual({ kind: 'free' });
  });

  it('a paid plan with a missing plan version is Coming soon, not ₹0', () => {
    const audience = offer({ planKey: 'audience', monthlyPlanVersionId: null });
    expect(resolvePlansCta({ offer: audience, currentPlanKey: 'free', userId: 'user-1', checkoutEnabled: true })).toEqual({ kind: 'coming_soon' });
  });

  it('a paid plan with a null or ₹0 price is Coming soon, not ₹0', () => {
    const nullPrice = offer({ planKey: 'studio', monthlyPriceMinor: null });
    const zeroPrice = offer({ planKey: 'studio', monthlyPriceMinor: 0 });
    expect(resolvePlansCta({ offer: nullPrice, currentPlanKey: 'free', userId: 'user-1', checkoutEnabled: true })).toEqual({ kind: 'coming_soon' });
    expect(resolvePlansCta({ offer: zeroPrice, currentPlanKey: 'free', userId: 'user-1', checkoutEnabled: true })).toEqual({ kind: 'coming_soon' });
  });

  it('signed out: "Sign in to choose <Plan>"', () => {
    const audience = offer({ planKey: 'audience', name: 'Audience' });
    expect(resolvePlansCta({ offer: audience, currentPlanKey: 'free', userId: null, checkoutEnabled: true })).toEqual({
      kind: 'sign_in',
      label: 'Sign in to choose Audience',
    });
  });

  it('signed in, current plan: "Your plan", disabled', () => {
    const plus = offer({ planKey: 'plus', isCurrentPlan: true });
    expect(resolvePlansCta({ offer: plus, currentPlanKey: 'plus', userId: 'user-1', checkoutEnabled: true })).toEqual({
      kind: 'current',
      label: 'Your plan',
    });
  });

  it('signed in, no paid plan: a checkout link carrying the monthly plan version id', () => {
    const plus = offer({ planKey: 'plus', name: 'Plus', monthlyPlanVersionId: 'plan-version-plus' });
    expect(resolvePlansCta({ offer: plus, currentPlanKey: 'free', userId: 'user-1', checkoutEnabled: true })).toEqual({
      kind: 'checkout',
      label: 'Choose Plus',
      planVersionId: 'plan-version-plus',
    });
  });

  it('signed in, already on a different paid plan (P2(a)): "Switch after your plan ends", for both an upgrade and a downgrade candidate', () => {
    const studio = offer({ planKey: 'studio' });
    const audience = offer({ planKey: 'audience' });
    expect(resolvePlansCta({ offer: studio, currentPlanKey: 'plus', userId: 'user-1', checkoutEnabled: true })).toEqual({
      kind: 'switch_after',
      label: 'Switch after your plan ends',
    });
    expect(resolvePlansCta({ offer: audience, currentPlanKey: 'plus', userId: 'user-1', checkoutEnabled: true })).toEqual({
      kind: 'switch_after',
      label: 'Switch after your plan ends',
    });
  });

  // Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2, decision R3): the global kill
  // switch and the named-account rollout both collapse into this one boolean by the time it
  // reaches here (getPricingRuntimeContext / controls.pricingCheckoutEnabled).
  describe('checkoutEnabled = false (kill switch off, or this account is not in the rollout)', () => {
    it('is Coming soon for a free-tier signed-in user who would otherwise get a checkout link', () => {
      const plus = offer({ planKey: 'plus', name: 'Plus', monthlyPlanVersionId: 'plan-version-plus' });
      expect(resolvePlansCta({ offer: plus, currentPlanKey: 'free', userId: 'user-1', checkoutEnabled: false })).toEqual({
        kind: 'coming_soon',
      });
    });

    it('still shows Free, sign-in, current, and switch-after unchanged -- those are not gated on checkout', () => {
      const free = offer({ planKey: 'free', monthlyPlanVersionId: null, monthlyPriceMinor: 0 });
      const plus = offer({ planKey: 'plus', isCurrentPlan: true });
      const studio = offer({ planKey: 'studio' });

      expect(resolvePlansCta({ offer: free, currentPlanKey: 'free', userId: 'user-1', checkoutEnabled: false })).toEqual({ kind: 'free' });
      expect(resolvePlansCta({ offer: plus, currentPlanKey: 'free', userId: null, checkoutEnabled: false })).toEqual({
        kind: 'sign_in',
        label: 'Sign in to choose Plus',
      });
      expect(resolvePlansCta({ offer: plus, currentPlanKey: 'plus', userId: 'user-1', checkoutEnabled: false })).toEqual({
        kind: 'current',
        label: 'Your plan',
      });
      expect(resolvePlansCta({ offer: studio, currentPlanKey: 'plus', userId: 'user-1', checkoutEnabled: false })).toEqual({
        kind: 'switch_after',
        label: 'Switch after your plan ends',
      });
    });
  });
});

describe('formatPlanPriceCell', () => {
  it('shows Free for the free plan, never a ₹ price', () => {
    expect(formatPlanPriceCell({ planKey: 'free', monthlyPriceMinor: 0, priceLabel: '₹0', currencyCode: 'INR' })).toBe('Free');
  });

  it('shows Coming soon for a missing or ₹0 price on a paid plan', () => {
    expect(formatPlanPriceCell({ planKey: 'studio', monthlyPriceMinor: null, priceLabel: '₹0', currencyCode: 'INR' })).toBe('Coming soon');
    expect(formatPlanPriceCell({ planKey: 'studio', monthlyPriceMinor: 0, priceLabel: '₹0', currencyCode: 'INR' })).toBe('Coming soon');
  });

  it('shows the GST-exclusive price with the monthly + GST suffix for INR', () => {
    expect(formatPlanPriceCell({ planKey: 'plus', monthlyPriceMinor: 85000, priceLabel: '₹850', currencyCode: 'INR' })).toBe('₹850 / month + GST');
  });

  // Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): GST is an Indian tax, so a non-INR
  // (export) price never carries the suffix.
  it('omits the GST suffix for a non-INR price', () => {
    expect(formatPlanPriceCell({ planKey: 'plus', monthlyPriceMinor: 2900, priceLabel: '$29', currencyCode: 'USD' })).toBe('$29 / month');
  });
});

describe('describeWatchAllowance', () => {
  it('is Unlimited when the plan carries unlimitedWatching', () => {
    expect(describeWatchAllowance(true, 3)).toBe('Unlimited');
  });

  it('reads the quota off the control, never a literal', () => {
    expect(describeWatchAllowance(false, 3)).toBe('3 stories a day');
    expect(describeWatchAllowance(false, 7)).toBe('7 stories a day');
  });

  it('singularizes a quota of exactly one', () => {
    expect(describeWatchAllowance(false, 1)).toBe('1 story a day');
  });
});

describe('describeVideoExportQuality', () => {
  it('labels the 720 vertical preset', () => {
    expect(describeVideoExportQuality({
      verticalResolution: '720x1280',
      watermarkMode: 'auto',
      watermarkPosition: 'top-left',
      watermarkSize: 'medium',
    })).toBe('720p vertical video');
  });

  it('labels the 1080 vertical preset', () => {
    expect(describeVideoExportQuality({
      verticalResolution: '1080x1920',
      watermarkMode: 'auto',
      watermarkPosition: 'top-left',
      watermarkSize: 'medium',
    })).toBe('1080p vertical video');
  });
});
