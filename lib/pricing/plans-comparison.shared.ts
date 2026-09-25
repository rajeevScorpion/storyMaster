/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit G execution spec): the pure pieces of
 * `/plans` -- what a plan's price cell says, what its CTA is, and the readable labels for watching
 * and video export quality. Pure and isomorphic (CLAUDE.md's `.shared.ts` split) so the CTA table is
 * unit-tested without mounting `PlansComparison`.
 *
 * CTA priority mirrors the execution spec's own order: Free first (it has no price row and no CTA),
 * then a missing/₹0 price on a paid plan ("Coming soon", never "₹0"), then sign-in, then the
 * signed-in states. `switchAfter` covers both an upgrade and a downgrade candidate alike -- P2 (owner
 * decision, phase-5-plan.md §3) is (a): no in-place plan change this phase, so any paid-to-paid move
 * goes through cancel-in-Billing-then-resubscribe regardless of direction. Last, Payments Phase 7
 * (docs/payments/phase-7-plan.md §8, Unit B2): a free-tier signed-in user who would otherwise get a
 * live checkout link gets "Coming soon" instead while checkout is closed for them (globally, or by
 * the named-account rollout) -- the same state a missing price already used, since both mean
 * "nothing to click yet".
 */

import type { PlanKey, VideoExportPreset } from '@/lib/types/pricing';

export interface PlansCtaOffer {
  planKey: PlanKey;
  name: string;
  isCurrentPlan: boolean;
  monthlyPlanVersionId: string | null;
  monthlyPriceMinor: number | null;
}

export type PlansCtaState =
  | { kind: 'free' }
  | { kind: 'coming_soon' }
  | { kind: 'sign_in'; label: string }
  | { kind: 'current'; label: string }
  | { kind: 'switch_after'; label: string }
  | { kind: 'checkout'; label: string; planVersionId: string };

export function resolvePlansCta(input: {
  offer: PlansCtaOffer;
  currentPlanKey: PlanKey;
  userId: string | null;
  /** Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2, decision R3): the global kill
   * switch AND the named-account rollout, already combined by getPricingRuntimeContext's
   * `controls.pricingCheckoutEnabled`. Without this, an unlisted user (or anyone while the kill
   * switch is off) saw a live "Choose <plan>" link that only refused on click. */
  checkoutEnabled: boolean;
}): PlansCtaState {
  const { offer, currentPlanKey, userId, checkoutEnabled } = input;

  if (offer.planKey === 'free') {
    return { kind: 'free' };
  }

  if (!offer.monthlyPlanVersionId || offer.monthlyPriceMinor == null || offer.monthlyPriceMinor <= 0) {
    return { kind: 'coming_soon' };
  }

  if (!userId) {
    return { kind: 'sign_in', label: `Sign in to choose ${offer.name}` };
  }

  if (offer.isCurrentPlan) {
    return { kind: 'current', label: 'Your plan' };
  }

  if (currentPlanKey !== 'free') {
    return { kind: 'switch_after', label: 'Switch after your plan ends' };
  }

  if (!checkoutEnabled) {
    return { kind: 'coming_soon' };
  }

  return { kind: 'checkout', label: `Choose ${offer.name}`, planVersionId: offer.monthlyPlanVersionId };
}

/** "₹200 / month + GST", "Free", or "Coming soon" -- the same missing/₹0 test resolvePlansCta uses,
 * so a plan never shows a price its own CTA disagrees with. `priceLabel` is the formatted "₹200" the
 * caller already has (e.g. from formatCurrencyMinor) -- this function only decides which of the three
 * strings applies and appends the interval and tax suffix. */
export function formatPlanPriceCell(input: {
  planKey: PlanKey;
  monthlyPriceMinor: number | null;
  priceLabel: string;
}): string {
  if (input.planKey === 'free') {
    return 'Free';
  }
  if (input.monthlyPriceMinor == null || input.monthlyPriceMinor <= 0) {
    return 'Coming soon';
  }
  return `${input.priceLabel} / month + GST`;
}

/** "Unlimited", or "{n} stories a day" off the pricing control -- never a literal number in the caller. */
export function describeWatchAllowance(unlimitedWatching: boolean, freeDailyWatchQuota: number): string {
  if (unlimitedWatching) {
    return 'Unlimited';
  }
  return `${freeDailyWatchQuota} ${freeDailyWatchQuota === 1 ? 'story' : 'stories'} a day`;
}

/** A readable label for the plan's video export quality. Only two resolutions exist today
 * (VIDEO_EXPORT_VERTICAL_RESOLUTIONS); this reads the preset rather than the plan tier, so it stays
 * correct if an admin ever moves which tier carries which resolution. */
export function describeVideoExportQuality(preset: VideoExportPreset): string {
  return preset.verticalResolution === '1080x1920' ? '1080p vertical video' : '720p vertical video';
}
