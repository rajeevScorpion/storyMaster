'use client';

import { Loader2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { CheckoutSheetState } from '@/lib/billing/checkout-sheet.shared';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit E2): the branded "something is happening"
 * screen CheckoutSummarySheet shows between "Continue to secure payment" and a result -- opening the
 * Razorpay window, the window itself, the handler/dismiss check, and the post-confirm poll. One pulse
 * animation, skipped under prefers-reduced-motion, with copy that changes per phase.
 */

const PROGRESS_COPY: Partial<Record<CheckoutSheetState, string>> = {
  opening: 'Opening secure checkout…',
  window: 'Complete the payment in the secure window.',
  verifying: 'Confirming your payment…',
  checking: 'Checking your payment…',
  confirming: 'Confirming your payment…',
};

export default function CheckoutProgress({ state }: { state: CheckoutSheetState }) {
  const prefersReducedMotion = useReducedMotion();
  const copy = PROGRESS_COPY[state];
  if (!copy) return null;

  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center" role="status" aria-live="polite">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10">
        {!prefersReducedMotion && (
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-emerald-400/20"
            animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <Loader2 className="h-6 w-6 animate-spin text-emerald-300" aria-hidden="true" />
      </div>
      <p className="text-sm text-neutral-300">{copy}</p>
    </div>
  );
}
