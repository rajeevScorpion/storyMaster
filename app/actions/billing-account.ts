'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getFeatureFlag } from '@/lib/ai/model-config';
import { resolveActiveViewerProfile } from '@/lib/viewer-profile';
import { assertCheckoutAllowed, CheckoutRefusalError } from '@/lib/billing/checkout-guard.shared';
import { checkoutStateFromOrder } from '@/lib/billing/checkout-status.shared';
import type { CheckoutOrderState } from '@/lib/billing/checkout-status.shared';
import { addBillingInterval, taxLinesFromBreakdown } from '@/lib/billing/checkout-quote.shared';
import type { CheckoutQuote } from '@/lib/billing/checkout-quote.shared';
import { cancelRazorpaySubscription, getRazorpayMode, type RazorpayMode } from '@/lib/billing/razorpay';
import { syncSubscriptionFromProvider } from '@/lib/billing/razorpay-sync';
import { isMissingBillingSchemaError } from '@/lib/billing/schema-availability.shared';
import { enqueueBillingJob } from '@/lib/billing/notifications/queue';
import {
  methodLabel,
  paymentDescription,
  pickCurrentSubscription,
  type BillingDocumentOverview,
  type BillingPaymentOverview,
  type BillingSubscriptionOverview,
  type GetMyBillingOverviewResult,
} from '@/lib/billing/billing-account.shared';
import {
  assertBetaMarketAllowed,
  getAuthenticatedUser,
  loadPlanById,
  loadPlanVersionForCheckout,
  loadTopupPackForCheckout,
  resolveCheckoutTax,
} from '@/app/actions/pricing-checkout';
import { COINS_PER_BEAT } from '@/lib/types/pricing';
import type { BillingInterval, PrepareRazorpayCheckoutInput, PricingMarketKey } from '@/lib/types/pricing';
import type { TaxBreakdown } from '@/lib/billing/tax.shared';
import type { DbBillingOrder, DbBillingPayment, DbBillingRefund, DbPricingPlanVersion } from '@/lib/types/database';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): the self-serve checkout-status
 * lookup useRazorpayCheckout's dismiss poll calls after the customer closes the Razorpay window
 * without the handler ever firing (defect 5 -- a UPI approval can still land after the window is
 * gone). No provider call: the webhook and verify already converge billing_orders, so this only reads
 * what is already recorded.
 */

export interface CheckoutStatusResult {
  state: CheckoutOrderState;
}

async function getAuthenticatedUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error('Please sign in to check checkout status');
  }

  return user.id;
}

/** Scoped by id AND user_id, so a missing row and someone else's order both resolve to `abandoned` --
 * an unknown or foreign id leaks nothing about whether it exists. */
export async function getMyCheckoutStatus(internalOrderId: string): Promise<CheckoutStatusResult> {
  const userId = await getAuthenticatedUserId();
  const supabase = createAdminClient();

  const orderResult = await supabase
    .from('billing_orders')
    .select('*')
    .eq('id', internalOrderId)
    .eq('user_id', userId)
    .maybeSingle();

  const order = orderResult.error ? null : ((orderResult.data ?? null) as DbBillingOrder | null);
  if (!order) {
    return { state: 'abandoned' };
  }

  let firstChargeConfirmedAt: string | null = null;
  if (order.order_type === 'subscription_checkout' && order.provider_checkout_session_id) {
    const subscriptionResult = await supabase
      .from('billing_subscriptions')
      .select('first_charge_confirmed_at')
      .eq('provider', 'razorpay')
      .eq('provider_subscription_id', order.provider_checkout_session_id)
      .maybeSingle();

    firstChargeConfirmedAt = subscriptionResult.error
      ? null
      : ((subscriptionResult.data as { first_charge_confirmed_at: string | null } | null)?.first_charge_confirmed_at ?? null);
  }

  return {
    state: checkoutStateFromOrder({
      orderType: order.order_type,
      status: order.status,
      firstChargeConfirmedAt,
    }),
  };
}

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): the checkout summary sheet's price.
 * Runs the same catalogue load, beta-market check and resolveCheckoutTax as
 * prepareRazorpayCheckoutInternal, and creates nothing -- no RPC, no Razorpay order or subscription,
 * no billing_orders row. Resolves its own audienceMode (unlike prepare's internal function, which
 * trusts its caller) because this export is itself the whole surface, reachable directly as a
 * `'use server'` action -- there is no separate route to resolve it first.
 */
