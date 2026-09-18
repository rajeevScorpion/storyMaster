'use server';

import {
  cancelRazorpaySubscription,
  createRazorpayOrder,
  createRazorpayPlan,
  createRazorpaySubscription,
  getRazorpayKeyId,
  getRazorpayMode,
  type RazorpayMode,
  type RazorpaySubscription,
} from '@/lib/billing/razorpay';
import { redactRazorpayPayload } from '@/lib/billing/razorpay-redact.shared';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { getPublishedTaxRule } from '@/lib/billing/tax-rules';
import { computeTax, type TaxBreakdown } from '@/lib/billing/tax.shared';
import { loadBillingProfile } from '@/lib/billing/billing-profile';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type {
  DbPricingPlan,
  DbPricingPlanVersion,
  DbPricingTopupPack,
} from '@/lib/types/database';
import type {
  PrepareRazorpayCheckoutInput,
  PreparedRazorpayCheckout,
  PricingMarketKey,
} from '@/lib/types/pricing';

interface PrepareCheckoutOptions {
  pricingMarketKey?: PricingMarketKey | null;
}

interface BillingBeginSubscriptionCheckoutRow {
  order_id: string | null;
  reused: boolean;
  provider_checkout_session_id: string | null;
  superseded_session_ids: string[] | null;
  blocked_reason: string | null;
}

