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

  it('never disagrees with computeTax on the total it displays', () => {
    const netMinor = 339900;
    const ratePercent = 18;
    const expectedGross = computeTax({
      netMinor,
      rule: fakeRule(ratePercent),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    }).grossMinor;

    const line = formatPriceWithTaxLine('INR', netMinor, ratePercent, 'GST');
    const expectedLine = `+ 18% GST · ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(expectedGross / 100)} total`;
    expect(line).toBe(expectedLine);
  });

  it('shows no tax line when the rate is null (no published rule, or the none regime)', () => {
    expect(formatPriceWithTaxLine('INR', 145000, null, 'GST')).toBe('');
  });

  it('shows no tax line under a published zero-rate rule', () => {
    expect(formatPriceWithTaxLine('INR', 145000, 0, 'GST')).toBe('');
  });

  it('uses the supplied label rather than hardcoding GST', () => {
    expect(formatPriceWithTaxLine('USD', 100000, 10, 'VAT')).toContain('VAT');
  });
});
