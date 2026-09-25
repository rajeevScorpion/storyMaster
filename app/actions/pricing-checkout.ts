import 'server-only';

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
import { buildCustomerSnapshot, loadBillingProfile, toBillingProfileDTO } from '@/lib/billing/billing-profile';
import { isBillingProfileComplete } from '@/lib/billing/billing-profile.shared';
import { assertCheckoutAllowed, CheckoutRefusalError } from '@/lib/billing/checkout-guard.shared';
import { isCheckoutOpenForUser } from '@/lib/billing/checkout-allowlist';
import type { CheckoutTimer } from '@/lib/billing/checkout-timing.shared';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type {
  DbBillingProfile,
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
  /** Owner decision P6: required on every checkout attempt, checked by `assertCheckoutAllowed` before
   * any auth or database work. The route reads this from the request body (a missing value counts as
   * `false`); there is no other caller. */
  adultAttested: boolean;
  /** From `resolveActiveViewerProfile()` -- resolved by the route (a cookie-bearing, server-only call)
   * and passed in here so this stays a pure function of its arguments. */
  audienceMode: 'all' | 'kids';
  /** Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): measurement only -- see
   * checkout-timing.shared.ts. Optional so the unit tests that don't care about timing can omit it. */
  timer?: CheckoutTimer;
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
export interface CheckoutTaxContext {
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  taxBreakdown: TaxBreakdown | null;
  ruleId: string | null;
  supplierStateCode: string | null;
  placeOfSupplyStateCode: string | null;
  schemaAvailable: boolean;
  /** Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): the profile this same call already
   * loaded to resolve place-of-supply, handed back so the caller can freeze it into the purchase
   * snapshot's `customer` field without a second read. Null whenever tax wasn't resolved from a
   * profile at all (schema unavailable). */
  profile: DbBillingProfile | null;
}

/**
 * Resolves what to actually charge for `netMinor` (plan §4 Unit B):
 *  - migration 125 absent ("unavailable"): charge the net, exactly as before Phase 2.
 *  - 125 present but no published rule ("not_found"): refuse rather than under-charge.
 *  - 125 present with a published rule: require a declared billing-profile state (place of supply
 *    is a legal requirement, not a preference) and compute tax on top.
 */
/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): exported so `quoteCheckout`
 * (app/actions/billing-account.ts) can price a checkout -- tax included -- without creating a
 * Razorpay order or subscription. Behaviour is unchanged for prepare's own callers.
 */
export async function resolveCheckoutTax(input: {
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
      profile: null,
    };
  }

  if (ruleResult.status === 'not_found') {
    throw new CheckoutRefusalError(
      'Checkout is temporarily unavailable while tax rules are being configured. Please try again shortly.',
      'tax_rules_unavailable',
      503
    );
  }

  const profileResult = await loadBillingProfile(input.supabase, input.userId);

  // The tax-rule table and billing_profiles come from the same migration (125), so this should be
  // unreachable in practice -- but a partially-applied migration must still refuse, not under-charge.
  if (profileResult.status === 'unavailable') {
    throw new CheckoutRefusalError('Checkout is temporarily unavailable. Please try again shortly.', 'billing_schema_unavailable', 503);
  }

  const profile = profileResult.profile;
  // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, owner-approved 2026-09-24, P7): "has a
  // state" is no longer enough -- a profile saved under the old rules can be missing phone, city or
  // PIN. The client already opens the billing dialog on the same isBillingProfileComplete rule
  // (WalletPage.tsx), so only a stale or crafted client ever reaches this refusal.
  if (!profile || !isBillingProfileComplete(toBillingProfileDTO(profile))) {
    throw new CheckoutRefusalError('Please complete your billing details before checkout.', 'billing_details_incomplete', 400);
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
    profile,
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

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, defect 8): the whole checkout surface
 * runs through this one function, called only from app/api/billing/razorpay/prepare/route.ts. This
 * module is `server-only`, not `'use server'`: every `'use server'` export is a public POST endpoint,
 * and this function trusts its caller for `audienceMode` and `adultAttested`, so it must not be one.
 */