/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit B): checkout charges tax, on top of the
 * GST-exclusive catalogue price. `schemaAvailable` is false exactly when migration 125 is absent --
 * callers use it to decide whether it's safe to write `subject_ref` on a new billing_orders /
 * billing_subscriptions row (that column doesn't exist without 125 either, same migration file).
 */
interface CheckoutTaxContext {
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  taxBreakdown: TaxBreakdown | null;
  ruleId: string | null;
  supplierStateCode: string | null;
  placeOfSupplyStateCode: string | null;
  schemaAvailable: boolean;
}

/**
 * Resolves what to actually charge for `netMinor` (plan §4 Unit B):
 *  - migration 125 absent ("unavailable"): charge the net, exactly as before Phase 2.
 *  - 125 present but no published rule ("not_found"): refuse rather than under-charge.
 *  - 125 present with a published rule: require a declared billing-profile state (place of supply
 *    is a legal requirement, not a preference) and compute tax on top.
 */
async function resolveCheckoutTax(input: {
  supabase: ReturnType<typeof createAdminClient>;
  userId: string;
  appliesTo: 'subscription' | 'topup';
  netMinor: number;
}): Promise<CheckoutTaxContext> {
  const ruleResult = await getPublishedTaxRule('IN', input.appliesTo);

  if (ruleResult.status === 'unavailable') {
    return {
      netMinor: input.netMinor,
      taxMinor: 0,
      grossMinor: input.netMinor,
      taxBreakdown: null,
      ruleId: null,
      supplierStateCode: null,
      placeOfSupplyStateCode: null,
      schemaAvailable: false,
    };
  }

  if (ruleResult.status === 'not_found') {
    throw new Error('Checkout is temporarily unavailable while tax rules are being configured. Please try again shortly.');
  }

  const profileResult = await loadBillingProfile(input.supabase, input.userId);

  // The tax-rule table and billing_profiles come from the same migration (125), so this should be
  // unreachable in practice -- but a partially-applied migration must still refuse, not under-charge.
  if (profileResult.status === 'unavailable') {
    throw new Error('Checkout is temporarily unavailable. Please try again shortly.');
  }

  const profile = profileResult.profile;
  if (!profile || !profile.state_code) {
    throw new Error('Please add your billing details (state) before checkout.');
  }

  const result = computeTax({
    netMinor: input.netMinor,
    rule: ruleResult.rule,
    supplierStateCode: ruleResult.rule.supplierStateCode,
    placeOfSupplyStateCode: profile.state_code,
  });

  return {
    netMinor: result.netMinor,
    taxMinor: result.taxMinor,
    grossMinor: result.grossMinor,
    taxBreakdown: result.breakdown,
    ruleId: ruleResult.rule.id,
    supplierStateCode: ruleResult.rule.supplierStateCode,
    placeOfSupplyStateCode: profile.state_code,
    schemaAvailable: true,
  };
}

function taxSnapshotFields(tax: CheckoutTaxContext) {
  return {
    netMinor: tax.netMinor,
    taxMinor: tax.taxMinor,
    grossMinor: tax.grossMinor,
    tax: tax.taxBreakdown
      ? {
          ruleId: tax.ruleId,
          supplierStateCode: tax.supplierStateCode,
          placeOfSupplyStateCode: tax.placeOfSupplyStateCode,
          breakdown: tax.taxBreakdown,
        }
      : null,
  };
}

export async function prepareRazorpayCheckout(
  input: PrepareRazorpayCheckoutInput,
  options: PrepareCheckoutOptions = {}
): Promise<PreparedRazorpayCheckout> {
  return prepareRazorpayCheckoutInternal(input, options);
}

export async function prepareRazorpayCheckoutInternal(
  input: PrepareRazorpayCheckoutInput,
  options: PrepareCheckoutOptions = {}
): Promise<PreparedRazorpayCheckout> {
  if (!(await getFeatureFlag('pricing_checkout_enabled', false))) {
    throw new Error('Checkout is currently unavailable');
  }

  const auth = await getAuthenticatedUser();
  const supabase = createAdminClient();

  if (input.kind === 'subscription') {
    const version = await loadPlanVersionForCheckout(supabase, input.planVersionId, options.pricingMarketKey ?? null);
    await assertBetaMarketAllowed(version.pricing_market_key);
    const plan = await loadPlanById(supabase, version.plan_id);

    if (plan.plan_key === 'free' || version.price_minor <= 0) {
      throw new Error('This plan is not purchasable');
    }

    if (version.provider === 'razorpay' && version.billing_interval === 'annual') {
      throw new Error('Yearly checkout is not available yet for the India market. Please use a monthly plan while we test monthly refills end to end.');
    }

    const providerMode = getRazorpayMode();
    const tax = await resolveCheckoutTax({
      supabase,
      userId: auth.userId,
      appliesTo: 'subscription',
      netMinor: version.price_minor,
    });

    const snapshot = {
      kind: 'subscription',
      planVersionId: version.id,
      planKey: plan.plan_key,
      planName: plan.name,
      interval: version.billing_interval,
      amountMinor: tax.grossMinor,
      currencyCode: version.currency_code,
      includedBeats: version.monthly_included_beats,
      pricingMarketKey: version.pricing_market_key,
      providerMode,
      ...taxSnapshotFields(tax),
    };

    const beginResult = await supabase.rpc('billing_begin_subscription_checkout', {
      p_user_id: auth.userId,
      p_plan_version_id: version.id,
      p_provider_mode: providerMode,
      p_snapshot: snapshot,
    });

    throwIfQueryFailed(beginResult.error, 'Failed to begin subscription checkout');

    const beginRow = (beginResult.data?.[0] ?? null) as BillingBeginSubscriptionCheckoutRow | null;
    if (!beginRow) {
      throw new Error('Failed to begin subscription checkout');
    }

    if (beginRow.blocked_reason === 'subscription_exists') {
      throw new Error('You already have a Razorpay subscription in progress. Subscription changes will stay manual until account management is live.');
    }

    if (beginRow.blocked_reason === 'checkout_in_progress') {
      throw new Error('A checkout is already opening in another tab');
    }

    if (beginRow.reused) {
      if (!beginRow.provider_checkout_session_id) {
        throw new Error('Failed to resume subscription checkout');
      }

      return {
        kind: 'subscription',
        keyId: getRazorpayKeyId(),
        internalOrderId: beginRow.order_id!,
        razorpaySubscriptionId: beginRow.provider_checkout_session_id,
        displayName: 'Kissago',
        description: `${plan.name} plan · ${labelInterval(version.billing_interval)}`,
        userName: auth.userName,
        userEmail: auth.userEmail,
      };
    }

    for (const supersededId of beginRow.superseded_session_ids ?? []) {
      try {
        await cancelRazorpaySubscription({ subscriptionId: supersededId, atCycleEnd: false });
      } catch (err) {
        console.error('[pricing-checkout] failed to cancel superseded subscription', {
          subscriptionId: supersededId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const orderId = beginRow.order_id;
    if (!orderId) {
      throw new Error('Failed to begin subscription checkout');
    }

    let subscription: RazorpaySubscription;
    try {
      const planRef = await ensureRazorpayPlanRef(supabase, version, plan, providerMode, tax.grossMinor);

      if (planRef.reused && planRef.grossMinor === null && tax.taxMinor > 0) {
        // 125 applied but 126 not: tax is being charged, yet the plan cache is still keyed on mode
        // alone, so a plan created before Phase 2 is reused and Razorpay debits the old net while
        // this order records the gross. A freshly created plan is fine -- it was created at the
        // gross just quoted -- so only reuse is refused. The two migrations are meant to be applied
        // together (docs/payments/audit-progress.md).
        throw new Error('Subscription checkout is temporarily unavailable pending a database update. Please try again shortly.');
      }

      if (planRef.grossMinor !== null && planRef.grossMinor !== tax.grossMinor) {
        // A concurrent request created/reused a plan at a different gross (e.g. a rate change mid-flight).
        // Refuse rather than charge a subscription at an amount that doesn't match what we just quoted.
        throw new Error('Pricing changed while preparing checkout. Please try again.');
      }

      subscription = await createRazorpaySubscription({
        planId: planRef.razorpayPlanId,
        interval: version.billing_interval,
        expireByUnix: Math.floor(Date.now() / 1000) + 30 * 60,
        notes: {
          user_id: auth.userId,
          plan_version_id: version.id,
          pricing_market_key: version.pricing_market_key,
        },
      });
    } catch (err) {
      const failUpdate = await supabase
        .from('billing_orders')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', orderId);

      throwIfQueryFailed(failUpdate.error, 'Failed to mark subscription checkout order failed');
      throw err;
    }

    const orderUpdateResult = await supabase
      .from('billing_orders')
      .update({
        provider_checkout_session_id: subscription.id,
        status: subscription.status,
        // billing_begin_subscription_checkout (migration 124) always inserts amount_minor as the
        // catalogue net price -- fix it up to the gross we actually quoted and are about to charge.
        amount_minor: tax.grossMinor,
        ...(tax.schemaAvailable ? { subject_ref: auth.userId } : {}),
        raw_provider_payload_json: redactRazorpayPayload({
          kind: 'subscription',
          subscription,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    throwIfQueryFailed(orderUpdateResult.error, 'Failed to update subscription checkout order');

    return {
      kind: 'subscription',
      keyId: getRazorpayKeyId(),
      internalOrderId: orderId,
      razorpaySubscriptionId: subscription.id,
      displayName: 'Kissago',
      description: `${plan.name} plan · ${labelInterval(version.billing_interval)}`,
      userName: auth.userName,
      userEmail: auth.userEmail,
    };
  }

  const topup = await loadTopupPackForCheckout(supabase, input.topupPackId, options.pricingMarketKey ?? null);
  await assertBetaMarketAllowed(topup.pricing_market_key);
  if (topup.price_minor <= 0) {
    throw new Error('This coin pack is not purchasable');
  }

  const providerMode = getRazorpayMode();
  const tax = await resolveCheckoutTax({
    supabase,
    userId: auth.userId,
    appliesTo: 'topup',
    netMinor: topup.price_minor,
  });

  const receipt = `kissago_${topup.pack_key}_${Date.now()}`;
  const order = await createRazorpayOrder({
    amountMinor: tax.grossMinor,
    currencyCode: topup.currency_code,
    receipt,
    notes: {
      user_id: auth.userId,
      topup_pack_id: topup.id,
      pricing_market_key: topup.pricing_market_key,
    },
  });

  const orderInsertResult = await supabase
    .from('billing_orders')
    .insert({
      user_id: auth.userId,
      ...(tax.schemaAvailable ? { subject_ref: auth.userId } : {}),
      provider: 'razorpay',
      provider_mode: providerMode,
      order_type: 'topup_checkout',
      provider_order_id: order.id,
      currency_code: topup.currency_code,
      amount_minor: tax.grossMinor,
      status: order.status,
      topup_pack_id: topup.id,
      purchase_snapshot_json: {
        kind: 'topup',
        topupPackId: topup.id,
        packKey: topup.pack_key,
        packName: topup.name,
        beatAmount: topup.beat_amount,
        amountMinor: tax.grossMinor,
        currencyCode: topup.currency_code,
        pricingMarketKey: topup.pricing_market_key,
        providerMode,
        ...taxSnapshotFields(tax),
      },
      raw_provider_payload_json: redactRazorpayPayload({
        kind: 'topup',
        order,
      }),
    })
    .select('id')
    .single();

  throwIfQueryFailed(orderInsertResult.error, 'Failed to create top-up checkout order');

  return {
    kind: 'topup',
    keyId: getRazorpayKeyId(),
    internalOrderId: orderInsertResult.data!.id,
    razorpayOrderId: order.id,
    amountMinor: tax.grossMinor,
    currencyCode: topup.currency_code,
    displayName: 'Kissago',
    description: topup.name,
    userName: auth.userName,
    userEmail: auth.userEmail,
  };
}

async function assertBetaMarketAllowed(pricingMarketKey: PricingMarketKey): Promise<void> {
  if (pricingMarketKey !== 'IN' && await getFeatureFlag('pricing_india_only_beta_enabled', true)) {
    throw new Error('Kissago paid beta checkout is currently available in India only.');
  }
}

async function getAuthenticatedUser(): Promise<{
  userId: string;
  userEmail: string | null;
  userName: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Please sign in before starting checkout');
  }

  return {
    userId: user.id,
    userEmail: user.email ?? null,
    userName:
      (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.length > 0
        ? user.user_metadata.full_name
        : null) ??
      (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.length > 0
        ? user.user_metadata.name
        : null),
  };
}

async function loadPlanVersionForCheckout(
  supabase: ReturnType<typeof createAdminClient>,
  planVersionId: string,
  pricingMarketKey: PricingMarketKey | null
): Promise<DbPricingPlanVersion> {
  const result = await supabase
    .from('pricing_plan_versions')
    .select('*')
    .eq('id', planVersionId)
    .eq('status', 'published')
    .eq('provider', 'razorpay')
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load plan version');

  const version = (result.data ?? null) as DbPricingPlanVersion | null;
  if (!version) {
    throw new Error('This plan checkout is not available yet');
  }

  if (pricingMarketKey && version.pricing_market_key !== pricingMarketKey) {
    throw new Error('This plan does not belong to the selected market');
  }

  return version;
}

async function loadPlanById(
  supabase: ReturnType<typeof createAdminClient>,
  planId: string
): Promise<DbPricingPlan> {
  const result = await supabase
    .from('pricing_plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load plan');

  const plan = (result.data ?? null) as DbPricingPlan | null;
  if (!plan) {
    throw new Error('Plan not found');
  }

  return plan;
}

async function loadTopupPackForCheckout(
  supabase: ReturnType<typeof createAdminClient>,
  topupPackId: string,
  pricingMarketKey: PricingMarketKey | null
): Promise<DbPricingTopupPack> {
  const result = await supabase
    .from('pricing_topup_packs')
    .select('*')
    .eq('id', topupPackId)
    .eq('status', 'published')
    .eq('provider', 'razorpay')
    .maybeSingle();

  throwIfQueryFailed(result.error, 'Failed to load top-up pack');

  const topup = (result.data ?? null) as DbPricingTopupPack | null;
  if (!topup) {
    throw new Error('This top-up is not available yet');
  }

  if (pricingMarketKey && topup.pricing_market_key !== pricingMarketKey) {
    throw new Error('This coin pack does not belong to the selected market');
  }

  return topup;
}

interface EnsureRazorpayPlanRefResult {
  razorpayPlanId: string;
  /** null when the database has no provider_price_ref_gross_minor column (migration 126 absent) --
   * the caller can't verify the gross matched and must not compare against it. */
  grossMinor: number | null;
  /** True when a previously stored plan ref was returned as-is. A reused ref was created at some
   * earlier amount; a freshly created one was created at the gross just quoted. The caller needs the
   * difference to tell "unverifiable but known-correct" from "unverifiable and possibly stale". */
  reused: boolean;
}

/**
 * A stored ref is reused only when it was created in the same mode AND (migration 126 present) at
 * the same gross amount -- plan §2 decision 7, "one Razorpay plan per gross amount". Without 126
 * (the `provider_price_ref_gross_minor` column structurally absent from the row -- see
 * DbPricingPlanVersion), this falls back to today's mode-only reuse. Otherwise a new Razorpay plan
 * is created and the winning update also stamps the mode and gross; a losing concurrent request
 * just leaves one orphan Razorpay plan (harmless), and the re-select below returns whatever
 * actually persisted.
 */
async function ensureRazorpayPlanRef(
  supabase: ReturnType<typeof createAdminClient>,
  version: DbPricingPlanVersion,
  plan: DbPricingPlan,
  mode: RazorpayMode,
  grossMinor: number
): Promise<EnsureRazorpayPlanRefResult> {
  const hasGrossColumn = Object.prototype.hasOwnProperty.call(version, 'provider_price_ref_gross_minor');
  const storedGross = hasGrossColumn ? version.provider_price_ref_gross_minor ?? null : null;

  const canReuse =
    Boolean(version.provider_price_ref) &&
    version.provider_price_ref_mode === mode &&
    (!hasGrossColumn || storedGross === grossMinor);

  if (canReuse) {
    return { razorpayPlanId: version.provider_price_ref as string, grossMinor: hasGrossColumn ? storedGross : null, reused: true };
  }

  const createdPlan = await createRazorpayPlan({
    interval: version.billing_interval,
    amountMinor: grossMinor,
    currencyCode: version.currency_code,
    name: `${plan.name} ${labelInterval(version.billing_interval)}`,
    description: plan.description,
    notes: {
      plan_key: plan.plan_key,
      plan_version_id: version.id,
      pricing_market_key: version.pricing_market_key,
    },
  });

  const updatePayload: Record<string, unknown> = {
    provider_product_ref: createdPlan.item.id,
    provider_price_ref: createdPlan.id,
    provider_price_ref_mode: mode,
    updated_at: new Date().toISOString(),
  };
  if (hasGrossColumn) {
    updatePayload.provider_price_ref_gross_minor = grossMinor;
  }

  const orFilter = hasGrossColumn
    ? `provider_price_ref_mode.is.null,provider_price_ref_mode.neq.${mode},provider_price_ref_gross_minor.is.null,provider_price_ref_gross_minor.neq.${grossMinor}`
    : `provider_price_ref_mode.is.null,provider_price_ref_mode.neq.${mode}`;

  const updateResult = await supabase
    .from('pricing_plan_versions')
    .update(updatePayload)
    .eq('id', version.id)
    .or(orFilter);

  throwIfQueryFailed(updateResult.error, 'Failed to persist Razorpay plan reference');

  const reselectResult = await supabase
    .from('pricing_plan_versions')
    .select(hasGrossColumn ? 'provider_price_ref, provider_price_ref_gross_minor' : 'provider_price_ref')
    .eq('id', version.id)
    .maybeSingle();

  throwIfQueryFailed(reselectResult.error, 'Failed to load Razorpay plan reference');

  const reselected = reselectResult.data as
    | { provider_price_ref: string | null; provider_price_ref_gross_minor?: number | null }
    | null;
  const providerPriceRef = reselected?.provider_price_ref;
  if (!providerPriceRef) {
    throw new Error('Failed to resolve Razorpay plan reference');
  }

  return {
    razorpayPlanId: providerPriceRef,
    grossMinor: hasGrossColumn ? (reselected?.provider_price_ref_gross_minor ?? null) : null,
    reused: false,
  };
}

function throwIfQueryFailed(error: { message: string } | null, context: string): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function labelInterval(value: DbPricingPlanVersion['billing_interval']): string {
  return value === 'annual' ? 'Yearly' : 'Monthly';
}
