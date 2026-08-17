import { PLAN_KEYS, type PlanKey } from '@/lib/types/pricing';

/**
 * The entitlement tier is what every free/plus/studio feature gate reads. It is
 * deliberately *not* the billing plan: an admin can promote an account so it can
 * use tier-gated features (storyboard images, HD export, tier-gated image models)
 * without any subscription, coin grant, or wallet change. Coins are charged
 * exactly as before — promotion buys access, never balance.
 *
 * Billing truth stays on `snapshot.planKey`; anything that reports what a user
 * pays for (wallet page, plan offers, admin directory) must keep reading that.
 */

/** Ascending. A higher rank is a superset of every rank below it. */
const PLAN_TIER_RANK: Record<PlanKey, number> = {
  free: 0,
  plus: 1,
  studio: 2,
};

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === 'string' && (PLAN_KEYS as readonly string[]).includes(value);
}

export function normalizeEntitlementPlanKey(value: unknown): PlanKey | null {
  return isPlanKey(value) ? value : null;
}

/**
 * Promote-only: the override lifts access but never takes away what someone
 * paid for, so setting a paying Plus account to 'free' leaves them on Plus and
 * simply clears the promotion. The admin account always resolves to studio —
 * otherwise the person who hands out promotions cannot use the features.
 */
export function resolveEffectiveEntitlementTier(input: {
  billingPlanKey: PlanKey;
  overridePlanKey?: PlanKey | null;
  isAdmin?: boolean;
}): PlanKey {
  if (input.isAdmin) {
    return 'studio';
  }

  const override = input.overridePlanKey ?? null;
  if (!override) {
    return input.billingPlanKey;
  }

  return PLAN_TIER_RANK[override] > PLAN_TIER_RANK[input.billingPlanKey]
    ? override
    : input.billingPlanKey;
}

/** True when the effective tier is higher than what billing alone would give. */
export function isPromotedEntitlementTier(input: {
  billingPlanKey: PlanKey;
  entitlementPlanKey: PlanKey;
}): boolean {
  return PLAN_TIER_RANK[input.entitlementPlanKey] > PLAN_TIER_RANK[input.billingPlanKey];
}
