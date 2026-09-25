import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  verifyAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/ai/model-config', () => ({
  getFeatureFlag: vi.fn(),
  getFeatureFlagValue: vi.fn(),
}));

vi.mock('@/lib/billing/razorpay', () => ({
  cancelRazorpaySubscription: vi.fn(),
  refundRazorpayPayment: vi.fn(),
}));

vi.mock('@/lib/billing/ledger', () => ({
  recordRefund: vi.fn(),
}));

vi.mock('@/app/actions/pricing-admin', () => ({
  reconcilePricingSubscription: vi.fn(),
  reconcilePricingTopup: vi.fn(),
}));

vi.mock('@/lib/billing/razorpay-webhook', () => ({
  processRazorpayWebhookEvent: vi.fn(),
}));

vi.mock('@/lib/billing/notifications/queue', () => ({
  enqueueBillingJob: vi.fn(),
}));

// Decision 15/16's two new helper modules are used for REAL here -- this file exercises the whole
// wired-together flow, not a mock of the new logic. Only their I/O edges (Razorpay, Supabase) are
// mocked, which is why razorpay/supabase/admin above are mocked but subscription-refund-end(.shared)
// and subscription-included-beats are not.

import { verifyAdmin, createAdminClient } from '@/lib/supabase/admin';
import { getFeatureFlag, getFeatureFlagValue } from '@/lib/ai/model-config';
import { cancelRazorpaySubscription, refundRazorpayPayment } from '@/lib/billing/razorpay';
import { recordRefund } from '@/lib/billing/ledger';
import { reconcilePricingSubscription } from '@/app/actions/pricing-admin';
import { enqueueBillingJob } from '@/lib/billing/notifications/queue';
import { cancelBillingSubscriptionAtCycleEnd, refundBillingPayment } from './admin-billing-actions';

const verifyAdminMock = vi.mocked(verifyAdmin);
const createAdminClientMock = vi.mocked(createAdminClient);
const getFeatureFlagMock = vi.mocked(getFeatureFlag);
const getFeatureFlagValueMock = vi.mocked(getFeatureFlagValue);
const cancelRazorpaySubscriptionMock = vi.mocked(cancelRazorpaySubscription);
const refundRazorpayPaymentMock = vi.mocked(refundRazorpayPayment);
const recordRefundMock = vi.mocked(recordRefund);
const reconcilePricingSubscriptionMock = vi.mocked(reconcilePricingSubscription);
const enqueueBillingJobMock = vi.mocked(enqueueBillingJob);

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

type Op = 'select' | 'insert' | 'update';

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult) {}
  select() { return this; }
  eq() { return this; }
  insert(_row: unknown) { return this; }
  update(_row: unknown) { return this; }
  maybeSingle(): Promise<QueryResult> { return Promise.resolve(this.result); }
  single(): Promise<QueryResult> { return Promise.resolve(this.result); }
  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}


/**
 * One fake admin client for the whole refundBillingPayment flow, including its two REAL
 * decision-15/16 collaborators (subscription-refund-end.ts, subscription-included-beats.ts), which
 * issue their own `.from()` calls against this same client. Queued per table+op, FIFO, with the same
 * "peek the last one forever" behaviour as razorpay-webhook.test.ts's fake -- a table+op hit more
 * times than configured keeps returning the final queued value rather than throwing.
 */
