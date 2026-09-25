/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E1): measures checkout's own server-side
 * steps -- auth, catalogue load, tax, the begin-checkout RPC, the Razorpay plan-ref lookup, the
 * provider create call, and the order write -- so the owner can read where three subscribes and three
 * top-ups actually spend their time on the Preview, from the `[checkout-timing]` log line and the
 * `Server-Timing` response header. Measurement only: this unit does not reorder or optimise anything.
 * Pure and isomorphic (an injectable clock) so it needs no mocking to unit test.
 */

export type CheckoutTimingStep =
  | 'auth'
  | 'catalogue'
  | 'tax'
  | 'rpc'
  | 'plan_ref'
  | 'provider_create'
  | 'order_write';

export interface CheckoutTimingEntry {
  step: CheckoutTimingStep;
  durationMs: number;
}

export interface CheckoutTimer {
  /** Records the time elapsed since the timer was created (or since the previous mark) as this step. */
  mark(step: CheckoutTimingStep): void;
  entries(): CheckoutTimingEntry[];
  /** `"auth;dur=12.3, catalogue;dur=45.6"` -- the `Server-Timing` header's own syntax. */
  toServerTiming(): string;
}

export function createCheckoutTimer(now: () => number = () => performance.now()): CheckoutTimer {
  let last = now();
  const entries: CheckoutTimingEntry[] = [];

  return {
    mark(step) {
      const current = now();
      entries.push({ step, durationMs: current - last });
      last = current;
    },
    entries() {
      return [...entries];
    },
    toServerTiming() {
      return entries.map((entry) => `${entry.step};dur=${entry.durationMs.toFixed(1)}`).join(', ');
    },
  };
}