export type QuoteCheckoutResult =
  | { ok: true; quote: CheckoutQuote }
  | { ok: false; needsBillingDetails: true }
  | { ok: false; error: string };

export async function quoteCheckout(
  input: PrepareRazorpayCheckoutInput,
  pricingMarketKey?: PricingMarketKey | null
): Promise<QuoteCheckoutResult> {
  try {
    if (!(await getFeatureFlag('pricing_checkout_enabled', false))) {
      throw new CheckoutRefusalError('Checkout is currently unavailable', 'checkout_disabled', 503);
    }

    // Owner decision P6: kids checkout refuses here too, even though the wallet already hides the
    // buttons in kids mode -- a stale or crafted client should learn nothing new. adultAttested is
    // always true for a quote: attestation is about paying, not about seeing a price.
    const { audienceMode } = await resolveActiveViewerProfile();
    const refusal = assertCheckoutAllowed({ audienceMode, adultAttested: true });
    if (refusal) {
      throw new CheckoutRefusalError(refusal.message, refusal.code, 403);
    }

    const auth = await getAuthenticatedUser();
    const supabase = createAdminClient();

    const quote =
      input.kind === 'subscription'
        ? await quoteSubscription(supabase, auth.userId, input.planVersionId, pricingMarketKey ?? null)
        : await quoteTopup(supabase, auth.userId, input.topupPackId, pricingMarketKey ?? null);

    return { ok: true, quote };
  } catch (err) {
    if (err instanceof CheckoutRefusalError) {
      if (err.code === 'billing_details_incomplete') {
        return { ok: false, needsBillingDetails: true };
      }
      return { ok: false, error: err.message };
    }
    console.error('[checkout.quote]', err);
    return { ok: false, error: "We couldn't load the price. Please try again in a moment." };
  }
}

async function quoteSubscription(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  planVersionId: string,
  pricingMarketKey: PricingMarketKey | null
): Promise<CheckoutQuote> {
  const version = await loadPlanVersionForCheckout(supabase, planVersionId, pricingMarketKey);
  await assertBetaMarketAllowed(version.pricing_market_key);
  const plan = await loadPlanById(supabase, version.plan_id);

  if (plan.plan_key === 'free' || version.price_minor <= 0) {
    throw new CheckoutRefusalError('This plan is not purchasable', 'not_purchasable', 400);
  }

  // Mirrors prepare's own annual refusal (pricing-checkout.ts) -- latent today since no annual
  // version is published, so loadPlanVersionForCheckout can't return one in practice yet.
  if (version.provider === 'razorpay' && version.billing_interval === 'annual') {
    throw new CheckoutRefusalError(
      'Yearly checkout is not available yet for the India market. Please use a monthly plan while we test monthly refills end to end.',
      'annual_unavailable',
      400
    );
  }

  const tax = await resolveCheckoutTax({ supabase, userId, appliesTo: 'subscription', netMinor: version.price_minor });

  return {
    kind: 'subscription',
    title: plan.name,
    currencyCode: version.currency_code,
    netMinor: tax.netMinor,
    taxMinor: tax.taxMinor,
    grossMinor: tax.grossMinor,
    ratePercent: tax.taxBreakdown?.ratePercent ?? null,
    taxLines: taxLinesFromBreakdown(tax.taxBreakdown),
    coins: beatsToCoins(version.monthly_included_beats),
    interval: version.billing_interval,
    nextChargeDate: addBillingInterval(new Date(), version.billing_interval).toISOString(),
  };
}

async function quoteTopup(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  topupPackId: string,
  pricingMarketKey: PricingMarketKey | null
): Promise<CheckoutQuote> {
  const topup = await loadTopupPackForCheckout(supabase, topupPackId, pricingMarketKey);
  await assertBetaMarketAllowed(topup.pricing_market_key);

  if (topup.price_minor <= 0) {
    throw new CheckoutRefusalError('This coin pack is not purchasable', 'not_purchasable', 400);
  }

  const tax = await resolveCheckoutTax({ supabase, userId, appliesTo: 'topup', netMinor: topup.price_minor });

  return {
    kind: 'topup',
    title: topup.name,
    currencyCode: topup.currency_code,
    netMinor: tax.netMinor,
    taxMinor: tax.taxMinor,
    grossMinor: tax.grossMinor,
    ratePercent: tax.taxBreakdown?.ratePercent ?? null,
    taxLines: taxLinesFromBreakdown(tax.taxBreakdown),
    coins: beatsToCoins(topup.beat_amount),
    interval: null,
    nextChargeDate: null,
  };
}

