import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/billing/razorpay', () => ({
  cancelRazorpaySubscription: vi.fn(),
}));

vi.mock('@/lib/billing/notifications/queue', () => ({
  enqueueBillingJob: vi.fn(),
}));

import { cancelRazorpaySubscription } from '@/lib/billing/razorpay';
import { enqueueBillingJob } from '@/lib/billing/notifications/queue';
import { endSubscriptionAfterFullRefund } from './subscription-refund-end';

const cancelRazorpaySubscriptionMock = vi.mocked(cancelRazorpaySubscription);
const enqueueBillingJobMock = vi.mocked(enqueueBillingJob);

interface QueryResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

interface RecordedCall {
  table: string;
  op: 'select' | 'update';
  payload?: unknown;
}

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly result: QueryResult, private readonly onUpdate?: (row: unknown) => void) {}
  select() { return this; }
  eq() { return this; }
  update(row: unknown) {
    this.onUpdate?.(row);
    return this;
  }
  maybeSingle(): Promise<QueryResult> { return Promise.resolve(this.result); }
  then<TResult1 = QueryResult, TResult2 = never>(
    onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onFulfilled, onRejected);
  }
}

/**
 * The module under test does at most two `.from('billing_subscriptions')` calls per invocation: a
 * select, then (only when proceeding) an update. Each successive `.from()` call here just advances to
 * the next canned result -- there is never a second select or a first update.
 */
