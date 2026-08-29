'use client';

import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';

import { useDialogBehavior } from '@/components/ui/useDialogBehavior';

interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode;
  /** Stacking order for the outer overlay. Defaults to 1100 (matches Modal); bump it to layer a sheet on top of another already-open one. */
  zIndex?: number;
}

/**
 * Bottom sheet for touch layouts. Portals to the body so it escapes animated
 * ancestors, locks background scroll, keeps focus inside while open, and pads
 * for the device's bottom safe area.
 */
export default function Sheet({ isOpen, onClose, title, ariaLabel, children, zIndex = 1100 }: SheetProps) {
  const { panelRef, handleKeyDown } = useDialogBehavior({ isOpen, onClose });
  const prefersReducedMotion = useReducedMotion();

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 flex items-end" style={{ zIndex }} onKeyDown={handleKeyDown}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel ?? title}
            tabIndex={-1}
            initial={prefersReducedMotion ? { opacity: 0 } : { y: '100%' }}
            animate={prefersReducedMotion ? { opacity: 1 } : { y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { y: '100%' }}
            transition={
              prefersReducedMotion
                ? { duration: 0.15 }
                : { type: 'spring', damping: 32, stiffness: 320 }
            }
            className="relative max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl border-t border-white/10 bg-neutral-900 outline-none"
            style={{ paddingBottom: 'max(1.5rem, var(--safe-bottom))' }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/5 bg-neutral-900/95 px-5 py-4 backdrop-blur">
              <h2 className="font-serif text-lg text-neutral-100">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-m-2 flex h-11 w-11 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-5 pt-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