function beatsToCoins(value: number): number {
  return Number((value * COINS_PER_BEAT).toFixed(2));
}

// ---------------------------------------------------------------------------------------------
// Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit F): Settings -> Billing
// (/account/billing). Every query below is scoped to the caller's own user id (or, for
// billing_documents/billing_refunds, which have no user_id, through subject_ref or the caller's own
// payment ids) and to the live Razorpay mode -- never to an id the client supplies.
// ---------------------------------------------------------------------------------------------

const PAYMENT_HISTORY_PAGE_SIZE = 20;

async function resolvePlanIdentity(
  supabase: AdminClient,
  planVersionId: string
): Promise<{ planKey: string; planName: string; priceMinor: number; currencyCode: string } | null> {
  const versionResult = await supabase
    .from('pricing_plan_versions')
    .select('plan_id, price_minor, currency_code')
    .eq('id', planVersionId)
    .maybeSingle();
  if (versionResult.error || !versionResult.data) return null;

  const planResult = await supabase
    .from('pricing_plans')
    .select('plan_key, name')
    .eq('id', (versionResult.data as { plan_id: string }).plan_id)
    .maybeSingle();
  if (planResult.error || !planResult.data) return null;

  const plan = planResult.data as { plan_key: string; name: string };
  const version = versionResult.data as { price_minor: number; currency_code: string };
  return { planKey: plan.plan_key, planName: plan.name, priceMinor: version.price_minor, currencyCode: version.currency_code };
}

