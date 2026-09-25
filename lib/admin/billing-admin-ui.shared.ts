/**
 * Payments Phase 4, Unit C's UI (docs/payments/audit-progress.md, "Unit C, in the detail a fresh
 * session needs"): the pure pieces of the refund confirmation copy, kept isomorphic and
 * unit-testable without a DOM or a Supabase client -- see CLAUDE.md's *.shared.ts split.
 */

/**
 * Money for a confirmation dialog always shows two decimal places, unlike
 * lib/billing/wallet-tax.shared.ts's formatCurrencyMinor (which drops the ".00" on a round amount
 * for list views) -- a dialog that is about to move real money is exactly the place where "₹531" vs
 * "₹531.00" ambiguity is worth the extra characters.
 */
export function formatMoneyMinorForConfirmation(currencyCode: string, amountMinor: number): string {
  const locale = currencyCode === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export interface RefundGrantMatch {
  /** Coins from this purchase's own grant not yet spent -- what the refund would claw back. */
  remainingCoins: number;
  /** The grant's original size, for the "X of Y" phrasing. */
  totalCoins: number;
}

export interface WalletActivityGrantLookup {
  kind: 'grant' | 'spend';
  source: string;
  sourceRefId: string | null;
  coinsDelta: number;
  remainingCoins: number | null;
}

/**
 * Identifies a top-up payment's own coin grant from the page's already-loaded wallet activity
 * (app/actions/admin-users.ts's buildWalletActivity), so the refund dialog can say "X of Y coins
 * still unspent" instead of generic wording -- without a second server call.
 *
 * Scoped to top-up only, matching exactly how app/actions/admin-billing-actions.ts resolves a
 * top-up grant's source_ref_id (lib/billing/refund-eligibility.shared.ts's
 * resolvePurchaseGrantSourceRef): it is billing_payments.billing_order_id, verbatim. A subscription
 * grant's source_ref_id is a reconstructed `${providerSubscriptionId}:${cycleStartUnix}` that
 * audit-progress.md flags as the riskiest unverified thing in the whole unit -- reproducing that
 * guess here too would risk showing a wrong number in a money dialog, so this deliberately returns
 * null for anything that isn't a top-up and lets the caller fall back to generic wording instead.
 */
export function matchTopupGrantForRefund(
  payment: { kind: string; billingOrderId: string | null },
  walletActivity: readonly WalletActivityGrantLookup[]
): RefundGrantMatch | null {
  if (payment.kind !== 'topup' || !payment.billingOrderId) return null;
  const match = walletActivity.find(
    (item) => item.kind === 'grant' && item.source === 'topup' && item.sourceRefId === payment.billingOrderId
  );
  if (!match || match.remainingCoins === null) return null;
  return { remainingCoins: match.remainingCoins, totalCoins: match.coinsDelta };
}

/**
 * What the admin billing UI's server actions return instead of throwing. Next replaces a thrown
 * server-action error's message with a generic one in production builds, so a refund refused for
 * "too many coins already spent" would reach the admin as "an error occurred" -- the reason has to
 * travel as data. See app/actions/admin-billing-ui-actions.ts.
 */
export type AdminBillingActionResult<T> = { ok: true; result: T } | { ok: false; error: string };

/** Client-side: turns a settled result back into a throw, so callers keep one try/catch path. */
export function unwrapAdminBillingActionResult<T>(settled: AdminBillingActionResult<T>): T {
  if (!settled.ok) throw new Error(settled.error);
  return settled.result;
}