function createFakeSupabase() {
  const queues: Record<string, QueryResult[]> = {};
  const calls: { table: string; op: Op; payload?: unknown }[] = [];

  function enqueue(table: string, op: Op, result: QueryResult) {
    (queues[`${table}:${op}`] ??= []).push(result);
  }

  function dequeue(table: string, op: Op): QueryResult {
    const key = `${table}:${op}`;
    const queue = queues[key];
    if (!queue || queue.length === 0) {
      throw new Error(`admin-billing-actions.test: no queued ${op} result for table "${table}"`);
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  }

  const rpc = vi.fn();

  const supabase = {
    from(table: string) {
      return {
        select: () => {
          calls.push({ table, op: 'select' });
          return new FakeQueryBuilder(dequeue(table, 'select'));
        },
        insert: (row: unknown) => {
          calls.push({ table, op: 'insert', payload: row });
          return new FakeQueryBuilder(dequeue(table, 'insert'));
        },
        update: (row: unknown) => {
          calls.push({ table, op: 'update', payload: row });
          return new FakeQueryBuilder(dequeue(table, 'update'));
        },
      };
    },
    rpc,
  };

  return { supabase: supabase as any, enqueue, calls, rpc };
}

function fakePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    user_id: 'user-1',
    provider_payment_id: 'pay_1',
    provider_mode: 'test',
    status: 'captured',
    gross_minor: 1180,
    currency_code: 'INR',
    kind: 'topup',
    billing_order_id: 'order-1',
    provider_subscription_id: null,
    cycle_start: null,
    cycle_end: null,
    plan_version_id: null,
    ...overrides,
  };
}

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';
const SUBSCRIPTION_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_KEY = 'manual:test-request-key';
const REASON = 'test refund reason';
const FUTURE_CYCLE_END = '2030-01-01T00:00:00.000Z';
const PAST_CYCLE_END = '2020-01-01T00:00:00.000Z';

/** Sets up an admin client with the two calls every refund attempt makes before it can even reach
 * the grant lookup: the request-key replay check, then loading the payment itself. */
function withStandardSetup(payment: ReturnType<typeof fakePayment>) {
  const fake = createFakeSupabase();
  fake.enqueue('admin_user_audit_events', 'select', { data: null, error: null }); // existingByKey: no replay
  fake.enqueue('billing_payments', 'select', { data: payment, error: null });
  return fake;
}

/** The rest of a successful attempt after eligibility passes: the cap check, the "attempting" audit
 * insert, and (only when there is a grant) the clawback RPC. */
function queueThroughClawback(fake: ReturnType<typeof createFakeSupabase>, options: { hasGrant: boolean }) {
  fake.enqueue('admin_user_audit_events', 'select', { data: [], error: null }); // priorRefunds: cap not reached
  fake.enqueue('admin_user_audit_events', 'insert', { data: { id: 'audit-1' }, error: null });
  if (options.hasGrant) {
    fake.rpc.mockResolvedValueOnce({ data: null, error: null }); // clawback
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyAdminMock.mockResolvedValue({ user: { id: 'admin-1' } } as any);
  getFeatureFlagMock.mockResolvedValue(true); // billing_admin_actions_enabled
  getFeatureFlagValueMock.mockResolvedValue(null); // refund cap: default
});

