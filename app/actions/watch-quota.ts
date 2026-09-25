'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { peekWatchQuota } from '@/lib/pricing/watch-quota';
import type { WatchQuotaView } from '@/lib/pricing/watch-quota.shared';

/**
 * Payments Phase 3, Unit D (docs/payments/phase-3-plan.md §6): what the reader has left today and
 * which plan lifts the limit, in one round trip, WITHOUT spending a slot.
 *
 * Both halves are here rather than in `loadStorylineWithBeats` because the UI needs them *before*
 * it commits the reader: to show how many opens are left, and to ask before the last one goes.
 * A call that answered by consuming could do neither.
 */
export async function getWatchQuotaView(storylineId: string): Promise<WatchQuotaView> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Signed out: the quota is a signed-in concept (the enforcement point sits behind the auth
  // guard), so report unrestricted rather than inventing a number for someone who has none.
  if (!user) {
    return { unlimited: true, used: 0, limit: 0, isReplay: false, upsell: null };
  }

  const status = await peekWatchQuota({ userId: user.id, storylineId });
  return {
    ...status,
    upsell: status.unlimited ? null : await loadWatchUpsellOffer(),
  };
}

/**
 * The cheapest published plan that actually grants `unlimitedWatching` -- resolved from the
 * catalogue, never named as a literal.
 *
 * The plan text says the upsell should offer Audience rather than Plus, and this is how that stays
 * true: if Audience is unpublished in a market, or an admin turns the capability off for it, the
 * offer moves to whatever the next tier that really grants it is, instead of sending a reader to a
 * checkout that does not solve their problem. Returns null when nothing on offer grants it, which
 * is a catalogue that cannot be upsold out of -- the caller shows no offer rather than a dead one.
 */
async function loadWatchUpsellOffer(): Promise<WatchQuotaView['upsell']> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('pricing_plans')
    .select('plan_key, name, tier_rank, is_active, is_public, feature_flags_json')
    .eq('is_active', true)
    .eq('is_public', true)
    .order('tier_rank', { ascending: true });

  if (error) {
    console.warn('[watch-quota] could not load the upsell offer:', error.message);
    return null;
  }

  const rows = (data as {
    plan_key: string;
    name: string;
    tier_rank: number;
    feature_flags_json: { unlimitedWatching?: boolean } | null;
  }[] | null) ?? [];

  // `unlimitedWatching` defaults TRUE when absent (see PricingPlanFeatureFlags), so `?? true` here
  // matches the normalizer and the snapshot rather than treating an untouched plan as limited.
  const granting = rows.find((row) => (row.feature_flags_json?.unlimitedWatching ?? true) === true);
  if (!granting) return null;

  return { planKey: granting.plan_key, name: granting.name };
}
