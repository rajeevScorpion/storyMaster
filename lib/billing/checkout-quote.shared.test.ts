import { describe, it, expect } from 'vitest';

import { addBillingInterval, formatRenewalLine, taxLinesFromBreakdown } from './checkout-quote.shared';
import type { TaxBreakdown } from './tax.shared';

function breakdown(overrides: Partial<TaxBreakdown>): TaxBreakdown {
  return {
    ruleId: 'rule-1',
    marketKey: 'IN',
    appliesTo: 'subscription',
    taxRegime: 'in_gst',
    ratePercent: 18,
    sacCode: null,
    supplierStateCode: '27',
    placeOfSupplyStateCode: '27',
    supplyType: 'intra_state',
    cgstMinor: 0,
    sgstMinor: 0,
    igstMinor: 0,
    ...overrides,
  };
}

describe('taxLinesFromBreakdown', () => {
  it('returns IGST alone for an inter-state supply', () => {
    expect(taxLinesFromBreakdown(breakdown({ supplyType: 'inter_state', igstMinor: 1800 }))).toEqual([
      { label: 'IGST', amountMinor: 1800 },
    ]);
  });

  it('returns CGST + SGST for an intra-state supply', () => {
    expect(taxLinesFromBreakdown(breakdown({ supplyType: 'intra_state', cgstMinor: 900, sgstMinor: 900 }))).toEqual([
      { label: 'CGST', amountMinor: 900 },
      { label: 'SGST', amountMinor: 900 },
    ]);
  });

  it('returns no lines for a none supply type', () => {
    expect(taxLinesFromBreakdown(breakdown({ supplyType: 'none' }))).toEqual([]);
  });

  it('returns no lines when there is no breakdown at all', () => {
    expect(taxLinesFromBreakdown(null)).toEqual([]);
  });

  // Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): the checkout sheet shows no tax
  // line for a zero-rated export -- the invoice itself still prints an explicit "IGST @ 0%" row
  // (document-view.shared.ts), but there's nothing for the pre-payment quote to break out.
  it('returns no lines for an export supply', () => {
    expect(taxLinesFromBreakdown(breakdown({ taxRegime: 'in_export_lut', ratePercent: 0, supplyType: 'export' }))).toEqual([]);
  });
});

describe('addBillingInterval', () => {
  it('adds one month for monthly', () => {
    const result = addBillingInterval(new Date(Date.UTC(2026, 0, 15)), 'monthly');
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(1);
    expect(result.getUTCDate()).toBe(15);
  });

  it('clamps 31 Jan + 1 month to the last day of February (non-leap year)', () => {
    const result = addBillingInterval(new Date(Date.UTC(2026, 0, 31)), 'monthly');
    expect(result.getUTCMonth()).toBe(1);
    expect(result.getUTCDate()).toBe(28);
  });

  it('clamps 31 Jan + 1 month to 29 Feb in a leap year', () => {
    const result = addBillingInterval(new Date(Date.UTC(2028, 0, 31)), 'monthly');
    expect(result.getUTCMonth()).toBe(1);
    expect(result.getUTCDate()).toBe(29);
  });

  it('rolls over into the next year', () => {
    const result = addBillingInterval(new Date(Date.UTC(2026, 11, 20)), 'monthly');
    expect(result.getUTCFullYear()).toBe(2027);
    expect(result.getUTCMonth()).toBe(0);
    expect(result.getUTCDate()).toBe(20);
  });

  it('adds one year for annual', () => {
    const result = addBillingInterval(new Date(Date.UTC(2026, 5, 10)), 'annual');
    expect(result.getUTCFullYear()).toBe(2027);
    expect(result.getUTCMonth()).toBe(5);
    expect(result.getUTCDate()).toBe(10);
  });
});

describe('formatRenewalLine', () => {
  it('formats a monthly renewal with an ordinal day and the amount', () => {
    expect(formatRenewalLine('monthly', '2026-09-24T00:00:00.000Z', 53100, 'INR')).toBe(
      'Renews monthly on the 24th at ₹531.'
    );
  });

  it('formats an ordinal correctly for 1st, 2nd, 3rd and the 11-13 exception', () => {
    expect(formatRenewalLine('monthly', '2026-09-01T00:00:00.000Z', 53100, 'INR')).toContain('1st');
    expect(formatRenewalLine('monthly', '2026-09-02T00:00:00.000Z', 53100, 'INR')).toContain('2nd');
    expect(formatRenewalLine('monthly', '2026-09-03T00:00:00.000Z', 53100, 'INR')).toContain('3rd');
    expect(formatRenewalLine('monthly', '2026-09-11T00:00:00.000Z', 53100, 'INR')).toContain('11th');
    expect(formatRenewalLine('monthly', '2026-09-12T00:00:00.000Z', 53100, 'INR')).toContain('12th');
    expect(formatRenewalLine('monthly', '2026-09-13T00:00:00.000Z', 53100, 'INR')).toContain('13th');
  });

  it('formats an annual renewal with the full date and the amount', () => {
    expect(formatRenewalLine('annual', '2027-09-24T00:00:00.000Z', 531000, 'INR')).toBe(
      'Renews yearly on September 24, 2027 at ₹5,310.'
    );
  });

  it('formats a non-round amount with paise shown', () => {
    expect(formatRenewalLine('monthly', '2026-09-24T00:00:00.000Z', 53182, 'INR')).toBe(
      'Renews monthly on the 24th at ₹531.82.'
    );
  });

  it('returns an empty string with no interval or no date', () => {
    expect(formatRenewalLine(null, '2026-09-24T00:00:00.000Z', 53100, 'INR')).toBe('');
    expect(formatRenewalLine('monthly', null, 53100, 'INR')).toBe('');
  });

  // Payments Phase 8 (docs/payments/phase-8-plan.md §9, Unit D): a USD renewal always shows cents,
  // even on a whole dollar -- unlike the INR case above, which drops them.
  it('always shows cents for a non-INR currency, even on a whole dollar', () => {
    expect(formatRenewalLine('monthly', '2026-09-24T00:00:00.000Z', 2900, 'USD')).toBe(
      'Renews monthly on the 24th at $29.00.'
    );
  });

  it('shows cents for a non-round USD amount too', () => {
    expect(formatRenewalLine('monthly', '2026-09-24T00:00:00.000Z', 2999, 'USD')).toBe(
      'Renews monthly on the 24th at $29.99.'
    );
  });
});