export async function prepareRazorpayCheckoutInternal(
  input: PrepareRazorpayCheckoutInput,
  options: PrepareCheckoutOptions
): Promise<PreparedRazorpayCheckout> {
  if (!(await getFeatureFlag('pricing_checkout_enabled', false))) {
    throw new CheckoutRefusalError('Checkout is currently unavailable', 'checkout_disabled', 503);
  }

  // Owner decision P6, right after the flag check and before any auth or database work: a kids
  // profile or a missing attestation refuses immediately, with no side effects to unwind.
  const refusal = assertCheckoutAllowed({ audienceMode: options.audienceMode, adultAttested: options.adultAttested });
  if (refusal) {
    throw new CheckoutRefusalError(refusal.message, refusal.code, 403);
  }

  const timer = options.timer;
  const auth = await getAuthenticatedUser();
  timer?.mark('auth');

  // Payments Phase 7 (docs/payments/phase-7-plan.md §8, Unit B2, decision R3): the named-account
  // rollout, right after auth resolves (it needs a userId) and before any catalogue or provider
  // work. A missing/off flag row means no restriction -- see isCheckoutOpenForUser's own comment.
  if (!(await isCheckoutOpenForUser(auth.userId))) {
    throw new CheckoutRefusalError("Payments aren't open yet. We'll let you know when they are.", 'not_in_rollout', 403);
  }

  const supabase = createAdminClient();

  if (input.kind === 'subscription') {
    const version = await loadPlanVersionForCheckout(supabase, input.planVersionId, options.pricingMarketKey ?? null);
    await assertBetaMarketAllowed(version.pricing_market_key);
    const plan = await loadPlanById(supabase, version.plan_id);

    if (plan.plan_key === 'free' || version.price_minor <= 0) {
      throw new CheckoutRefusalError('This plan is not purchasable', 'not_purchasable', 400);
    }

    if (version.provider === 'razorpay' && version.billing_interval === 'annual') {
      throw new CheckoutRefusalError(
        'Yearly checkout is not available yet for the India market. Please use a monthly plan while we test monthly refills end to end.',
        'annual_unavailable',
        400
      );
    }
    timer?.mark('catalogue');

    const providerMode = getRazorpayMode();
    const tax = await resolveCheckoutTax({
      supabase,
      userId: auth.userId,
      appliesTo: 'subscription',
      netMinor: version.price_minor,
    });
    timer?.mark('tax');

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
      // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): who was billed, frozen at
      // checkout time -- the ledger's recordPayment fills this into the payment row once and never
      // rewrites it, so a later profile edit never reaches a past charge.
      customer: buildCustomerSnapshot(tax.profile),
      // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, owner decision P6): the gate above
      // already confirmed adultAttested is true, so this is always "now" -- recorded per purchase, not
      // on the profile, per the owner's decision to avoid a migration for it.
      adultAttestedAt: new Date().toISOString(),
    };

    const beginResult = await supabase.rpc('billing_begin_subscription_checkout', {
      p_user_id: auth.userId,
      p_plan_version_id: version.id,
      p_provider_mode: providerMode,
      p_snapshot: snapshot,
    });

    throwIfQueryFailed(beginResult.error, 'Failed to begin subscription checkout');
    timer?.mark('rpc');

    const beginRow = (beginResult.data?.[0] ?? null) as BillingBeginSubscriptionCheckoutRow | null;
    if (!beginRow) {
      throw new Error('Failed to begin subscription checkout');
    }

    if (beginRow.blocked_reason === 'subscription_exists') {
      throw new CheckoutRefusalError(
        'You already have a plan. To switch, cancel it in Billing. You can choose a new plan once it ends.',
        'subscription_exists',
        409
      );
    }

    if (beginRow.blocked_reason === 'checkout_in_progress') {
      throw new CheckoutRefusalError('A checkout is already opening in another tab', 'checkout_in_progress', 409);
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
        userPhone: tax.profile?.phone ?? null,
        reused: true,
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
      timer?.mark('plan_ref');

      if (planRef.reused && planRef.grossMinor === null && tax.taxMinor > 0) {
        // 125 applied but 126 not: tax is being charged, yet the plan cache is still keyed on mode
        // alone, so a plan created before Phase 2 is reused and Razorpay debits the old net while
        // this order records the gross. A freshly created plan is fine -- it was created at the
        // gross just quoted -- so only reuse is refused. The two migrations are meant to be applied
        // together (docs/payments/audit-progress.md).
        throw new CheckoutRefusalError(
          'Subscription checkout is temporarily unavailable pending a database update. Please try again shortly.',
          'plan_ref_stale',
          503
        );
      }

      if (planRef.grossMinor !== null && planRef.grossMinor !== tax.grossMinor) {
        // A concurrent request created/reused a plan at a different gross (e.g. a rate change mid-flight).
        // Refuse rather than charge a subscription at an amount that doesn't match what we just quoted.
        throw new CheckoutRefusalError('Pricing changed while preparing checkout. Please try again.', 'pricing_changed', 409);
      }

      // Payments Phase 6 (docs/payments/phase-6-plan.md §10, Unit C2, hook 7): once Kissago's own
      // billing emails are live, Razorpay's own subscription notifications are switched off so the
      // customer isn't emailed twice for the same charge.
      const customerNotify = !(await getFeatureFlag('billing_emails_enabled', false));
      subscription = await createRazorpaySubscription({
        planId: planRef.razorpayPlanId,
        interval: version.billing_interval,
        expireByUnix: Math.floor(Date.now() / 1000) + 30 * 60,
        notes: {
          user_id: auth.userId,
          plan_version_id: version.id,
          pricing_market_key: version.pricing_market_key,
        },
        customerNotify,
      });
      timer?.mark('provider_create');
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
    timer?.mark('order_write');

    return {
      kind: 'subscription',
      keyId: getRazorpayKeyId(),
      internalOrderId: orderId,
      razorpaySubscriptionId: subscription.id,
      displayName: 'Kissago',
      description: `${plan.name} plan · ${labelInterval(version.billing_interval)}`,
      userName: auth.userName,
      userEmail: auth.userEmail,
      userPhone: tax.profile?.phone ?? null,
      reused: false,
    };
  }

  const topup = await loadTopupPackForCheckout(supabase, input.topupPackId, options.pricingMarketKey ?? null);
  await assertBetaMarketAllowed(topup.pricing_market_key);
  if (topup.price_minor <= 0) {
    throw new CheckoutRefusalError('This coin pack is not purchasable', 'not_purchasable', 400);
  }
  timer?.mark('catalogue');

  const providerMode = getRazorpayMode();
  const tax = await resolveCheckoutTax({
    supabase,
    userId: auth.userId,
    appliesTo: 'topup',
    netMinor: topup.price_minor,
  });
  timer?.mark('tax');

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
  timer?.mark('provider_create');

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
        // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A): see the matching comment on
        // the subscription snapshot above.
        customer: buildCustomerSnapshot(tax.profile),
        // Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1, owner decision P6): see the
        // matching comment on the subscription snapshot above.
        adultAttestedAt: new Date().toISOString(),
      },
      raw_provider_payload_json: redactRazorpayPayload({
        kind: 'topup',
        order,
      }),
    })
    .select('id')
    .single();

  throwIfQueryFailed(orderInsertResult.error, 'Failed to create top-up checkout order');
  timer?.mark('order_write');

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
    userPhone: tax.profile?.phone ?? null,
    reused: false,
  };
}

