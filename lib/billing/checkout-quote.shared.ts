import type { TaxBreakdown } from '@/lib/billing/tax.shared';
import type { BillingInterval } from '@/lib/types/pricing';
import { formatCurrencyMinor } from '@/lib/billing/wallet-tax.shared';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): what `quoteCheckout`
 * (app/actions/billing-account.ts) returns to price a checkout before any Razorpay order or
 * subscription exists -- the same net/tax/gross arithmetic prepare uses, read-only. Pure and
 * isomorphic so the checkout summary sheet's copy (renewal date, tax lines) is unit-tested directly,
 * without mocking the DB or Razorpay.
 */

export interface CheckoutQuoteTaxLine {
  label: 'IGST' | 'CGST' | 'SGST';
  amountMinor: number;
}

export interface CheckoutQuote {
  kind: 'subscription' | 'topup';
  title: string;
  currencyCode: string;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
  ratePercent: number | null;
  taxLines: CheckoutQuoteTaxLine[];
  coins: number;
  interval: BillingInterval | null;
  /** ISO date string, today plus one interval. Subscriptions only -- null for a top-up. */
  nextChargeDate: string | null;
}

/** `inter_state` gives IGST; `intra_state` gives CGST + SGST; `none` or no breakdown gives no tax
 * lines at all (a database without migration 125, or a published zero-rate/'none' rule). */
export function taxLinesFromBreakdown(breakdown: TaxBreakdown | null): CheckoutQuoteTaxLine[] {
  if (!breakdown) return [];
  if (breakdown.supplyType === 'inter_state') {
    return [{ label: 'IGST', amountMinor: breakdown.igstMinor }];
  }
  if (breakdown.supplyType === 'intra_state') {
    return [
      { label: 'CGST', amountMinor: breakdown.cgstMinor },
      { label: 'SGST', amountMinor: breakdown.sgstMinor },
    ];
  }
  return [];
}

/** One month or one year later, clamped to the target month's last day -- 31 Jan + 1 month is
 * 28/29 Feb, never 3 Mar. Works in UTC calendar terms so it is independent of the caller's timezone. */
export function addBillingInterval(date: Date, interval: BillingInterval): Date {
  const monthsToAdd = interval === 'annual' ? 12 : 1;
  const targetMonthIndex = date.getUTCMonth() + monthsToAdd;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(date.getUTCDate(), daysInTargetMonth);

  return new Date(Date.UTC(targetYear, targetMonth, targetDay, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
}

function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

/** "Renews monthly on the 24th at ₹531." for a monthly plan; annual shows the full date, since "the
 * 24th" alone would drop the year a customer actually cares about for a once-a-year charge. Payments
 * Phase 7 (docs/payments/phase-7-plan.md §8, B1): the amount that renews is part of the disclosure --
 * the line never states a date without the price attached to it. Returns '' when there is no interval
 * or date to show (a top-up), so a caller can render `{line && <p>{line}</p>}`. */
export function formatRenewalLine(
  interval: BillingInterval | null,
  nextChargeDate: string | null,
  grossMinor: number,
  currencyCode: string
): string {
  if (!interval || !nextChargeDate) return '';
  const date = new Date(nextChargeDate);
  if (Number.isNaN(date.getTime())) return '';
  const amount = formatCurrencyMinor(currencyCode, grossMinor);

  if (interval === 'annual') {
    const formatted = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return `Renews yearly on ${formatted} at ${amount}.`;
  }

  return `Renews monthly on the ${ordinal(date.getUTCDate())} at ${amount}.`;
}
