'use client';

import { motion, useReducedMotion } from 'motion/react';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit D): AuthDialog's glow layer (two
 * blurred blobs, a top sheen, and a looping radial gradient skipped under
 * prefers-reduced-motion), lifted out of components/auth/AuthDialog.tsx so the billing-details
 * dialog can reuse the exact same look instead of carrying a second copy. AuthDialog now imports
 * this rather than rendering it inline; its behaviour is unchanged.
 */
export default function DialogGlow({ className }: { className?: string }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]${className ? ` ${className}` : ''}`}
    >
      <div className="absolute -top-20 left-10 h-44 w-44 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="absolute bottom-0 right-0 h-40 w-40 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/[0.06] to-transparent" />
      {!prefersReducedMotion && (
        <motion.div
          className="absolute -inset-1 rounded-[28px]"
          style={{
            background:
              'radial-gradient(60% 60% at 20% 0%, rgba(52,211,153,0.16), transparent 70%), radial-gradient(50% 50% at 100% 100%, rgba(99,102,241,0.14), transparent 70%)',
          }}
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </div>
  );
}
