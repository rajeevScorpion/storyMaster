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
  /** Unit B (docs/payments/phase-2-plan.md §4): the rule's own registered supplier state --
   * carried on the rule (not hardcoded from business-config) because a rate change can, in
   * principle, also change where the supply is registered from. computeTax still takes
   * `supplierStateCode` as an explicit top-level argument rather than reading `rule.supplierStateCode`
   * itself, so the pure function has no implicit rule-reads; callers pass `rule.supplierStateCode`
   * through. */
  supplierStateCode: string;
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

export interface ComputeTaxFromGrossInput {
  grossMinor: number;
  rule: TaxRuleInput;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
}

/**
 * Unit B (docs/payments/phase-2-plan.md §4): reverses computeTax for a subscription renewal, where
 * only the gross is known -- Razorpay charges the fixed plan amount on its own schedule, so there is
 * no fresh checkout to compute net-then-add-tax from. `net = floor(gross * 10000 / (10000 + rate_bp))`,
 * `tax = gross - net`, so the two always add back up to the given gross exactly (mirroring
 * computeTax's own "the gross is never rounded" rule, applied in reverse: the whole rounding
 * remainder lands in tax, never in net).
 */
export function computeTaxFromGross(input: ComputeTaxFromGrossInput): TaxComputationResult {
  const { grossMinor, rule, supplierStateCode, placeOfSupplyStateCode } = input;

  if (!Number.isInteger(grossMinor) || grossMinor < 0) {
    throw new Error(`computeTaxFromGross: grossMinor must be a non-negative integer minor-unit amount, got ${grossMinor}`);
  }

  const supplyType: GstSupplyType =
    rule.taxRegime !== 'in_gst'
      ? 'none'
      : supplierStateCode === placeOfSupplyStateCode
        ? 'intra_state'
        : 'inter_state';

  if (rule.taxRegime !== 'in_gst' || rule.ratePercent === 0) {
    return {
      netMinor: grossMinor,
      taxMinor: 0,
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
        cgstMinor: 0,
        sgstMinor: 0,
        igstMinor: 0,
      },
    };
  }

  const rateBasisPoints = Math.round(rule.ratePercent * 100); // 18.00 -> 1800
  const netMinor = Math.floor((grossMinor * 10000) / (10000 + rateBasisPoints));
  const taxMinor = grossMinor - netMinor;

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

export interface RefundSplitResult {
  netMinor: number;
  taxMinor: number;
}

/**
 * Unit B (docs/payments/phase-2-plan.md §4): splits a refunded amount proportionally into net and
 * tax using the ORIGINAL payment's own net/gross ratio -- a refund is never re-taxed from scratch.
 * `net = floor(refund * originalNet / originalGross)`, `tax = refund - net`, so the two always add
 * back up to the refunded amount exactly, same odd-remainder-to-the-second-field convention as
 * computeTax/computeTaxFromGross. A zero or invalid original gross (should never happen for a real
 * captured payment) falls back to treating the whole refund as net, rather than dividing by zero.
 */
export function splitRefundProportionally(
  refundMinor: number,
  originalNetMinor: number,
  originalGrossMinor: number
): RefundSplitResult {
  if (!Number.isInteger(refundMinor) || refundMinor < 0) {
    throw new Error(`splitRefundProportionally: refundMinor must be a non-negative integer minor-unit amount, got ${refundMinor}`);
  }

  if (!Number.isInteger(originalGrossMinor) || originalGrossMinor <= 0) {
    return { netMinor: refundMinor, taxMinor: 0 };
  }

  const netMinor = Math.floor((refundMinor * originalNetMinor) / originalGrossMinor);
  const taxMinor = refundMinor - netMinor;
  return { netMinor, taxMinor };
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
