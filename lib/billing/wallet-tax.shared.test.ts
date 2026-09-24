import { describe, it, expect } from 'vitest';
import { formatPriceWithTaxLine, previewGrossMinor } from './wallet-tax.shared';
import { computeTax, type TaxRuleInput } from './tax.shared';

const GUJARAT = '24';

function fakeRule(ratePercent: number, overrides: Partial<TaxRuleInput> = {}): TaxRuleInput {
  return {
    id: 'rule-1',
    marketKey: 'IN',
    appliesTo: 'topup',
    taxRegime: 'in_gst',
    ratePercent,
    sacCode: '998439',
    supplierStateCode: GUJARAT,
    ...overrides,
  };
}

describe('previewGrossMinor', () => {
  it('agrees with computeTax.grossMinor across a spread of amounts and rates, including 18%', () => {
    const amounts = [0, 1, 99, 100, 333, 339, 1000, 14500, 19900, 123456];
    const rates = [0, 1.23, 5, 12.5, 18, 28, 100];

    for (const netMinor of amounts) {
      for (const ratePercent of rates) {
        const expected = computeTax({
          netMinor,
          rule: fakeRule(ratePercent),
          supplierStateCode: GUJARAT,
          placeOfSupplyStateCode: GUJARAT,
        }).grossMinor;

        expect(previewGrossMinor(netMinor, ratePercent)).toBe(expected);
      }
    }
  });

  it('agrees with computeTax.grossMinor for an inter-state supply too (tax total is supply-type independent)', () => {
    const MAHARASHTRA = '27';
    const expected = computeTax({
      netMinor: 14500,
      rule: fakeRule(18),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: MAHARASHTRA,
    }).grossMinor;

    expect(previewGrossMinor(14500, 18)).toBe(expected);
  });

  it('returns the net unchanged when the rate is null', () => {
    expect(previewGrossMinor(14500, null)).toBe(14500);
    expect(previewGrossMinor(0, null)).toBe(0);
    expect(previewGrossMinor(999, null)).toBe(999);
  });

  it('returns the net unchanged under a zero rate', () => {
    expect(previewGrossMinor(14500, 0)).toBe(14500);
  });
});

describe('formatPriceWithTaxLine', () => {
  it('renders the rate and the exact gross total for a live rule', () => {
    // ₹1,450 net at 18% -> ₹1,711 gross, matching the worked example in the B2a plan.
    expect(formatPriceWithTaxLine('INR', 145000, 18, 'GST')).toBe('+ 18% GST · ₹1,711 total');
  });

  it('trims a trailing .00 but keeps a real fraction', () => {
    expect(formatPriceWithTaxLine('INR', 100000, 18, 'GST')).toContain('+ 18% GST');
    expect(formatPriceWithTaxLine('INR', 100000, 12.5, 'GST')).toContain('+ 12.5% GST');
  });

  it('never disagrees with computeTax on the total it displays, down to the paisa', () => {
    // The expectation is written out in rupees and paise by hand rather than run back through the
    // same Intl formatter the code under test uses -- formatted against itself, this assertion would
    // hold no matter how the total were rounded, which is how a 99-paise gap hides.
    const cases: { netMinor: number; expectedTotal: string }[] = [
      { netMinor: 145000, expectedTotal: '₹1,711' },      // Rs 1,450 -> a whole rupee, no paise shown
      { netMinor: 19900, expectedTotal: '₹234.82' },      // Rs 199 -> 82 paise, and they must be shown
      { netMinor: 99900, expectedTotal: '₹1,178.82' },
      { netMinor: 339900, expectedTotal: '₹4,010.82' },
    ];

    for (const { netMinor, expectedTotal } of cases) {
      const chargedGross = computeTax({
        netMinor,
        rule: fakeRule(18),
        supplierStateCode: GUJARAT,
        placeOfSupplyStateCode: GUJARAT,
      }).grossMinor;

      // What the user is told, and what the card is debited, are the same number.
      expect(formatPriceWithTaxLine('INR', netMinor, 18, 'GST')).toBe(`+ 18% GST · ${expectedTotal} total`);
      expect(expectedTotal.replace(/[₹,]/g, '')).toBe(
        chargedGross % 100 === 0 ? String(chargedGross / 100) : (chargedGross / 100).toFixed(2)
      );
    }
  });

  it('shows no tax line when the rate is null (no published rule, or the none regime)', () => {
    expect(formatPriceWithTaxLine('INR', 145000, null, 'GST')).toBe('');
  });

  it('shows no tax line under a published zero-rate rule', () => {
    expect(formatPriceWithTaxLine('INR', 145000, 0, 'GST')).toBe('');
  });

  it('shows no tax line for a free (zero-price) plan even with a live rate', () => {
    expect(formatPriceWithTaxLine('INR', 0, 18, 'GST')).toBe('');
  });

  it('uses the supplied label rather than hardcoding GST', () => {
    expect(formatPriceWithTaxLine('USD', 100000, 10, 'VAT')).toContain('VAT');
  });
});
