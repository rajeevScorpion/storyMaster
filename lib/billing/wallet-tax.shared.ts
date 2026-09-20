/**
 * Payments Phase 2, Unit B2a (docs/payments/phase-2-unit-b2-plan.md §3): pure GST display maths for
 * the wallet -- the "+ 18% GST" price lines a signed-in user sees before checkout ever runs. Pure and
 * isomorphic (no server-only, no 'use client', no network) so both app/actions/pricing-runtime.ts and
 * components/pricing/WalletPage.tsx import the exact same arithmetic; unit tests target this file
 * directly.
 *
 * previewGrossMinor deliberately reproduces lib/billing/tax.shared.ts's private roundHalfUpTax
 * formula (that function is not exported) rather than inventing its own rounding -- a display total
 * that disagrees with what checkout actually charges by even a paisa is a support ticket.
 * wallet-tax.shared.test.ts proves the two agree by importing computeTax directly and comparing
 * across a spread of amounts and rates, including 18%.
 *
 * formatCurrencyMinor below intentionally duplicates the small amount of Intl formatting logic that
 * also lives in components/pricing/WalletPage.tsx's local formatPrice(), rather than importing it --
 * WalletPage is a 'use client' module, and CLAUDE.md's "never import a plain value from a 'use
 * client' module into server code" rule applies here too, since this file is loaded from the server
 * action in app/actions/pricing-runtime.ts as well as from the client.
 */

/** What the wallet shows before checkout: whether a tax line applies, its label, and whether
 * checkout will require a declared billing state. See app/actions/pricing-runtime.ts for how this is
 * derived from lib/billing/tax-rules.ts's getPublishedTaxRule. */
export interface WalletTaxPreview {
  /** null when no tax applies (no published rule, or a zero-rate/'none' regime): show bare prices. */
  ratePercent: number | null;
  /** 'GST' today; carried so the label is not hardcoded at each call site. */
  taxLabel: string;
  /** True when migration 125 is applied and a rule is published, i.e. checkout WILL demand a state. */
  requiresBillingState: boolean;
}

/**
 * net + tax, rounded half-up to the paisa, matching lib/billing/tax.shared.ts's computeTax exactly.
 * `ratePercent: null` means no tax applies -- returns netMinor unchanged.
 */
export function previewGrossMinor(netMinor: number, ratePercent: number | null): number {
  if (ratePercent === null || !Number.isFinite(netMinor)) {
    return netMinor;
  }

  // Mirrors lib/billing/tax.shared.ts's roundHalfUpTax: integer arithmetic on basis points of the
  // rate (18.00 -> 1800), never floating point, so a repeating fraction like 333 * 18% never drifts.
  const rateBasisPoints = Math.round(ratePercent * 100);
  const taxMinor = Math.floor((netMinor * rateBasisPoints + 5000) / 10000);
  return netMinor + taxMinor;
}

/**
 * Catalogue prices are whole rupees, and WalletPage's own formatPrice drops the fraction for that
 * reason -- but a gross is only a whole rupee when the net is a multiple of 50 (18% of Rs 1 is 18
 * paise). Today's catalogue happens to be all multiples of 50; the next price the owner types in
 * admin need not be. Rs 199 + 18% is Rs 234.82, and showing "Rs 235 total" over a Rs 234.82 debit is
 * the exact disagreement this module exists to prevent, so the paise are shown whenever there are
 * any.
 *
 * Exported (Payments Phase 4, Unit B) so the admin billing panel formats minor-unit amounts the same
 * way the wallet does, rather than hand-rolling a second `/ 100` somewhere.
 */
export function formatCurrencyMinor(currencyCode: string, amountMinor: number): string {
  const locale = currencyCode === 'INR' ? 'en-IN' : 'en-US';
  const hasFraction = amountMinor % 100 !== 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(amountMinor / 100);
}

/** "18" for 18.00, "12.5" for 12.50 -- never a trailing ".00" in the wallet's tax line. */
function formatRatePercent(ratePercent: number): string {
  if (ratePercent % 1 === 0) {
    return ratePercent.toFixed(0);
  }
  return ratePercent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * The small line a wallet price shows once a tax rule is live: "+ 18% GST · ₹1,711 total" for a
 * ₹1,450 net price at 18%. Returns `''` -- render nothing, not an empty element -- when `ratePercent`
 * is `null` (no published rule, or the 'none' regime) or `0` (a published zero-rate rule), so a
 * caller can render `{line && <p>{line}</p>}` unconditionally without a layout shift on the common
 * no-tax path.
 */
export function formatPriceWithTaxLine(
  currencyCode: string,
  netMinor: number,
  ratePercent: number | null,
  taxLabel: string
): string {
  if (ratePercent === null || ratePercent === 0) {
    return '';
  }

  const grossMinor = previewGrossMinor(netMinor, ratePercent);
  return `+ ${formatRatePercent(ratePercent)}% ${taxLabel} · ${formatCurrencyMinor(currencyCode, grossMinor)} total`;
}
