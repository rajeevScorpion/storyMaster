'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, ShoppingBag, X } from 'lucide-react';

import Modal from '@/components/ui/Modal';
import DialogGlow from '@/components/ui/DialogGlow';
import { quoteCheckout } from '@/app/actions/billing-account';
import { formatCurrencyMinor } from '@/lib/billing/wallet-tax.shared';
import { formatRenewalLine, type CheckoutQuote } from '@/lib/billing/checkout-quote.shared';
import {
  canCloseCheckoutSheet,
  nextCheckoutSheetState,
  type CheckoutSheetEvent,
  type CheckoutSheetState,
} from '@/lib/billing/checkout-sheet.shared';
import { pollUntilPaid, startRazorpayCheckout, type CheckoutOutcome } from '@/components/pricing/checkout/useRazorpayCheckout';
import CheckoutProgress from '@/components/pricing/checkout/CheckoutProgress';
import type { PrepareRazorpayCheckoutInput, PricingMarketKey } from '@/lib/types/pricing';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): the pre-payment summary + progress
 * sheet. It quotes the price (creates nothing), collects the P6 attestation, then drives
 * startRazorpayCheckout and shows what's happening around the Razorpay window instead of leaving the
 * customer looking at a button label. State transitions live in checkout-sheet.shared.ts's pure
 * reducer; this component only wires that reducer to the quote/checkout calls and the markup.
 */

export interface CheckoutSummarySheetProps {
  open: boolean;
  /** null when nothing is selected -- the sheet renders nothing in that case. Set together with
   * `open` by the caller (WalletPage), so the quote-loading effect below can key off `open` alone. */
  target: PrepareRazorpayCheckoutInput | null;
  pricingMarketKey: PricingMarketKey;
  /** Whether Razorpay's checkout.js has finished loading -- the caller owns the <Script> and the flag
   * (useRazorpayCheckout's `ready`), since it's shared with the rest of the page. */
  razorpayReady: boolean;
  /** Extra display-only context WalletPage already has for the selected plan; omitted for a top-up. */
  unlimitedWatching?: boolean;
  onClose: () => void;
  /** The quote came back "billing details incomplete" -- the caller closes this sheet and opens the
   * billing-details dialog, then reopens the sheet with the same target once it's saved. */
  onNeedsBillingDetails: () => void;
  /** Called once the sheet knows money may have moved (a success, or a pending payment now being
   * polled) so the caller can refresh wallet/plan data. May be called more than once. */
  onSettled: () => void;
}

function describeSuccessFromQuote(quote: CheckoutQuote | null): string {
  if (!quote) return 'Payment received.';
  if (quote.kind === 'subscription') {
    return quote.coins > 0
      ? `Your ${quote.title} plan is active. ${quote.coins.toLocaleString()} coins were added.`
      : `Your ${quote.title} plan is active.`;
  }
  return `${quote.coins.toLocaleString()} coins were added to your wallet.`;
}

const PROGRESS_STATES: ReadonlySet<CheckoutSheetState> = new Set(['opening', 'window', 'verifying', 'checking', 'confirming']);

const SECONDARY_BUTTON_CLASS =
  'rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-white/20 hover:text-white';
const PRIMARY_BUTTON_CLASS =
  'w-full rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50';