async function resolvePlanNamesByVersionId(
  supabase: AdminClient,
  planVersionIds: string[]
): Promise<Record<string, string>> {
  if (planVersionIds.length === 0) return {};

  const versionsResult = await supabase.from('pricing_plan_versions').select('id, plan_id').in('id', planVersionIds);
  if (versionsResult.error) return {};
  const versions = (versionsResult.data ?? []) as { id: string; plan_id: string }[];
  const planIds = [...new Set(versions.map((row) => row.plan_id))];
  if (planIds.length === 0) return {};

  const plansResult = await supabase.from('pricing_plans').select('id, name').in('id', planIds);
  if (plansResult.error) return {};
  const nameByPlanId = new Map(((plansResult.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));

  const result: Record<string, string> = {};
  for (const version of versions) {
    const name = nameByPlanId.get(version.plan_id);
    if (name) result[version.id] = name;
  }
  return result;
}

async function resolveTopupNamesByPackId(
  supabase: AdminClient,
  topupPackIds: string[]
): Promise<Record<string, string>> {
  if (topupPackIds.length === 0) return {};

  const result = await supabase.from('pricing_topup_packs').select('id, name').in('id', topupPackIds);
  if (result.error) return {};

  const out: Record<string, string> = {};
  for (const row of (result.data ?? []) as { id: string; name: string }[]) out[row.id] = row.name;
  return out;
}

/** Best-effort: a missing refund row (or an unmigrated table) must never hide the payment it
 * belongs to -- it just shows without a refund line. Keeps the newest refund per payment, matching
 * the refund architecture's "full refunds only" rule (at most one real refund per payment anyway). */
async function loadRefundsByPaymentId(
  supabase: AdminClient,
  paymentIds: string[],
  mode: RazorpayMode
): Promise<Map<string, DbBillingRefund>> {
  if (paymentIds.length === 0) return new Map();

  const result = await supabase
    .from('billing_refunds')
    .select('payment_id, amount_minor, status, processed_at')
    .in('payment_id', paymentIds)
    .eq('provider_mode', mode);
  if (result.error) return new Map();

  const map = new Map<string, DbBillingRefund>();
  for (const row of (result.data ?? []) as DbBillingRefund[]) {
    if (!row.payment_id) continue;
    const existing = map.get(row.payment_id);
    if (!existing || (row.processed_at ?? '') > (existing.processed_at ?? '')) {
      map.set(row.payment_id, row);
    }
  }
  return map;
}

async function loadSubscriptionOverview(
  supabase: AdminClient,
  userId: string,
  mode: RazorpayMode
): Promise<{ subscription: BillingSubscriptionOverview | null } | { unavailable: true }> {
  const result = await supabase
    .from('billing_subscriptions')
    .select('plan_version_id, status, billing_interval, current_period_end, cancel_at_period_end, provider_mode, created_at')
    .eq('user_id', userId);

  if (result.error) {
    if (isMissingBillingSchemaError(result.error)) return { unavailable: true };
    throw new Error(`Failed to load your subscription: ${result.error.message}`);
  }

  const rows = (result.data ?? []) as Array<{
    plan_version_id: string;
    status: string;
    billing_interval: BillingInterval;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    provider_mode: string;
    created_at: string;
  }>;

  const picked = pickCurrentSubscription(rows, mode);
  if (!picked) return { subscription: null };

  const identity = await resolvePlanIdentity(supabase, picked.plan_version_id);

  return {
    subscription: {
      planKey: identity?.planKey ?? null,
      planName: identity?.planName ?? 'Plan',
      priceMinor: identity?.priceMinor ?? null,
      currencyCode: identity?.currencyCode ?? null,
      interval: picked.billing_interval,
      status: picked.status,
      currentPeriodEnd: picked.current_period_end,
      cancelAtPeriodEnd: picked.cancel_at_period_end,
    },
  };
}

async function loadPaymentsPage(
  supabase: AdminClient,
  userId: string,
  mode: RazorpayMode,
  page: number
): Promise<{ items: BillingPaymentOverview[]; hasMore: boolean } | { unavailable: true }> {
  const from = Math.max(0, page) * PAYMENT_HISTORY_PAGE_SIZE;
  const to = from + PAYMENT_HISTORY_PAGE_SIZE; // one extra row, to detect hasMore

  const paymentsResult = await supabase
    .from('billing_payments')
    .select(
      'id, kind, status, gross_minor, currency_code, tax_breakdown_json, method_category, plan_version_id, topup_pack_id, purchase_snapshot_json, captured_at, created_at'
    )
    .eq('user_id', userId)
    .eq('provider_mode', mode)
    // A failed attempt is not money (F execution spec).
    .in('status', ['captured', 'refunded', 'partially_refunded', 'disputed'])
    .order('created_at', { ascending: false })
    .range(from, to);

  if (paymentsResult.error) {
    if (isMissingBillingSchemaError(paymentsResult.error)) return { unavailable: true };
    throw new Error(`Failed to load payment history: ${paymentsResult.error.message}`);
  }

  const rows = (paymentsResult.data ?? []) as DbBillingPayment[];
  const hasMore = rows.length > PAYMENT_HISTORY_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, PAYMENT_HISTORY_PAGE_SIZE) : rows;
  if (pageRows.length === 0) return { items: [], hasMore: false };

  const planVersionIdsNeeded = new Set<string>();
  const topupPackIdsNeeded = new Set<string>();
  for (const row of pageRows) {
    const snapshot = row.purchase_snapshot_json as { planName?: string; packName?: string } | null;
    if (row.kind !== 'topup' && !snapshot?.planName && row.plan_version_id) planVersionIdsNeeded.add(row.plan_version_id);
    if (row.kind === 'topup' && !snapshot?.packName && row.topup_pack_id) topupPackIdsNeeded.add(row.topup_pack_id);
  }

  const [planNames, topupNames, refundsByPaymentId] = await Promise.all([
    resolvePlanNamesByVersionId(supabase, [...planVersionIdsNeeded]),
    resolveTopupNamesByPackId(supabase, [...topupPackIdsNeeded]),
    loadRefundsByPaymentId(supabase, pageRows.map((row) => row.id), mode),
  ]);

  const items: BillingPaymentOverview[] = pageRows.map((row) => {
    const snapshot = row.purchase_snapshot_json as { planName?: string; packName?: string } | null;
    const refund = refundsByPaymentId.get(row.id) ?? null;

    return {
      id: row.id,
      date: row.captured_at ?? row.created_at,
      description: paymentDescription(
        {
          kind: row.kind,
          planVersionId: row.plan_version_id,
          topupPackId: row.topup_pack_id,
          snapshotPlanName: snapshot?.planName ?? null,
          snapshotPackName: snapshot?.packName ?? null,
        },
        { planNames, topupNames }
      ),
      methodLabel: methodLabel(row.method_category),
      grossMinor: row.gross_minor,
      currencyCode: row.currency_code,
      taxLines: taxLinesFromBreakdown(row.tax_breakdown_json as unknown as TaxBreakdown | null),
      refund: refund
        ? { amountMinor: refund.amount_minor, processed: refund.status === 'processed', date: refund.processed_at }
        : null,
    };
  });

  return { items, hasMore };
}

