import { describe, it, expect } from 'vitest';
import {
  classifyPaymentSearchTerm,
  computePaymentModeTotals,
  normalizeAdminPaymentsListInput,
  paymentKindDbValues,
} from './admin-payments-list.shared';

// /admin/pricing/payments: these two functions are the only logic in the page that isn't a
// straight Supabase read, so they're the only things worth pinning without a database.

describe('classifyPaymentSearchTerm', () => {
  it('classifies an empty or whitespace-only term', () => {
    expect(classifyPaymentSearchTerm('')).toEqual({ kind: 'empty', value: '' });
    expect(classifyPaymentSearchTerm('   ')).toEqual({ kind: 'empty', value: '' });
  });

  it('classifies a Razorpay payment id by its pay_ prefix', () => {
    expect(classifyPaymentSearchTerm('pay_QRs4h5j6k7l8m9')).toEqual({
      kind: 'payment_id',
      value: 'pay_QRs4h5j6k7l8m9',
    });
  });

  it('classifies a Razorpay order id by its order_ prefix', () => {
    expect(classifyPaymentSearchTerm('order_QRs4h5j6k7l8m9')).toEqual({
      kind: 'order_id',
      value: 'order_QRs4h5j6k7l8m9',
    });
  });

  it('classifies a Razorpay subscription id by its sub_ prefix', () => {
    expect(classifyPaymentSearchTerm('sub_QRs4h5j6k7l8m9')).toEqual({
      kind: 'subscription_id',
      value: 'sub_QRs4h5j6k7l8m9',
    });
  });

  it('trims surrounding whitespace before classifying', () => {
    expect(classifyPaymentSearchTerm('  pay_abc123  ')).toEqual({ kind: 'payment_id', value: 'pay_abc123' });
  });

  it('classifies a bare UUID as a user id and lowercases it', () => {
    expect(classifyPaymentSearchTerm('3F2A9B10-1234-4567-89AB-1234567890AB')).toEqual({
      kind: 'user_id',
      value: '3f2a9b10-1234-4567-89ab-1234567890ab',
    });
  });

  it('classifies an email as a directory search, case preserved', () => {
    expect(classifyPaymentSearchTerm('CentiMatters@gmail.com')).toEqual({
      kind: 'directory',
      value: 'CentiMatters@gmail.com',
    });
  });

  it('classifies a display name as a directory search', () => {
    expect(classifyPaymentSearchTerm('Rajeev')).toEqual({ kind: 'directory', value: 'Rajeev' });
  });

  it('does not misclassify a UUID-shaped string with the wrong hyphen positions', () => {
    // Not a valid UUID (missing a hyphen), so it falls through to a directory search rather than
    // being treated as a user id -- this is the case that would silently return zero rows via an
    // exact eq() if it were misclassified.
    expect(classifyPaymentSearchTerm('3f2a9b101234-4567-89ab-1234567890ab').kind).toBe('directory');
  });
});

describe('paymentKindDbValues', () => {
  it('expands "subscription" to both underlying kind values', () => {
    expect(paymentKindDbValues('subscription')).toEqual(['subscription_first', 'subscription_renewal']);
  });

  it('keeps "topup" as a single value', () => {
    expect(paymentKindDbValues('topup')).toEqual(['topup']);
  });

  it('returns null for "all" so the caller applies no kind filter', () => {
    expect(paymentKindDbValues('all')).toBeNull();
  });
});

describe('normalizeAdminPaymentsListInput', () => {
  it('defaults every field when given an empty input', () => {
    expect(normalizeAdminPaymentsListInput({})).toEqual({
      page: 1,
      search: '',
      status: 'all',
      kind: 'all',
      providerMode: 'all',
    });
  });

  it('clamps a non-positive or fractional page to 1 or floors it', () => {
    expect(normalizeAdminPaymentsListInput({ page: 0 }).page).toBe(1);
    expect(normalizeAdminPaymentsListInput({ page: -5 }).page).toBe(1);
    expect(normalizeAdminPaymentsListInput({ page: 3.9 }).page).toBe(3);
  });

  it('rejects an unknown filter value rather than passing it through to the query', () => {
    expect(normalizeAdminPaymentsListInput({ status: 'not_a_status' as never }).status).toBe('all');
    expect(normalizeAdminPaymentsListInput({ kind: 'nope' as never }).kind).toBe('all');
    expect(normalizeAdminPaymentsListInput({ providerMode: 'nope' as never }).providerMode).toBe('all');
  });

  it('trims the search term', () => {
    expect(normalizeAdminPaymentsListInput({ search: '  pay_abc  ' }).search).toBe('pay_abc');
  });
});

describe('computePaymentModeTotals', () => {
  it('never sums test and live together', () => {
    const totals = computePaymentModeTotals(
      [
        { providerMode: 'live', status: 'captured', grossMinor: 10_000, currencyCode: 'INR' },
        { providerMode: 'test', status: 'captured', grossMinor: 53_100, currencyCode: 'INR' },
      ],
      []
    );
    const live = totals.find((t) => t.mode === 'live');
    const test = totals.find((t) => t.mode === 'test');
    expect(live?.grossCapturedMinor).toBe(10_000);
    expect(test?.grossCapturedMinor).toBe(53_100);
  });

  it('sorts live before test', () => {
    const totals = computePaymentModeTotals(
      [
        { providerMode: 'test', status: 'captured', grossMinor: 100, currencyCode: 'INR' },
        { providerMode: 'live', status: 'captured', grossMinor: 200, currencyCode: 'INR' },
      ],
      []
    );
    expect(totals.map((t) => t.mode)).toEqual(['live', 'test']);
  });

  it('counts every payment regardless of status', () => {
    const totals = computePaymentModeTotals(
      [
        { providerMode: 'live', status: 'captured', grossMinor: 100, currencyCode: 'INR' },
        { providerMode: 'live', status: 'failed', grossMinor: 0, currencyCode: 'INR' },
        { providerMode: 'live', status: 'refunded', grossMinor: 100, currencyCode: 'INR' },
      ],
      []
    );
    expect(totals[0].count).toBe(3);
  });

  it('excludes only failed payments from gross captured', () => {
    const totals = computePaymentModeTotals(
      [
        { providerMode: 'live', status: 'captured', grossMinor: 100, currencyCode: 'INR' },
        { providerMode: 'live', status: 'failed', grossMinor: 999, currencyCode: 'INR' },
        { providerMode: 'live', status: 'disputed', grossMinor: 50, currencyCode: 'INR' },
      ],
      []
    );
    expect(totals[0].grossCapturedMinor).toBe(150);
  });

  it('only sums processed refunds, never pending or failed ones', () => {
    const totals = computePaymentModeTotals(
      [{ providerMode: 'live', status: 'refunded', grossMinor: 500, currencyCode: 'INR' }],
      [
        { providerMode: 'live', status: 'processed', amountMinor: 200 },
        { providerMode: 'live', status: 'pending', amountMinor: 9999 },
        { providerMode: 'live', status: 'failed', amountMinor: 9999 },
      ]
    );
    expect(totals[0].refundedMinor).toBe(200);
  });

  it('returns an empty array for no matching rows', () => {
    expect(computePaymentModeTotals([], [])).toEqual([]);
  });
});
