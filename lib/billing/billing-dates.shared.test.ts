import { describe, expect, it } from 'vitest';

import {
  addBillingMonths,
  billingDayOfMonth,
  formatBillingDateLong,
  formatBillingDateRange,
  formatBillingDateShort,
} from '@/lib/billing/billing-dates.shared';
import { subscriptionBanner } from '@/lib/billing/billing-account.shared';
import { formatRenewalLine } from '@/lib/billing/checkout-quote.shared';

// Razorpay ends a cycle at IST midnight, which is 18:30 UTC the day before.
const RAZORPAY_PERIOD_END = '2026-10-24T18:30:00.000Z';

describe('billing dates are IST', () => {
  it('formats a Razorpay period end as the IST day, not the UTC one', () => {
    expect(formatBillingDateShort(RAZORPAY_PERIOD_END)).toBe('25 Oct 2026');
    expect(formatBillingDateLong(RAZORPAY_PERIOD_END)).toBe('October 25, 2026');
    expect(billingDayOfMonth(RAZORPAY_PERIOD_END)).toBe(25);
  });

  it('returns null for a missing or invalid date', () => {
    expect(formatBillingDateShort(null)).toBeNull();
    expect(formatBillingDateLong('not-a-date')).toBeNull();
    expect(billingDayOfMonth('not-a-date')).toBeNull();
  });

  it('keeps the banner, the cancel dialog and the renewal line on the same day', () => {
    const banner = subscriptionBanner(
      { status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: RAZORPAY_PERIOD_END },
      new Date('2026-09-26T00:00:00.000Z')
    );
    expect(banner?.text).toContain('Cancels on 25 Oct 2026');
    expect(formatRenewalLine('monthly', RAZORPAY_PERIOD_END, 2900, 'USD')).toBe('Renews monthly on the 25th at $29.00.');
  });
});

describe('addBillingMonths', () => {
  it('adds a month on the IST calendar, so a late-evening UTC time keeps its IST day', () => {
    // 20:00 UTC on 25 Sep is 01:30 IST on 26 Sep; a month on is 26 Oct IST.
    const next = addBillingMonths(new Date('2026-09-25T20:00:00.000Z'), 1);
    expect(next.toISOString()).toBe('2026-10-25T20:00:00.000Z');
    expect(billingDayOfMonth(next)).toBe(26);
  });

  it('clamps 31 Jan IST to the end of February', () => {
    const next = addBillingMonths(new Date('2026-01-31T10:00:00.000Z'), 1);
    expect(formatBillingDateShort(next)).toBe('28 Feb 2026');
  });

  it('adds twelve months for a year', () => {
    expect(formatBillingDateShort(addBillingMonths(new Date('2026-06-10T10:00:00.000Z'), 12))).toBe('10 Jun 2027');
  });
});

describe('formatBillingDateRange', () => {
  it('reads oldest first whichever order the ends come in, in IST', () => {
    // 18:30 UTC on the 25th is already the 26th in IST.
    expect(formatBillingDateRange('2026-09-25T18:30:00.000Z', '2026-09-24T10:00:00.000Z')).toBe('24 Sep – 26 Sep 2026');
  });

  it('collapses a single IST day and spells out both years across a new year', () => {
    expect(formatBillingDateRange('2026-09-26T01:00:00.000Z', '2026-09-26T09:00:00.000Z')).toBe('26 Sep 2026');
    expect(formatBillingDateRange('2025-12-30T10:00:00.000Z', '2026-01-02T10:00:00.000Z')).toBe('30 Dec 2025 – 2 Jan 2026');
  });

  it('falls back to the one date it has', () => {
    expect(formatBillingDateRange(null, '2026-09-26T09:00:00.000Z')).toBe('26 Sep 2026');
  });
});