async function loadDocumentsOverview(
  supabase: AdminClient,
  userId: string
): Promise<{ documents: BillingDocumentOverview[] } | { unavailable: true }> {
  const result = await supabase
    .from('billing_documents')
    .select('id, document_type, document_number, issued_at, gross_minor, currency_code')
    .eq('subject_ref', userId)
    .order('issued_at', { ascending: false });

  if (result.error) {
    if (isMissingBillingSchemaError(result.error)) return { unavailable: true };
    throw new Error(`Failed to load billing documents: ${result.error.message}`);
  }

  const documents = ((result.data ?? []) as Array<{
    id: string;
    document_type: string;
    document_number: string;
    issued_at: string;
    gross_minor: number;
    currency_code: string;
  }>).map((row) => ({
    id: row.id,
    documentType: row.document_type,
    documentNumber: row.document_number,
    issuedAt: row.issued_at,
    totalMinor: row.gross_minor,
    currencyCode: row.currency_code,
  }));

  return { documents };
}

/** The whole /account/billing page's data in one call. Each of the three sections degrades on its
 * own when its part of the schema is missing (isMissingBillingSchemaError) -- the page still
 * renders the sections that are available. */
export async function getMyBillingOverview(): Promise<GetMyBillingOverviewResult> {
  const userId = await getAuthenticatedUserId();
  const supabase = createAdminClient();
  const mode = getRazorpayMode();

  const [subscriptionSection, paymentsSection, documentsSection] = await Promise.all([
    loadSubscriptionOverview(supabase, userId, mode),
    loadPaymentsPage(supabase, userId, mode, 0),
    loadDocumentsOverview(supabase, userId),
  ]);

  return {
    subscription: 'unavailable' in subscriptionSection ? null : subscriptionSection.subscription,
    payments: 'unavailable' in paymentsSection ? { items: [], hasMore: false } : paymentsSection,
    documents: 'unavailable' in documentsSection ? [] : documentsSection.documents,
    sections: {
      subscription: 'unavailable' in subscriptionSection ? 'unavailable' : 'ok',
      payments: 'unavailable' in paymentsSection ? 'unavailable' : 'ok',
      documents: 'unavailable' in documentsSection ? 'unavailable' : 'ok',
    },
  };
}

export type GetMyPaymentHistoryResult =
  | { ok: true; items: BillingPaymentOverview[]; hasMore: boolean }
  | { ok: false; error: string };

/** The "Show more" pager behind the payment history card -- same query and DTO as the overview's
 * first page. */
export async function getMyPaymentHistory(input: { page: number }): Promise<GetMyPaymentHistoryResult> {
  try {
    const userId = await getAuthenticatedUserId();
    const supabase = createAdminClient();
    const mode = getRazorpayMode();
    const page = Number.isFinite(input.page) && input.page > 0 ? Math.floor(input.page) : 0;

    const result = await loadPaymentsPage(supabase, userId, mode, page);
    if ('unavailable' in result) {
      return { ok: false, error: "Payment history isn't available right now." };
    }
    return { ok: true, items: result.items, hasMore: result.hasMore };
  } catch (err) {
    console.error('[billing-account] getMyPaymentHistory failed', err);
    return { ok: false, error: "We couldn't load more payments. Please try again." };
  }
}

async function loadAnyPlanVersionById(supabase: AdminClient, planVersionId: string): Promise<DbPricingPlanVersion | null> {
  const result = await supabase.from('pricing_plan_versions').select('*').eq('id', planVersionId).maybeSingle();
  if (result.error || !result.data) return null;
  return result.data as DbPricingPlanVersion;
}

