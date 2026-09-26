import 'server-only';

import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import { parseCheckoutAllowlist } from '@/lib/billing/checkout-guard.shared';

/**
 * Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2, decision R3): the named-account
 * rollout. `enabled` on the `billing_checkout_allowlist` row means checkout is RESTRICTED to the
 * ids in its `value` column -- the inverse of most flags in this codebase, where on means
 * "available" (the operational-flags panel's help text says so explicitly). Off, or the row missing
 * entirely (migration 137 not yet applied on this database), means no restriction at all -- the
 * global kill switch (`pricing_checkout_enabled`, checked separately in
 * `prepareRazorpayCheckoutInternal`) is the only thing that can still refuse everyone.
 *
 * `getFeatureFlag`/`getFeatureFlagValue` never throw -- a read error returns the given fallback (or
 * `null`), so a Supabase outage here reads as "not restricted", not as an outage of its own. That
 * sounds unsafe in isolation, but the kill switch is read with the exact same fail-to-`false`
 * behaviour, and `false` there means "checkout disabled" -- so the same outage that makes this read
 * "open" also makes the kill switch refuse the checkout anyway. Checkout is shut either way; only
 * the reason differs.
 */
export async function isCheckoutOpenForUser(userId: string | null): Promise<boolean> {
  const restricted = await getFeatureFlag('billing_checkout_allowlist', false);
  if (!restricted) {
    return true;
  }

  // A signed-out visitor can never be on the list -- there is no id to check it against, and
  // `prepareRazorpayCheckoutInternal` refuses a signed-out checkout separately anyway.
  if (!userId) {
    return false;
  }

  const value = await getFeatureFlagValue('billing_checkout_allowlist');
  const allowlist = parseCheckoutAllowlist(value);
  return allowlist.includes(userId.trim().toLowerCase());
}