describe('refundBillingPayment', () => {
  it('refuses before touching the database when the kill switch is off', async () => {
    getFeatureFlagMock.mockResolvedValue(false);
    const fake = createFakeSupabase();
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(
      refundBillingPayment({ paymentId: PAYMENT_ID, reason: REASON, requestKey: REQUEST_KEY })
    ).rejects.toThrow(/turned off/);
    expect(fake.calls).toHaveLength(0);
  });

  describe('decision 16 -- zero-coin subscription plans', () => {
    it('proceeds with nothing to claw back when a subscription payment genuinely included 0 coins', async () => {
      const payment = fakePayment({
        kind: 'subscription_renewal',
        billing_order_id: null,
        provider_subscription_id: 'sub_1',
        cycle_start: '2026-08-01T00:00:00.000Z',
        cycle_end: PAST_CYCLE_END, // isolate from decision 15 -- this test is about decision 16 only
        plan_version_id: 'plan-version-1',
      });
      const fake = withStandardSetup(payment);
      fake.enqueue('beat_grants', 'select', { data: null, error: null }); // no grant
      fake.enqueue('billing_orders', 'select', {
        data: { purchase_snapshot_json: { includedBeats: 0 } },
        error: null,
      });
      queueThroughClawback(fake, { hasGrant: false });
      fake.enqueue('billing_subscriptions', 'select', { data: { id: 'sub-row-1', status: 'active' }, error: null });
      fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null }); // patch outcome
      createAdminClientMock.mockReturnValue(fake.supabase);
      refundRazorpayPaymentMock.mockResolvedValueOnce({
        id: 'rfnd_1', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'processed',
      });
      recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-1' });

      const result = await refundBillingPayment({ paymentId: PAYMENT_ID, reason: REASON, requestKey: REQUEST_KEY });

      expect(result.beatsClawedBack).toBe(0);
      expect(result.refundedAmountMinor).toBe(1180);
      expect(result.subscriptionEnded).toBe(false); // past cycle -- decision 15 does not apply here
      expect(fake.rpc).not.toHaveBeenCalledWith('admin_adjust_purchase_grant_beats', expect.objectContaining({ p_direction: 'clawback' }));
    });

    it('still refuses a top-up with a missing grant -- top-ups are never zero-coin', async () => {
      const payment = fakePayment({ kind: 'topup', billing_order_id: 'order-1' });
      const fake = withStandardSetup(payment);
      fake.enqueue('beat_grants', 'select', { data: null, error: null });
      createAdminClientMock.mockReturnValue(fake.supabase);

      await expect(
        refundBillingPayment({ paymentId: PAYMENT_ID, reason: REASON, requestKey: REQUEST_KEY })
      ).rejects.toThrow(/No coin grant was found/);
      // Never reached the billing_orders/pricing_plan_versions lookup -- a top-up isn't eligible for it.
      expect(fake.calls.some((c) => c.table === 'billing_orders')).toBe(false);
    });

    it('still refuses a subscription with a missing grant when the plan actually includes coins', async () => {
      const payment = fakePayment({
        kind: 'subscription_first',
        billing_order_id: null,
        provider_subscription_id: 'sub_2',
        cycle_start: '2026-01-01T00:00:00.000Z',
        cycle_end: PAST_CYCLE_END,
        plan_version_id: 'plan-version-2',
      });
      const fake = withStandardSetup(payment);
      fake.enqueue('beat_grants', 'select', { data: null, error: null });
      fake.enqueue('billing_orders', 'select', {
        data: { purchase_snapshot_json: { includedBeats: 120 } },
        error: null,
      });
      createAdminClientMock.mockReturnValue(fake.supabase);

      await expect(
        refundBillingPayment({ paymentId: PAYMENT_ID, reason: REASON, requestKey: REQUEST_KEY })
      ).rejects.toThrow(/No coin grant was found/);
    });
  });

  describe('decision 15 -- ending the subscription after a full refund', () => {
    it('ends a current-cycle subscription immediately after the refund succeeds', async () => {
      const payment = fakePayment({
        kind: 'subscription_renewal',
        billing_order_id: null,
        provider_subscription_id: 'sub_3',
        cycle_start: '2026-08-01T00:00:00.000Z',
        cycle_end: FUTURE_CYCLE_END,
        plan_version_id: 'plan-version-3',
      });
      const fake = withStandardSetup(payment);
      fake.enqueue('beat_grants', 'select', { data: { id: 'grant-1', beats_total: 100, beats_remaining: 100 }, error: null });
      queueThroughClawback(fake, { hasGrant: true });
      fake.enqueue('billing_subscriptions', 'select', { data: { id: 'sub-row-3', status: 'active' }, error: null });
      fake.enqueue('billing_subscriptions', 'update', { data: null, error: null });
      fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null });
      createAdminClientMock.mockReturnValue(fake.supabase);
      refundRazorpayPaymentMock.mockResolvedValueOnce({
        id: 'rfnd_2', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'processed',
      });
      cancelRazorpaySubscriptionMock.mockResolvedValueOnce({
        id: 'sub_3', plan_id: 'plan_1', customer_id: null, status: 'cancelled',
        current_start: null, current_end: null, charge_at: null, start_at: null, total_count: 1200,
      });
      recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-2' });

      const result = await refundBillingPayment({ paymentId: PAYMENT_ID, reason: REASON, requestKey: REQUEST_KEY });

      expect(result.subscriptionEnded).toBe(true);
      expect(result.subscriptionEndError).toBeNull();
      expect(cancelRazorpaySubscriptionMock).toHaveBeenCalledWith({ subscriptionId: 'sub_3', atCycleEnd: false });
    });

    it('leaves a still-pending refund to the refund.processed webhook instead of ending the subscription now', async () => {
      const payment = fakePayment({
        kind: 'subscription_renewal',
        billing_order_id: null,
        provider_subscription_id: 'sub_3',
        cycle_start: '2026-08-01T00:00:00.000Z',
        cycle_end: FUTURE_CYCLE_END,
        plan_version_id: 'plan-version-3',
      });
      const fake = withStandardSetup(payment);
      fake.enqueue('beat_grants', 'select', { data: { id: 'grant-1', beats_total: 100, beats_remaining: 100 }, error: null });
      queueThroughClawback(fake, { hasGrant: true });
      fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null });
      createAdminClientMock.mockReturnValue(fake.supabase);
      refundRazorpayPaymentMock.mockResolvedValueOnce({
        id: 'rfnd_5', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'pending',
      });
      recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-5' });

      const result = await refundBillingPayment({ paymentId: PAYMENT_ID, reason: REASON, requestKey: REQUEST_KEY });

      expect(result.subscriptionEnded).toBe(false);
      expect(result.subscriptionEndPending).toBe(true);
      expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
    });

    it('does not end a subscription for a refund of a PAST cycle', async () => {
      const payment = fakePayment({
        kind: 'subscription_renewal',
        billing_order_id: null,
        provider_subscription_id: 'sub_4',
        cycle_start: '2020-01-01T00:00:00.000Z',
        cycle_end: PAST_CYCLE_END,
        plan_version_id: 'plan-version-4',
      });
      const fake = withStandardSetup(payment);
      fake.enqueue('beat_grants', 'select', { data: { id: 'grant-2', beats_total: 100, beats_remaining: 100 }, error: null });
      queueThroughClawback(fake, { hasGrant: true });
      fake.enqueue('billing_subscriptions', 'select', { data: { id: 'sub-row-4', status: 'active' }, error: null });
      fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null });
      createAdminClientMock.mockReturnValue(fake.supabase);
      refundRazorpayPaymentMock.mockResolvedValueOnce({
        id: 'rfnd_3', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'processed',
      });
      recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-3' });

      const result = await refundBillingPayment({ paymentId: PAYMENT_ID, reason: REASON, requestKey: REQUEST_KEY });

      expect(result.subscriptionEnded).toBe(false);
      expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
    });

    it('reports the refund as a success even when ending the subscription fails', async () => {
      const payment = fakePayment({
        kind: 'subscription_renewal',
        billing_order_id: null,
        provider_subscription_id: 'sub_5',
        cycle_start: '2026-08-01T00:00:00.000Z',
        cycle_end: FUTURE_CYCLE_END,
        plan_version_id: 'plan-version-5',
      });
      const fake = withStandardSetup(payment);
      fake.enqueue('beat_grants', 'select', { data: { id: 'grant-3', beats_total: 100, beats_remaining: 100 }, error: null });
      queueThroughClawback(fake, { hasGrant: true });
      fake.enqueue('billing_subscriptions', 'select', { data: { id: 'sub-row-5', status: 'active' }, error: null });
      fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null });
      createAdminClientMock.mockReturnValue(fake.supabase);
      refundRazorpayPaymentMock.mockResolvedValueOnce({
        id: 'rfnd_4', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'processed',
      });
      cancelRazorpaySubscriptionMock.mockRejectedValueOnce(new Error('Razorpay request failed: network error'));
      recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-4' });

      const result = await refundBillingPayment({ paymentId: PAYMENT_ID, reason: REASON, requestKey: REQUEST_KEY });

      // The refund itself is reported as a success -- amount and clawback are exactly as if ending
      // the subscription had never been attempted.
      expect(result.providerRefundId).toBe('rfnd_4');
      expect(result.refundedAmountMinor).toBe(1180);
      expect(result.beatsClawedBack).toBe(100);
      expect(result.alreadyApplied).toBe(false);
      // ...but the subscription-end failure is visible, not silently swallowed.
      expect(result.subscriptionEnded).toBe(false);
      expect(result.subscriptionEndError).toMatch(/network error/);
    });
  });

  describe('Payments Phase 6, Unit C2, hook 5 -- refund_processed enqueue', () => {
    it('enqueues refund_processed for a newly-recorded processed refund, with the frozen billing email', async () => {
      const payment = fakePayment({ customer_snapshot_json: { billingEmail: 'buyer@example.com' } });
      const fake = withStandardSetup(payment);
      fake.enqueue('beat_grants', 'select', { data: { id: 'grant-9', beats_total: 100, beats_remaining: 100 }, error: null });
      queueThroughClawback(fake, { hasGrant: true });
      fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null });
      createAdminClientMock.mockReturnValue(fake.supabase);
      refundRazorpayPaymentMock.mockResolvedValueOnce({
        id: 'rfnd_9', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'processed',
      });
      recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-9' });

      await refundBillingPayment({ paymentId: PAYMENT_ID, reason: REASON, requestKey: REQUEST_KEY });

      expect(enqueueBillingJobMock).toHaveBeenCalledWith({
        kind: 'refund_processed',
        dedupeKey: 'refund:refund-9',
        subjectRef: 'user-1',
        userId: 'user-1',
        refundId: 'refund-9',
        payload: { billingEmail: 'buyer@example.com' },
      });
    });

    it('does not enqueue while the refund is still pending at Razorpay', async () => {
      const payment = fakePayment();
      const fake = withStandardSetup(payment);
      fake.enqueue('beat_grants', 'select', { data: { id: 'grant-10', beats_total: 100, beats_remaining: 100 }, error: null });
      queueThroughClawback(fake, { hasGrant: true });
      fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null });
      createAdminClientMock.mockReturnValue(fake.supabase);
      refundRazorpayPaymentMock.mockResolvedValueOnce({
        id: 'rfnd_10', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'pending',
      });
      recordRefundMock.mockResolvedValueOnce({ state: 'inserted', id: 'refund-10' });

      await refundBillingPayment({ paymentId: PAYMENT_ID, reason: REASON, requestKey: REQUEST_KEY });

      expect(enqueueBillingJobMock).not.toHaveBeenCalled();
    });

    it('does not enqueue when the best-effort ledger write reports no id (schema unavailable)', async () => {
      const payment = fakePayment();
      const fake = withStandardSetup(payment);
      fake.enqueue('beat_grants', 'select', { data: { id: 'grant-11', beats_total: 100, beats_remaining: 100 }, error: null });
      queueThroughClawback(fake, { hasGrant: true });
      fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null });
      createAdminClientMock.mockReturnValue(fake.supabase);
      refundRazorpayPaymentMock.mockResolvedValueOnce({
        id: 'rfnd_11', payment_id: 'pay_1', amount: 1180, currency: 'INR', status: 'processed',
      });
      recordRefundMock.mockResolvedValueOnce({ state: 'unavailable' });

      await refundBillingPayment({ paymentId: PAYMENT_ID, reason: REASON, requestKey: REQUEST_KEY });

      expect(enqueueBillingJobMock).not.toHaveBeenCalled();
    });
  });
});

// Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit A; migration 134): the post-cancel write
// that lets "Cancels on <date>" survive a re-sync, and its fail-closed retry when 134 is unapplied.
function fakeSubscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-row-1',
    user_id: 'user-1',
    provider_subscription_id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    current_period_end: '2026-10-24T00:00:00.000Z',
    ...overrides,
  };
}

function fakeCancelledSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1', plan_id: 'plan_1', customer_id: null, status: 'active',
    current_start: null, current_end: null, charge_at: null, start_at: null, total_count: 1200,
    ...overrides,
  };
}

/** The calls every cancel attempt makes before it can even reach Razorpay: the request-key replay
 * check, then loading the subscription, then the "attempting" audit insert. */
function withStandardCancelSetup(subscription: ReturnType<typeof fakeSubscriptionRow>) {
  const fake = createFakeSupabase();
  fake.enqueue('admin_user_audit_events', 'select', { data: null, error: null }); // no replay
  fake.enqueue('billing_subscriptions', 'select', { data: subscription, error: null });
  fake.enqueue('admin_user_audit_events', 'insert', { data: { id: 'audit-1' }, error: null });
  return fake;
}

describe('cancelBillingSubscriptionAtCycleEnd', () => {
  beforeEach(() => {
    reconcilePricingSubscriptionMock.mockResolvedValue({ subscriptionStatus: 'active', grantedCoins: 0 } as any);
  });

  it('records cancel_at_period_end, cancel_requested_at and cancel_requested_by after Razorpay succeeds', async () => {
    const fake = withStandardCancelSetup(fakeSubscriptionRow());
    fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null }); // patchAuditOutcome
    fake.enqueue('billing_subscriptions', 'update', { data: null, error: null }); // the 134 marker write
    createAdminClientMock.mockReturnValue(fake.supabase);
    cancelRazorpaySubscriptionMock.mockResolvedValueOnce(fakeCancelledSubscription());

    const result = await cancelBillingSubscriptionAtCycleEnd({
      subscriptionId: SUBSCRIPTION_ID,
      reason: REASON,
      requestKey: REQUEST_KEY,
    });

    expect(result.alreadyApplied).toBe(false);
    const markerUpdate = fake.calls.find((c) => c.table === 'billing_subscriptions' && c.op === 'update');
    expect(markerUpdate?.payload).toMatchObject({ cancel_at_period_end: true, cancel_requested_by: 'admin' });
    expect((markerUpdate?.payload as any)?.cancel_requested_at).toEqual(expect.any(String));
    // Only one write to billing_subscriptions -- no fail-closed retry needed when 134 is present.
    expect(fake.calls.filter((c) => c.table === 'billing_subscriptions' && c.op === 'update')).toHaveLength(1);
  });

  it('retries with only cancel_at_period_end when migration 134 is not yet applied (42703)', async () => {
    const fake = withStandardCancelSetup(fakeSubscriptionRow());
    fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null });
    fake.enqueue('billing_subscriptions', 'update', { data: null, error: { code: '42703', message: 'column "cancel_requested_at" does not exist' } });
    fake.enqueue('billing_subscriptions', 'update', { data: null, error: null }); // the retry
    createAdminClientMock.mockReturnValue(fake.supabase);
    cancelRazorpaySubscriptionMock.mockResolvedValueOnce(fakeCancelledSubscription());

    const result = await cancelBillingSubscriptionAtCycleEnd({
      subscriptionId: SUBSCRIPTION_ID,
      reason: REASON,
      requestKey: REQUEST_KEY,
    });

    // The cancellation is still reported as a success -- Razorpay already cancelled, and the audit
    // row already recorded it; only the "who/when" columns could not be written.
    expect(result.alreadyApplied).toBe(false);
    const markerUpdates = fake.calls.filter((c) => c.table === 'billing_subscriptions' && c.op === 'update');
    expect(markerUpdates).toHaveLength(2);
    expect(markerUpdates[1]?.payload).toEqual({ cancel_at_period_end: true });
  });

  it('does not throw, and still runs the best-effort reconcile, when the marker write fails for an unrelated reason', async () => {
    const fake = withStandardCancelSetup(fakeSubscriptionRow());
    fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null });
    fake.enqueue('billing_subscriptions', 'update', { data: null, error: { code: '55000', message: 'could not obtain lock' } });
    createAdminClientMock.mockReturnValue(fake.supabase);
    cancelRazorpaySubscriptionMock.mockResolvedValueOnce(fakeCancelledSubscription());

    const result = await cancelBillingSubscriptionAtCycleEnd({
      subscriptionId: SUBSCRIPTION_ID,
      reason: REASON,
      requestKey: REQUEST_KEY,
    });

    expect(result.alreadyApplied).toBe(false);
    expect(reconcilePricingSubscriptionMock).toHaveBeenCalledWith({ providerSubscriptionId: 'sub_1' });
  });

  it('replays a prior success from the request key without calling Razorpay again', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('admin_user_audit_events', 'select', {
      data: {
        action_type: 'subscription_cancelled_at_cycle_end',
        after_json: { providerSubscriptionId: 'sub_1', status: 'active' },
      },
      error: null,
    });
    createAdminClientMock.mockReturnValue(fake.supabase);

    const result = await cancelBillingSubscriptionAtCycleEnd({
      subscriptionId: SUBSCRIPTION_ID,
      reason: REASON,
      requestKey: REQUEST_KEY,
    });

    expect(result.alreadyApplied).toBe(true);
    expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });

  it('refuses a subscription that is already cancelled, expired or completed', async () => {
    const fake = createFakeSupabase();
    fake.enqueue('admin_user_audit_events', 'select', { data: null, error: null });
    fake.enqueue('billing_subscriptions', 'select', { data: fakeSubscriptionRow({ status: 'cancelled' }), error: null });
    createAdminClientMock.mockReturnValue(fake.supabase);

    await expect(
      cancelBillingSubscriptionAtCycleEnd({ subscriptionId: SUBSCRIPTION_ID, reason: REASON, requestKey: REQUEST_KEY })
    ).rejects.toThrow(/already "cancelled"/);

    expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });

  describe('Payments Phase 6, Unit C2, hook 6 -- cancel_scheduled enqueue', () => {
    it('enqueues cancel_scheduled after Razorpay and the marker write both succeed', async () => {
      const fake = withStandardCancelSetup(fakeSubscriptionRow());
      fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null });
      fake.enqueue('billing_subscriptions', 'update', { data: null, error: null });
      createAdminClientMock.mockReturnValue(fake.supabase);
      cancelRazorpaySubscriptionMock.mockResolvedValueOnce(fakeCancelledSubscription());

      await cancelBillingSubscriptionAtCycleEnd({
        subscriptionId: SUBSCRIPTION_ID,
        reason: REASON,
        requestKey: REQUEST_KEY,
      });

      expect(enqueueBillingJobMock).toHaveBeenCalledWith({
        kind: 'cancel_scheduled',
        dedupeKey: 'cancel:sub-row-1:2026-10-24T00:00:00.000Z',
        subjectRef: 'user-1',
        userId: 'user-1',
        billingSubscriptionId: 'sub-row-1',
        payload: { accessUntil: '2026-10-24T00:00:00.000Z' },
      });
    });

    it('does not enqueue for a subscription with no live user (account deleted)', async () => {
      const fake = withStandardCancelSetup(fakeSubscriptionRow({ user_id: null }));
      fake.enqueue('admin_user_audit_events', 'update', { data: null, error: null });
      fake.enqueue('billing_subscriptions', 'update', { data: null, error: null });
      createAdminClientMock.mockReturnValue(fake.supabase);
      cancelRazorpaySubscriptionMock.mockResolvedValueOnce(fakeCancelledSubscription());

      await cancelBillingSubscriptionAtCycleEnd({
        subscriptionId: SUBSCRIPTION_ID,
        reason: REASON,
        requestKey: REQUEST_KEY,
      });

      expect(enqueueBillingJobMock).not.toHaveBeenCalled();
    });
  });
});