export type CancelMySubscriptionResult =
  | { ok: true; endsAt: string | null; alreadyApplied: boolean }
  | { ok: false; error: string };

/**
 * Self-serve cancel (F execution spec, decision 13: exactly one cancel action, cycle-end only).
 * `admin_user_audit_events` is not used here -- its `action_type` CHECK (migration 131) has no value
 * for a user-initiated cancel, and widening it is a migration this unit does not ship (don't reuse
 * `cancelBillingSubscriptionAtCycleEnd`'s audit row for that reason). Idempotency instead comes from
 * re-reading `cancel_at_period_end` -- both up front and after a provider throw -- rather than a
 * request-key replay table.
 */
export async function cancelMySubscription(): Promise<CancelMySubscriptionResult> {
  const GENERIC_ERROR = "We couldn't cancel your plan right now. Nothing has changed. Please try again.";

  try {
    const userId = await getAuthenticatedUserId();
    const supabase = createAdminClient();
    const mode = getRazorpayMode();

    const subsResult = await supabase
      .from('billing_subscriptions')
      .select('id, provider_subscription_id, provider_mode, plan_version_id, current_period_end, cancel_at_period_end')
      .eq('user_id', userId)
      .in('status', ['authenticated', 'active', 'pending']);

    if (subsResult.error) {
      console.error('[billing-account] cancelMySubscription: failed to load subscription', subsResult.error);
      return { ok: false, error: GENERIC_ERROR };
    }

    const candidates = (subsResult.data ?? []) as Array<{
      id: string;
      provider_subscription_id: string;
      provider_mode: string;
      plan_version_id: string;
      current_period_end: string | null;
      cancel_at_period_end: boolean;
    }>;
    const candidate = candidates.find((row) => row.provider_mode === mode) ?? null;
    if (!candidate) {
      return { ok: false, error: "There's no active plan to cancel." };
    }
    if (candidate.cancel_at_period_end) {
      return { ok: true, endsAt: candidate.current_period_end, alreadyApplied: true };
    }

    let cancelled;
    try {
      // Decision 13: exactly one cancel action. atCycleEnd is always true -- never client-controlled.
      cancelled = await cancelRazorpaySubscription({ subscriptionId: candidate.provider_subscription_id, atCycleEnd: true });
    } catch (err) {
      console.error('[billing-account] cancelMySubscription: Razorpay cancel failed', err);
      // A double-click race may have already landed the marker write below from the first request.
      const recheck = await supabase
        .from('billing_subscriptions')
        .select('cancel_at_period_end, current_period_end')
        .eq('id', candidate.id)
        .maybeSingle();
      if (!recheck.error && recheck.data && (recheck.data as { cancel_at_period_end: boolean }).cancel_at_period_end) {
        const row = recheck.data as { cancel_at_period_end: boolean; current_period_end: string | null };
        return { ok: true, endsAt: row.current_period_end, alreadyApplied: true };
      }
      return { ok: false, error: GENERIC_ERROR };
    }

    // Payments Phase 5 (migration 134): same marker write as cancelBillingSubscriptionAtCycleEnd
    // (admin-billing-actions.ts), with cancel_requested_by: 'user'. Razorpay has already accepted the
    // cancel, so a missing column here (134 unapplied) must never surface as a thrown error -- it
    // only means "who/when" is lost, same fail-closed retry the admin action uses.
    const markerUpdate = await supabase
      .from('billing_subscriptions')
      .update({
        cancel_at_period_end: true,
        cancel_requested_at: new Date().toISOString(),
        cancel_requested_by: 'user',
      })
      .eq('id', candidate.id);

    if (markerUpdate.error) {
      if (isMissingBillingSchemaError(markerUpdate.error)) {
        const retryUpdate = await supabase
          .from('billing_subscriptions')
          .update({ cancel_at_period_end: true })
          .eq('id', candidate.id);
        if (retryUpdate.error) {
          console.error('[billing-account] cancelMySubscription: fail-closed retry also failed', retryUpdate.error);
        }
      } else {
        console.error('[billing-account] cancelMySubscription: failed to record the cancel request', markerUpdate.error);
      }
    }

    // Payments Phase 6 (docs/payments/phase-6-plan.md §10, hook 6): best-effort, mirroring the admin
    // cancel action's own hook. `userId` here is always the live, authenticated caller, so unlike the
    // admin path there is no deleted-account case to guard against.
    await enqueueBillingJob({
      kind: 'cancel_scheduled',
      dedupeKey: `cancel:${candidate.id}:${candidate.current_period_end}`,
      subjectRef: userId,
      userId,
      billingSubscriptionId: candidate.id,
      payload: { accessUntil: candidate.current_period_end },
    });

    // Best-effort immediate convergence -- the webhook/reconcile backstop still owns the real state.
    // Never fails the result: Razorpay has already accepted the cancel.
    try {
      const planVersion = await loadAnyPlanVersionById(supabase, candidate.plan_version_id);
      if (planVersion) {
        await syncSubscriptionFromProvider({
          supabase,
          userId,
          planVersion,
          providerSubscriptionId: cancelled.id,
          source: 'reconcile',
          rawPayload: { kind: 'user_cancel', subscriptionId: cancelled.id },
        });
      }
    } catch (err) {
      console.error('[billing-account] cancelMySubscription: best-effort re-sync failed', err);
    }

    revalidatePath('/account/billing');
    return { ok: true, endsAt: candidate.current_period_end, alreadyApplied: false };
  } catch (err) {
    console.error('[billing-account] cancelMySubscription failed', err);
    return { ok: false, error: GENERIC_ERROR };
  }
}

