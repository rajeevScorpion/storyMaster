'use client';

import { createElement, useState } from 'react';
import Script from 'next/script';
import { RAZORPAY_CHECKOUT_SCRIPT_URL } from '@/lib/billing/razorpay-shared';
import { describeCheckoutFailure, type RazorpayCheckoutFailure } from '@/lib/billing/checkout-errors.shared';
import { getMyCheckoutStatus } from '@/app/actions/billing-account';
import { dismissOutcomeAtTimeout, endsDismissPoll, type CheckoutOrderState } from '@/lib/billing/checkout-status.shared';
import type {
  PrepareRazorpayCheckoutInput,
  PreparedRazorpayCheckout,
  PricingMarketKey,
} from '@/lib/types/pricing';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): `requestPreparedRazorpayCheckout` and
 * `openRazorpayCheckout` moved out of WalletPage.tsx so /wallet, /plans (G) and /account/billing (F)
 * can share one implementation. WalletPage's own behaviour is unchanged apart from the fixes this unit
 * makes on purpose (see the outcome shape below).
 */

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on?: (event: string, handler: (payload: any) => void) => void;
    };
  }
}

/**
 * What a checkout attempt ends in, once Razorpay's window has actually opened. Deliberately never a
 * rejection for a dismissal (defect 5) -- `startRazorpayCheckout` only rejects for a prepare failure,
 * whose message is already sanitised by the server (app/api/billing/razorpay/prepare/route.ts).
 */
export type CheckoutOutcome =
  | { kind: 'success'; message: string }
  | { kind: 'confirming' }
  | { kind: 'failed'; message: string }
  | { kind: 'dismissed' };

const GENERIC_PREPARE_ERROR = "We couldn't start checkout. Please try again in a moment.";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 20000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestPreparedRazorpayCheckout(payload: {
  input: PrepareRazorpayCheckoutInput;
  pricingMarketKey: PricingMarketKey;
  adultAttested: boolean;
}): Promise<PreparedRazorpayCheckout> {
  let response: Response;
  try {
    response = await fetch('/api/billing/razorpay/prepare', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(GENERIC_PREPARE_ERROR);
  }

  const rawText = await response.text().catch(() => '');
  let data: { ok?: boolean; error?: string; checkout?: PreparedRazorpayCheckout } | null = null;

  if (rawText) {
    try {
      data = JSON.parse(rawText) as { ok?: boolean; error?: string; checkout?: PreparedRazorpayCheckout };
    } catch {
      data = null;
    }
  }

  if (!response.ok || !data?.ok) {
    // The route only ever returns a CheckoutRefusalError's own message or its generic 500 sentence,
    // so data.error is safe. A body that isn't the route's JSON (a platform timeout page) is not.
    throw new Error(data?.error || GENERIC_PREPARE_ERROR);
  }

  return data.checkout as PreparedRazorpayCheckout;
}

/** Polls getMyCheckoutStatus after the customer closes the Razorpay window without the handler firing
 * (defect 5 -- a UPI approval can still land after the window is gone). A top-up's own `failed` status
 * is not a stop condition (defect 10): only `paid` and `confirming` end the poll early. */
async function pollAfterDismiss(
  internalOrderId: string,
  lastFailure: RazorpayCheckoutFailure | null
): Promise<CheckoutOutcome> {
  const attempts = Math.floor(POLL_TIMEOUT_MS / POLL_INTERVAL_MS);
  let lastState: CheckoutOrderState | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const status = await getMyCheckoutStatus(internalOrderId);
      lastState = status.state;

      if (endsDismissPoll(status.state)) {
        return status.state === 'paid'
          ? { kind: 'success', message: "Payment received. It's being applied to your account." }
          : { kind: 'confirming' };
      }
    } catch {
      // A transient read failure keeps polling rather than giving up early.
    }
  }

  switch (dismissOutcomeAtTimeout({ lastState, failureRecorded: lastFailure !== null })) {
    case 'failed':
      return { kind: 'failed', message: describeCheckoutFailure(lastFailure) };
    case 'dismissed':
      return { kind: 'dismissed' };
    case 'confirming':
      return { kind: 'confirming' };
  }
}

