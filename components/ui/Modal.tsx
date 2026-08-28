'use client';

import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';

import { useDialogBehavior } from '@/components/ui/useDialogBehavior';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode;
  /** Tailwind max-width class for the panel. Defaults to a compact form-sized modal. */
  maxWidthClassName?: string;
  /** Set false when the caller renders its own close affordance inside `children` (e.g. a custom header layout). */
  showCloseButton?: boolean;
  /** Stacking order for the outer overlay. Defaults to 1100 (matches Sheet); bump it to layer a modal on top of another already-open one. */
  zIndex?: number;
}

/**
 * Desktop-centered counterpart to Sheet — same underlying mechanics
 * (useDialogBehavior: portal-independent scroll lock, focus trap, focus
 * restore), different geometry. Used together as the responsive pair for the
 * legal document viewer (Sheet on mobile, Modal on desktop) and as the base
 * for the redesigned AuthDialog.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  ariaLabel,
  children,
  maxWidthClassName = 'max-w-md',
  showCloseButton = true,
  zIndex = 1100,
}: ModalProps) {
  const { panelRef, handleKeyDown } = useDialogBehavior({ isOpen, onClose });
  const prefersReducedMotion = useReducedMotion();

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center px-4"
          style={{ zIndex }}
          onKeyDown={handleKeyDown}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel ?? title}
            tabIndex={-1}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.96 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className={`relative flex max-h-[85dvh] w-full ${maxWidthClassName} flex-col overflow-hidden rounded-[28px] border border-white/10 bg-neutral-950/95 shadow-2xl outline-none`}
            onClick={(event) => event.stopPropagation()}
          >
            {title ? (
              <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
                <h2 className="text-lg font-serif text-neutral-100">{title}</h2>
                {showCloseButton ? (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="-m-2 flex h-11 w-11 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
                  >
                    <X className="h-5 w-5" />
                  </button>
                ) : null}
              </div>
            ) : showCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-neutral-400 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}

            <div className="overflow-y-auto px-6 py-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