export type RestartHaltedSubscriptionResult =
  | { ok: true; planVersionId: string | null }
  | { ok: false; error: string };

/**
 * Halted recovery (P5). A halted subscription grants nothing, so ending it now takes nothing away.
 * Unlike cancelMySubscription's step 7, the re-sync here is awaited, not best-effort: the client
 * opens a fresh checkout for the same plan right after, and the subscription-exists RPC guard
 * (migration 130) would refuse that checkout if the row still read "halted".
 */
export async function restartMyHaltedSubscription(): Promise<RestartHaltedSubscriptionResult> {
  const GENERIC_ERROR = "We couldn't restart your plan right now. Please try again.";

  try {
    const userId = await getAuthenticatedUserId();
    const supabase = createAdminClient();
    const mode = getRazorpayMode();

    const subsResult = await supabase
      .from('billing_subscriptions')
      .select('id, provider_subscription_id, provider_mode, plan_version_id')
      .eq('user_id', userId)
      .eq('status', 'halted');

    if (subsResult.error) {
      console.error('[billing-account] restartMyHaltedSubscription: failed to load subscription', subsResult.error);
      return { ok: false, error: GENERIC_ERROR };
    }

    const halted = ((subsResult.data ?? []) as Array<{
      id: string;
      provider_subscription_id: string;
      provider_mode: string;
      plan_version_id: string;
    }>).find((row) => row.provider_mode === mode) ?? null;

    if (!halted) {
      return { ok: false, error: "There's no paused plan to restart." };
    }

    let cancelled;
    try {
      cancelled = await cancelRazorpaySubscription({ subscriptionId: halted.provider_subscription_id, atCycleEnd: false });
    } catch (err) {
      console.error('[billing-account] restartMyHaltedSubscription: Razorpay cancel failed', err);
      return { ok: false, error: GENERIC_ERROR };
    }

    try {
      const planVersion = await loadAnyPlanVersionById(supabase, halted.plan_version_id);
      if (!planVersion) throw new Error('plan_version_not_found');
      await syncSubscriptionFromProvider({
        supabase,
        userId,
        planVersion,
        providerSubscriptionId: cancelled.id,
        source: 'reconcile',
        rawPayload: { kind: 'user_restart', subscriptionId: cancelled.id },
      });
    } catch (err) {
      console.error('[billing-account] restartMyHaltedSubscription: re-sync failed', err);
      return { ok: false, error: GENERIC_ERROR };
    }

    let planVersionId: string | null = null;
    try {
      const version = await loadPlanVersionForCheckout(supabase, halted.plan_version_id, null);
      planVersionId = version.id;
    } catch {
      planVersionId = null;
    }

    revalidatePath('/account/billing');
    return { ok: true, planVersionId };
  } catch (err) {
    console.error('[billing-account] restartMyHaltedSubscription failed', err);
    return { ok: false, error: GENERIC_ERROR };
  }
}
