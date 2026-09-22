import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface ResolveSubscriptionIncludedBeatsInput {
  supabase: AdminClient;
  providerSubscriptionId: string | null;
  planVersionId: string | null;
}

/**
 * Payments Phase 4, owner decision 16: whether a subscription payment's plan "genuinely" included
 * zero coins, so a refund with no matching beat_grants row can proceed with nothing to claw back
 * instead of refusing (Audience, decision 12's "no coin grant was found" would otherwise refuse
 * every Audience refund -- Audience is 0 coins by design, not a data bug).
 *
 * Resolves at the SAME precedence lib/billing/razorpay-sync.ts uses when granting a cycle's coins
 * (search "includedBeats" there, syncSubscriptionFromProvider): the checkout order's frozen
 * purchase_snapshot_json.includedBeats first -- what was actually sold, which survives a later
 * catalogue price/coin change -- falling back to the plan version's current
 * monthly_included_beats. Deliberately NOT the other way around: preferring the live plan version
 * would let an admin's later edit to the catalogue rewrite what a past purchase is refunded as.
 *
 * Returns null when neither can be resolved (no checkout order found, no snapshot field, no plan
 * version, or any query error) -- callers must treat null as "cannot prove this was zero-coin" and
 * refuse rather than guess. A coin-bearing purchase whose grant is merely missing must still refuse
 * exactly as before decision 16.
 */
export async function resolveSubscriptionIncludedBeats(
  input: ResolveSubscriptionIncludedBeatsInput
): Promise<number | null> {
  const { supabase, providerSubscriptionId, planVersionId } = input;

  if (providerSubscriptionId) {
    const orderResult = await supabase
      .from('billing_orders')
      .select('purchase_snapshot_json')
      .eq('provider', 'razorpay')
      .eq('provider_checkout_session_id', providerSubscriptionId)
      .maybeSingle();

    if (!orderResult.error && orderResult.data) {
      const snapshot = (orderResult.data as { purchase_snapshot_json: Record<string, unknown> | null })
        .purchase_snapshot_json as { includedBeats?: number } | null;
      if (snapshot && typeof snapshot.includedBeats === 'number') {
        return snapshot.includedBeats;
      }
    }
  }

  if (!planVersionId) return null;

  const planResult = await supabase
    .from('pricing_plan_versions')
    .select('monthly_included_beats')
    .eq('id', planVersionId)
    .maybeSingle();

  if (planResult.error || !planResult.data) return null;
  const includedBeats = (planResult.data as { monthly_included_beats: number }).monthly_included_beats;
  return typeof includedBeats === 'number' ? includedBeats : null;
}