function createFakeSupabase(selectResult: QueryResult, updateResult: QueryResult = { data: null, error: null }) {
  const calls: RecordedCall[] = [];
  let fromCallCount = 0;

  const supabase = {
    from(table: string) {
      fromCallCount += 1;
      if (fromCallCount === 1) {
        calls.push({ table, op: 'select' });
        return new FakeQueryBuilder(selectResult);
      }
      return new FakeQueryBuilder(updateResult, (row) => calls.push({ table, op: 'update', payload: row }));
    },
  };

  return { supabase: supabase as any, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const FUTURE_CYCLE_END = '2026-10-01T00:00:00.000Z';
const PAST_CYCLE_END = '2026-08-01T00:00:00.000Z';
const NOW = new Date('2026-09-23T12:00:00.000Z');

describe('endSubscriptionAfterFullRefund', () => {
  it('does nothing when the payment carries no provider subscription id', async () => {
    const { supabase } = createFakeSupabase({ data: null, error: null });
    const result = await endSubscriptionAfterFullRefund({
      supabase,
      kind: 'subscription_renewal',
      providerSubscriptionId: null,
      refundAmountMinor: 1180,
      paymentGrossMinor: 1180,
      cycleEnd: FUTURE_CYCLE_END,
      now: NOW,
    });
    expect(result).toEqual({ ended: false, error: null });
    expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });

  it('cancels at Razorpay and marks the local row cancelled for a current-cycle full refund', async () => {
    const { supabase, calls } = createFakeSupabase({
      data: { id: 'sub-row-1', status: 'active', user_id: 'user-1', subject_ref: 'subject-1' },
      error: null,
    });
    cancelRazorpaySubscriptionMock.mockResolvedValueOnce({
      id: 'sub_1', plan_id: 'plan_1', customer_id: null, status: 'cancelled',
      current_start: null, current_end: null, charge_at: null, start_at: null, total_count: 1200,
    });

    const result = await endSubscriptionAfterFullRefund({
      supabase,
      kind: 'subscription_renewal',
      providerSubscriptionId: 'sub_1',
      refundAmountMinor: 1180,
      paymentGrossMinor: 1180,
      cycleEnd: FUTURE_CYCLE_END,
      now: NOW,
    });

    expect(result).toEqual({ ended: true, error: null });
    expect(cancelRazorpaySubscriptionMock).toHaveBeenCalledWith({ subscriptionId: 'sub_1', atCycleEnd: false });
    const update = calls.find((c) => c.op === 'update');
    expect(update?.payload).toMatchObject({ status: 'cancelled', cancel_at_period_end: false });
    // The sync never sees this transition, so the plan-ended email is queued here, once.
    expect(enqueueBillingJobMock).toHaveBeenCalledWith({
      kind: 'subscription_ended',
      dedupeKey: 'sub_ended:sub-row-1',
      subjectRef: 'subject-1',
      userId: 'user-1',
      billingSubscriptionId: 'sub-row-1',
    });
  });

  it('does not end it for a refund of a PAST cycle -- and never calls Razorpay', async () => {
    const { supabase } = createFakeSupabase({ data: { id: 'sub-row-1', status: 'active' }, error: null });

    const result = await endSubscriptionAfterFullRefund({
      supabase,
      kind: 'subscription_renewal',
      providerSubscriptionId: 'sub_1',
      refundAmountMinor: 1180,
      paymentGrossMinor: 1180,
      cycleEnd: PAST_CYCLE_END,
      now: NOW,
    });

    expect(result).toEqual({ ended: false, error: null });
    expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });

  it('is a no-op on replay: the local row is already cancelled', async () => {
    const { supabase } = createFakeSupabase({ data: { id: 'sub-row-1', status: 'cancelled' }, error: null });

    const result = await endSubscriptionAfterFullRefund({
      supabase,
      kind: 'subscription_renewal',
      providerSubscriptionId: 'sub_1',
      refundAmountMinor: 1180,
      paymentGrossMinor: 1180,
      cycleEnd: FUTURE_CYCLE_END,
      now: NOW,
    });

    expect(result).toEqual({ ended: false, error: null });
    expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });

  it('treats "already cancelled" at Razorpay as success and still converges the local row', async () => {
    const { supabase, calls } = createFakeSupabase({ data: { id: 'sub-row-1', status: 'active' }, error: null });
    cancelRazorpaySubscriptionMock.mockRejectedValueOnce(
      new Error('Razorpay request failed: This subscription has already been cancelled')
    );

    const result = await endSubscriptionAfterFullRefund({
      supabase,
      kind: 'subscription_renewal',
      providerSubscriptionId: 'sub_1',
      refundAmountMinor: 1180,
      paymentGrossMinor: 1180,
      cycleEnd: FUTURE_CYCLE_END,
      now: NOW,
    });

    expect(result).toEqual({ ended: true, error: null });
    const update = calls.find((c) => c.op === 'update');
    expect(update?.payload).toMatchObject({ status: 'cancelled' });
  });

  it('returns the error, never throws, when Razorpay fails for a real reason', async () => {
    const { supabase, calls } = createFakeSupabase({ data: { id: 'sub-row-1', status: 'active' }, error: null });
    cancelRazorpaySubscriptionMock.mockRejectedValueOnce(new Error('Razorpay request failed: network error'));

    const result = await endSubscriptionAfterFullRefund({
      supabase,
      kind: 'subscription_renewal',
      providerSubscriptionId: 'sub_1',
      refundAmountMinor: 1180,
      paymentGrossMinor: 1180,
      cycleEnd: FUTURE_CYCLE_END,
      now: NOW,
    });

    expect(result.ended).toBe(false);
    expect(result.error).toMatch(/network error/);
    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('does nothing when no local subscription row is found', async () => {
    const { supabase } = createFakeSupabase({ data: null, error: null });

    const result = await endSubscriptionAfterFullRefund({
      supabase,
      kind: 'subscription_renewal',
      providerSubscriptionId: 'sub_unknown',
      refundAmountMinor: 1180,
      paymentGrossMinor: 1180,
      cycleEnd: FUTURE_CYCLE_END,
      now: NOW,
    });

    expect(result).toEqual({ ended: false, error: null });
    expect(cancelRazorpaySubscriptionMock).not.toHaveBeenCalled();
  });

  it('fails closed (no error surfaced) when the schema is missing, e.g. migration not applied', async () => {
    const { supabase } = createFakeSupabase({ data: null, error: { code: '42P01', message: 'relation does not exist' } });

    const result = await endSubscriptionAfterFullRefund({
      supabase,
      kind: 'subscription_renewal',
      providerSubscriptionId: 'sub_1',
      refundAmountMinor: 1180,
      paymentGrossMinor: 1180,
      cycleEnd: FUTURE_CYCLE_END,
      now: NOW,
    });

    expect(result).toEqual({ ended: false, error: null });
  });
});
