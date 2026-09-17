/**
 * Payments Phase 2 (docs/payments/phase-2-plan.md §4, Unit A): pure GST arithmetic on integer
 * minor units (paise). No imports from server modules and no DB/provider types -- the rule, the
 * supplier state and the place of supply are passed in by the caller (lib/billing/tax-rules.ts on
 * the server, tests everywhere else), so this module stays isomorphic and independently testable.
 *
 * Rounding (plan §4): tax is computed on the net, rounded half-up to the paisa; the gross is never
 * rounded afterwards (net + tax, both already integers). A CGST/SGST split's odd paisa goes to CGST.
 */

export type GstSupplyType = 'intra_state' | 'inter_state' | 'none';

/** The subset of a billing_tax_rules row computeTax needs -- not the DB row itself, so this module
 * never has to import lib/types/database.ts. */
export interface TaxRuleInput {
  id: string | null;
  marketKey: string;
  appliesTo: string;
  taxRegime: 'in_gst' | 'none';
  ratePercent: number;
  sacCode: string | null;
}

/** Stored verbatim in billing_payments.tax_breakdown_json / billing_documents.tax_breakdown_json. */
export interface TaxBreakdown {
  ruleId: string | null;
  marketKey: string;
  appliesTo: string;
  taxRegime: 'in_gst' | 'none';
  ratePercent: number;
  sacCode: string | null;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
  supplyType: GstSupplyType;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
}

export interface TaxComputationResult {
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  breakdown: TaxBreakdown;
}

export interface ComputeTaxInput {
  netMinor: number;
  rule: TaxRuleInput;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
}

export function computeTax(input: ComputeTaxInput): TaxComputationResult {
  const { netMinor, rule, supplierStateCode, placeOfSupplyStateCode } = input;

  if (!Number.isInteger(netMinor) || netMinor < 0) {
    throw new Error(`computeTax: netMinor must be a non-negative integer minor-unit amount, got ${netMinor}`);
  }

  const taxMinor = rule.taxRegime === 'in_gst' ? roundHalfUpTax(netMinor, rule.ratePercent) : 0;
  const grossMinor = netMinor + taxMinor;

  const supplyType: GstSupplyType =
    rule.taxRegime !== 'in_gst'
      ? 'none'
      : supplierStateCode === placeOfSupplyStateCode
        ? 'intra_state'
        : 'inter_state';

  const { cgstMinor, sgstMinor, igstMinor } = splitGstComponents(taxMinor, supplyType);

  return {
    netMinor,
    taxMinor,
    grossMinor,
    breakdown: {
      ruleId: rule.id,
      marketKey: rule.marketKey,
      appliesTo: rule.appliesTo,
      taxRegime: rule.taxRegime,
      ratePercent: rule.ratePercent,
      sacCode: rule.sacCode,
      supplierStateCode,
      placeOfSupplyStateCode,
      supplyType,
      cgstMinor,
      sgstMinor,
      igstMinor,
    },
  };
}

/** net * rate% rounded half-up to the nearest paisa, done in integer arithmetic (basis points of
 * the rate) so a repeating fraction like 333 * 18% = 59.94 never touches floating point rounding. */
function roundHalfUpTax(netMinor: number, ratePercent: number): number {
  const rateBasisPoints = Math.round(ratePercent * 100); // 18.00 -> 1800
  const numerator = netMinor * rateBasisPoints;
  return Math.floor((numerator + 5000) / 10000);
}

function splitGstComponents(
  taxMinor: number,
  supplyType: GstSupplyType
): { cgstMinor: number; sgstMinor: number; igstMinor: number } {
  if (supplyType === 'inter_state') {
    return { cgstMinor: 0, sgstMinor: 0, igstMinor: taxMinor };
  }
  if (supplyType === 'intra_state') {
    const cgstMinor = Math.ceil(taxMinor / 2); // odd paisa goes to CGST
    return { cgstMinor, sgstMinor: taxMinor - cgstMinor, igstMinor: 0 };
  }
  return { cgstMinor: 0, sgstMinor: 0, igstMinor: 0 };
}
