import { describe, it, expect } from 'vitest';
import { computeTax, computeTaxFromGross, splitRefundProportionally, type TaxRuleInput } from './tax.shared';

const GUJARAT = '24';
const MAHARASHTRA = '27';

function fakeRule(overrides: Partial<TaxRuleInput> = {}): TaxRuleInput {
  return {
    id: 'rule-1',
    marketKey: 'IN',
    appliesTo: 'all',
    taxRegime: 'in_gst',
    ratePercent: 18,
    sacCode: '998439',
    supplierStateCode: GUJARAT,
    ...overrides,
  };
}

describe('computeTax', () => {
  it('computes net/tax/gross for a simple intra-state 18% charge', () => {
    const result = computeTax({
      netMinor: 1000,
      rule: fakeRule(),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });

    expect(result).toEqual({
      netMinor: 1000,
      taxMinor: 180,
      grossMinor: 1180,
      breakdown: {
        ruleId: 'rule-1',
        marketKey: 'IN',
        appliesTo: 'all',
        taxRegime: 'in_gst',
        ratePercent: 18,
        sacCode: '998439',
        supplierStateCode: GUJARAT,
        placeOfSupplyStateCode: GUJARAT,
        supplyType: 'intra_state',
        cgstMinor: 90,
        sgstMinor: 90,
        igstMinor: 0,
      },
    });
  });

  it('charges IGST, not CGST/SGST, when the place of supply is a different state', () => {
    const result = computeTax({
      netMinor: 1000,
      rule: fakeRule(),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: MAHARASHTRA,
    });

    expect(result.taxMinor).toBe(180);
    expect(result.grossMinor).toBe(1180);
    expect(result.breakdown.supplyType).toBe('inter_state');
    expect(result.breakdown.cgstMinor).toBe(0);
    expect(result.breakdown.sgstMinor).toBe(0);
    expect(result.breakdown.igstMinor).toBe(180);
  });

  it('rounds the tax half-up to the paisa', () => {
    // 100 * 12.50% = 12.5 exactly -> half-up rounds to 13.
    const atHalf = computeTax({
      netMinor: 100,
      rule: fakeRule({ ratePercent: 12.5 }),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });
    expect(atHalf.taxMinor).toBe(13);

    // 1000 * 1.23% = 12.3 -> rounds down to 12.
    const belowHalf = computeTax({
      netMinor: 1000,
      rule: fakeRule({ ratePercent: 1.23 }),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });
    expect(belowHalf.taxMinor).toBe(12);

    // 1000 * 1.28% = 12.8 -> rounds up to 13.
    const aboveHalf = computeTax({
      netMinor: 1000,
      rule: fakeRule({ ratePercent: 1.28 }),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });
    expect(aboveHalf.taxMinor).toBe(13);

    // 333 * 18% = 59.94 -> rounds up to 60.
    const repeatingFraction = computeTax({
      netMinor: 333,
      rule: fakeRule({ ratePercent: 18 }),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });
    expect(repeatingFraction.taxMinor).toBe(60);
  });

  it('gives the odd paisa of a CGST/SGST split to CGST', () => {
    const result = computeTax({
      netMinor: 339,
      rule: fakeRule({ ratePercent: 18 }),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });

    expect(result.taxMinor).toBe(61); // odd
    expect(result.breakdown.cgstMinor).toBe(31);
    expect(result.breakdown.sgstMinor).toBe(30);
    expect(result.breakdown.cgstMinor + result.breakdown.sgstMinor).toBe(61);
  });

  it('never rounds the gross itself -- it is always net + tax', () => {
    const result = computeTax({
      netMinor: 339,
      rule: fakeRule({ ratePercent: 18 }),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });

    expect(result.grossMinor).toBe(result.netMinor + result.taxMinor);
  });

  it('charges no tax under a zero-rate rule, but still classifies the supply', () => {
    const result = computeTax({
      netMinor: 1000,
      rule: fakeRule({ ratePercent: 0 }),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });

    expect(result.taxMinor).toBe(0);
    expect(result.grossMinor).toBe(1000);
    expect(result.breakdown.supplyType).toBe('intra_state');
    expect(result.breakdown.cgstMinor).toBe(0);
    expect(result.breakdown.sgstMinor).toBe(0);
    expect(result.breakdown.igstMinor).toBe(0);
  });

  it('charges no tax at all under the none regime, regardless of rate', () => {
    const result = computeTax({
      netMinor: 1000,
      rule: fakeRule({ taxRegime: 'none', ratePercent: 18 }),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: MAHARASHTRA,
    });

    expect(result.taxMinor).toBe(0);
    expect(result.grossMinor).toBe(1000);
    expect(result.breakdown.supplyType).toBe('none');
  });

  it('rejects a non-integer or negative net amount', () => {
    expect(() =>
      computeTax({ netMinor: 10.5, rule: fakeRule(), supplierStateCode: GUJARAT, placeOfSupplyStateCode: GUJARAT })
    ).toThrow();
    expect(() =>
      computeTax({ netMinor: -100, rule: fakeRule(), supplierStateCode: GUJARAT, placeOfSupplyStateCode: GUJARAT })
    ).toThrow();
  });

  it('handles a zero net amount', () => {
    const result = computeTax({
      netMinor: 0,
      rule: fakeRule(),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });

    expect(result).toMatchObject({ netMinor: 0, taxMinor: 0, grossMinor: 0 });
  });
});