function openRazorpayCheckoutWindow(checkout: PreparedRazorpayCheckout): Promise<CheckoutOutcome> {
  const RazorpayCtor = window.Razorpay;

  if (!RazorpayCtor) {
    return Promise.reject(new Error('Razorpay checkout is not ready yet'));
  }

  return new Promise<CheckoutOutcome>((resolve, reject) => {
    let settled = false;
    let lastFailure: RazorpayCheckoutFailure | null = null;

    const settle = (outcome: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const options: Record<string, unknown> = {
      key: checkout.keyId,
      name: checkout.displayName,
      description: checkout.description,
      // Owner, 2026-09-24: the favicon's "k" mark, rendered at 256px by app/brand/checkout-mark/route.tsx
      // from the same drawing app/icon.tsx uses at 64px (lib/brand/kissago-mark.tsx). No binary file.
      image: `${window.location.origin}/brand/checkout-mark`,
      prefill: {
        name: checkout.userName ?? undefined,
        email: checkout.userEmail ?? undefined,
        contact: checkout.userPhone ?? undefined,
      },
      theme: {
        color: '#10b981',
        backdrop_color: '#0a0a0a',
      },
      modal: {
        confirm_close: true,
        ondismiss: () => {
          void pollAfterDismiss(checkout.internalOrderId, lastFailure).then(settle);
        },
      },
      handler: async (response: any) => {
        try {
          const verifyResponse = await fetch('/api/billing/razorpay/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(
              checkout.kind === 'subscription'
                ? {
                    kind: 'subscription',
                    internalOrderId: checkout.internalOrderId,
                    razorpayPaymentId: response.razorpay_payment_id,
                    razorpaySignature: response.razorpay_signature,
                    razorpaySubscriptionId: response.razorpay_subscription_id,
                  }
                : {
                    kind: 'topup',
                    internalOrderId: checkout.internalOrderId,
                    razorpayPaymentId: response.razorpay_payment_id,
                    razorpaySignature: response.razorpay_signature,
                    razorpayOrderId: response.razorpay_order_id,
                  }
            ),
          });

          const payload = await verifyResponse.json().catch(() => null);

          if (!verifyResponse.ok) {
            // 409 (refunded) and 402 (payment could not be completed) are verify's own sentences --
            // ours, and safe. Every other status (400/401/404/500) maps through the shared default
            // rather than trusting arbitrary response text (defect 4: map by status, not by text).
            const isOwnSentence = verifyResponse.status === 409 || verifyResponse.status === 402;
            const message =
              isOwnSentence && typeof payload?.error === 'string' ? payload.error : describeCheckoutFailure(null);
            settle({ kind: 'failed', message });
            return;
          }

          settle({ kind: 'success', message: payload?.message || 'Checkout completed successfully.' });
        } catch {
          settle({ kind: 'failed', message: describeCheckoutFailure(null) });
        }
      },
    };

    if (checkout.kind === 'subscription') {
      options.subscription_id = checkout.razorpaySubscriptionId;
    } else {
      options.order_id = checkout.razorpayOrderId;
      options.amount = checkout.amountMinor;
      options.currency = checkout.currencyCode;
    }

    const instance = new RazorpayCtor(options);
    if (typeof instance.on === 'function') {
      // Records the failure for the dismiss poll to describe later; never settles here (defect 3) --
      // Razorpay keeps its window open after a failed attempt so the customer can retry, and a
      // retry that then succeeds must still resolve as success, not a stale failure.
      instance.on('payment.failed', (event: any) => {
        lastFailure = (event?.error as RazorpayCheckoutFailure | undefined) ?? null;
      });
    }

    try {
      instance.open();
    } catch (err) {
      settleReject(err instanceof Error ? err : new Error('Failed to open Razorpay checkout'));
    }
  });
}

/**
 * The one entry point /wallet, /plans and /account/billing all call. Rejects only when preparing the
 * checkout failed (an already-sanitised message); every outcome after Razorpay's window opens comes
 * back as a resolved CheckoutOutcome instead, dismissal included.
 */
export async function startRazorpayCheckout(payload: {
  input: PrepareRazorpayCheckoutInput;
  pricingMarketKey: PricingMarketKey;
  adultAttested: boolean;
}): Promise<CheckoutOutcome> {
  const checkout = await requestPreparedRazorpayCheckout(payload);
  return openRazorpayCheckoutWindow(checkout);
}

export interface UseRazorpayCheckoutResult {
  ready: boolean;
  start: typeof startRazorpayCheckout;
  onScriptLoad: () => void;
  onScriptError: () => void;
}

/** Owns the readiness flag the shared <RazorpayScript> below reports into -- a plain hook, since the
 * checkout logic itself needs no React state of its own. */
export function useRazorpayCheckout(): UseRazorpayCheckoutResult {
  const [ready, setReady] = useState(false);

  return {
    ready,
    start: startRazorpayCheckout,
    onScriptLoad: () => setReady(true),
    onScriptError: () => setReady(false),
  };
}

/** The one `<Script>` that loads Razorpay's checkout.js, shared by every surface that can open
 * checkout. Renders nothing when `enabled` is false (checkout off, or the market isn't Razorpay).
 * createElement rather than JSX because the spec names this file `.ts`. */
export function RazorpayScript({
  enabled,
  onLoad,
  onError,
}: {
  enabled: boolean;
  onLoad: () => void;
  onError: () => void;
}) {
  if (!enabled) return null;

  return createElement(Script, { src: RAZORPAY_CHECKOUT_SCRIPT_URL, strategy: 'afterInteractive', onLoad, onError });
}