export async function assertBetaMarketAllowed(pricingMarketKey: PricingMarketKey): Promise<void> {
  if (pricingMarketKey !== 'IN' && await getFeatureFlag('pricing_india_only_beta_enabled', true)) {
    throw new CheckoutRefusalError('Kissago paid beta checkout is currently available in India only.', 'market_restricted', 400);
  }
}

export async function getAuthenticatedUser(): Promise<{
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
    throw new CheckoutRefusalError('Please sign in before starting checkout', 'sign_in_required', 401);
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

export async function loadPlanVersionForCheckout(
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
    throw new CheckoutRefusalError('This plan checkout is not available yet', 'plan_version_unavailable', 400);
  }

  if (pricingMarketKey && version.pricing_market_key !== pricingMarketKey) {
    throw new CheckoutRefusalError('This plan does not belong to the selected market', 'market_mismatch', 400);
  }

  return version;
}

export async function loadPlanById(
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

export async function loadTopupPackForCheckout(
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
    throw new CheckoutRefusalError('This top-up is not available yet', 'topup_unavailable', 400);
  }

  if (pricingMarketKey && topup.pricing_market_key !== pricingMarketKey) {
    throw new CheckoutRefusalError('This coin pack does not belong to the selected market', 'market_mismatch', 400);
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

export function labelInterval(value: DbPricingPlanVersion['billing_interval']): string {
  return value === 'annual' ? 'Yearly' : 'Monthly';
}