describe('computeTaxFromGross', () => {
  it('reverses computeTax exactly for a gross that came from computeTax', () => {
    const forward = computeTax({
      netMinor: 19900,
      rule: fakeRule(),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });

    const reversed = computeTaxFromGross({
      grossMinor: forward.grossMinor,
      rule: fakeRule(),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });

    expect(reversed.netMinor).toBe(forward.netMinor);
    expect(reversed.taxMinor).toBe(forward.taxMinor);
    expect(reversed.grossMinor).toBe(forward.grossMinor);
  });

  it('always adds net + tax back up to exactly the given gross, even off a rate that does not divide evenly', () => {
    const result = computeTaxFromGross({
      grossMinor: 1000,
      rule: fakeRule({ ratePercent: 18 }),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });

    expect(result.netMinor + result.taxMinor).toBe(1000);
    expect(result.grossMinor).toBe(1000);
  });

  it('classifies inter-state supply and splits IGST, matching computeTax', () => {
    const result = computeTaxFromGross({
      grossMinor: 1180,
      rule: fakeRule(),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: MAHARASHTRA,
    });

    expect(result.breakdown.supplyType).toBe('inter_state');
    expect(result.breakdown.cgstMinor).toBe(0);
    expect(result.breakdown.sgstMinor).toBe(0);
    expect(result.breakdown.igstMinor).toBe(result.taxMinor);
  });

  it('treats the whole gross as net under the none regime or a zero rate', () => {
    const none = computeTaxFromGross({
      grossMinor: 1000,
      rule: fakeRule({ taxRegime: 'none' }),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });
    expect(none).toMatchObject({ netMinor: 1000, taxMinor: 0, grossMinor: 1000 });

    const zeroRate = computeTaxFromGross({
      grossMinor: 1000,
      rule: fakeRule({ ratePercent: 0 }),
      supplierStateCode: GUJARAT,
      placeOfSupplyStateCode: GUJARAT,
    });
    expect(zeroRate).toMatchObject({ netMinor: 1000, taxMinor: 0, grossMinor: 1000 });
  });

  it('rejects a non-integer or negative gross amount', () => {
    expect(() =>
      computeTaxFromGross({ grossMinor: 10.5, rule: fakeRule(), supplierStateCode: GUJARAT, placeOfSupplyStateCode: GUJARAT })
    ).toThrow();
    expect(() =>
      computeTaxFromGross({ grossMinor: -100, rule: fakeRule(), supplierStateCode: GUJARAT, placeOfSupplyStateCode: GUJARAT })
    ).toThrow();
  });
});

describe('splitRefundProportionally', () => {
  it('splits a full refund back into exactly the original net and tax', () => {
    const result = splitRefundProportionally(1180, 1000, 1180);
    expect(result).toEqual({ netMinor: 1000, taxMinor: 180 });
  });

  it('splits a partial refund proportionally, remainder to tax', () => {
    // Original: net 1000, tax 180, gross 1180. Refunding 590 (half): net share = floor(590*1000/1180) = 500.
    const result = splitRefundProportionally(590, 1000, 1180);
    expect(result.netMinor + result.taxMinor).toBe(590);
    expect(result.netMinor).toBe(500);
    expect(result.taxMinor).toBe(90);
  });

  it('treats the whole refund as net when the original gross is zero or invalid', () => {
    expect(splitRefundProportionally(500, 0, 0)).toEqual({ netMinor: 500, taxMinor: 0 });
  });

  it('rejects a non-integer or negative refund amount', () => {
    expect(() => splitRefundProportionally(10.5, 1000, 1180)).toThrow();
    expect(() => splitRefundProportionally(-100, 1000, 1180)).toThrow();
  });
});