export default function CheckoutSummarySheet({
  open,
  target,
  pricingMarketKey,
  razorpayReady,
  unlimitedWatching,
  onClose,
  onNeedsBillingDetails,
  onSettled,
}: CheckoutSummarySheetProps) {
  const [state, setState] = useState<CheckoutSheetState>('quoting');
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteErrorMessage, setQuoteErrorMessage] = useState<string | null>(null);
  const [prepareErrorMessage, setPrepareErrorMessage] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  // Bumped on every open, so a poll still running from an earlier session can't write into this one.
  const sessionRef = useRef(0);

  const send = useCallback((event: CheckoutSheetEvent) => {
    setState((current) => nextCheckoutSheetState(current, event));
  }, []);

  // Fresh session every time the sheet opens -- a re-open after a previous success/failure must not
  // carry that result forward. Keyed on `open` alone (not `target`): WalletPage sets both together in
  // the same click handler, so `target` is already current by the time this effect body runs.
  useEffect(() => {
    if (!open || !target) return;

    let cancelled = false;
    sessionRef.current += 1;
    setState('quoting');
    setQuote(null);
    setQuoteErrorMessage(null);
    setPrepareErrorMessage(null);
    setResultMessage(null);
    setAttested(false);

    (async () => {
      const result = await quoteCheckout(target, pricingMarketKey);
      if (cancelled) return;

      if (result.ok) {
        setQuote(result.quote);
        setState((current) => nextCheckoutSheetState(current, 'quote_ok'));
        return;
      }

      if ('needsBillingDetails' in result) {
        setState((current) => nextCheckoutSheetState(current, 'quote_needs_details'));
        onNeedsBillingDetails();
        return;
      }

      setQuoteErrorMessage(result.error);
      setState((current) => nextCheckoutSheetState(current, 'quote_error'));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyOutcome = useCallback(
    async (outcome: CheckoutOutcome, session: number) => {
      if (sessionRef.current !== session) return;
      switch (outcome.kind) {
        case 'success':
          // The quote, not verify's text: when the webhook settles first, verify only knows the
          // grant "has already been applied", which reads wrong to someone who just paid.
          setResultMessage(quote ? describeSuccessFromQuote(quote) : outcome.message);
          send('success');
          onSettled();
          break;
        case 'confirming': {
          send('confirming');
          onSettled();
          const pollResult = await pollUntilPaid(outcome.internalOrderId);
          if (sessionRef.current !== session) return;
          if (pollResult === 'paid') {
            setResultMessage(describeSuccessFromQuote(quote));
            send('success');
            onSettled();
          } else {
            send('still_confirming');
          }
          break;
        }
        case 'failed':
          setResultMessage(outcome.message);
          send('failed');
          break;
        case 'dismissed':
          send('dismissed');
          break;
      }
    },
    [quote, send, onSettled]
  );

  const handleContinue = useCallback(async () => {
    if (!target || !attested || !razorpayReady) return;

    setPrepareErrorMessage(null);
    send('continue');
    const session = sessionRef.current;

    try {
      const outcome = await startRazorpayCheckout({
        input: target,
        pricingMarketKey,
        adultAttested: true,
        onProgress: (phase) => {
          if (sessionRef.current !== session) return;
          if (phase === 'window') send('window_opened');
          else if (phase === 'verifying') send('verifying');
          else if (phase === 'checking') send('checking');
        },
      });
      await applyOutcome(outcome, session);
    } catch (err) {
      if (sessionRef.current !== session) return;
      // startRazorpayCheckout only rejects for a prepare failure -- its message is already sanitised
      // (app/api/billing/razorpay/prepare/route.ts).
      setPrepareErrorMessage(err instanceof Error ? err.message : 'Failed to start checkout.');
      send('prepare_failed');
    }
  }, [target, attested, razorpayReady, pricingMarketKey, applyOutcome, send]);

  const requestClose = useCallback(() => {
    if (!canCloseCheckoutSheet(state)) return;
    onClose();
  }, [state, onClose]);

  if (!target) return null;

  const closable = canCloseCheckoutSheet(state);

  return (
    <Modal isOpen={open} onClose={requestClose} ariaLabel="Checkout" showCloseButton={false} maxWidthClassName="max-w-md">
      <DialogGlow />
      <div className="relative space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShoppingBag className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
            <div>
              <h2 className="text-lg font-serif text-neutral-100">{quote ? quote.title : 'Checkout'}</h2>
              {quote && (
                <p className="mt-0.5 text-xs text-neutral-500">
                  {quote.kind === 'topup' ? 'One-time top-up' : quote.interval === 'annual' ? 'Yearly plan' : 'Monthly plan'}
                </p>
              )}
            </div>
          </div>
          {closable && (
            <button
              type="button"
              onClick={requestClose}
              aria-label="Close"
              className="-m-2 flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-neutral-100"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {state === 'quoting' && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading price…
          </div>
        )}

        {state === 'quote_error' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {quoteErrorMessage ?? "We couldn't load the price. Please try again in a moment."}
            </div>
            <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
              Close
            </button>
          </div>
        )}

        {state === 'needs_details' && (
          <div className="py-6 text-sm text-neutral-400">Opening billing details…</div>
        )}

        {state === 'summary' && quote && (
          <div className="space-y-5">
            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-neutral-400">Total</span>
                <span className="text-2xl text-neutral-100">{formatCurrencyMinor(quote.currencyCode, quote.grossMinor)}</span>
              </div>
              {quote.taxLines.length > 0 && (
                <p className="text-xs text-neutral-500">
                  {formatCurrencyMinor(quote.currencyCode, quote.netMinor)}
                  {' + '}
                  {quote.taxLines
                    .map((line) => `${line.label} ${formatCurrencyMinor(quote.currencyCode, line.amountMinor)}`)
                    .join(' + ')}
                </p>
              )}
              {quote.interval === 'annual' && (
                <p className="text-xs text-neutral-500">
                  ≈ {formatCurrencyMinor(quote.currencyCode, Math.round(quote.grossMinor / 12))} / month
                </p>
              )}
            </div>

            <div className="space-y-1.5 text-sm text-neutral-300">
              {quote.kind === 'subscription' ? (
                <>
                  <p>
                    {formatRenewalLine(quote.interval, quote.nextChargeDate)} Cancel anytime; you keep access until
                    the period ends.
                  </p>
                  {quote.coins > 0 && (
                    <p>{quote.coins.toLocaleString()} coins each month. They reset every cycle and don&apos;t roll over.</p>
                  )}
                  {unlimitedWatching && <p>Unlimited watching.</p>}
                </>
              ) : (
                <p>{quote.coins.toLocaleString()} coins. Top-up coins never expire.</p>
              )}
            </div>

            {prepareErrorMessage && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {prepareErrorMessage}
              </div>
            )}

            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-neutral-300">
              <input
                type="checkbox"
                checked={attested}
                onChange={(event) => setAttested(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-emerald-500"
              />
              <span>
                I&apos;m 18 or older and I&apos;m the one paying for this purchase. See the{' '}
                <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-emerald-300 underline-offset-2 hover:underline">
                  Terms
                </Link>{' '}
                and the{' '}
                <Link href="/refund-policy" target="_blank" rel="noopener noreferrer" className="text-emerald-300 underline-offset-2 hover:underline">
                  Refund Policy
                </Link>
                .
              </span>
            </label>

            <button
              type="button"
              disabled={!attested || !razorpayReady}
              onClick={() => void handleContinue()}
              className={PRIMARY_BUTTON_CLASS}
            >
              {razorpayReady ? 'Continue to secure payment' : 'Loading checkout…'}
            </button>
          </div>
        )}

        {PROGRESS_STATES.has(state) && <CheckoutProgress state={state} />}

        {state === 'success' && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-300" />
            <p className="text-sm text-neutral-200">{resultMessage ?? describeSuccessFromQuote(quote)}</p>
            <div className="flex justify-center gap-3">
              <Link href="/account/billing" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                View receipt and billing
              </Link>
              <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                Done
              </button>
            </div>
          </div>
        )}

        {state === 'still_confirming' && (
          <div className="space-y-4 py-4 text-center">
            <Loader2 className="mx-auto h-8 w-8 text-emerald-300" />
            <p className="text-sm text-neutral-200">
              This can take a few minutes with UPI. It will be applied automatically, and you can leave this page.
            </p>
            <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
              Close
            </button>
          </div>
        )}

        {state === 'failed' && (
          <div className="space-y-4 py-4 text-center">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {resultMessage ?? "That payment didn't go through, and you haven't been charged for it. You can try again."}
            </div>
            <div className="flex justify-center gap-3">
              <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
                Close
              </button>
              <button type="button" onClick={() => send('retry')} className={SECONDARY_BUTTON_CLASS}>
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
