'use client';

import { useState, useRef, useEffect, useId, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Info, X } from 'lucide-react';

export default function InfoPopover({
  title,
  ariaLabel,
  children,
}: {
  title: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const open = () => {
    if (!buttonRef.current) return;
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (isMobile) {
      setPanelStyle({
        bottom: 12,
        left: 12,
        right: 12,
      });
      setIsOpen(true);
      return;
    }

    const rect = buttonRef.current.getBoundingClientRect();
    setPanelStyle({
      bottom: window.innerHeight - rect.top + 8,
      left: Math.max(8, Math.min(rect.right - 320, window.innerWidth - 328)),
    });
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // Close if click is outside both button and panel
      if (buttonRef.current?.contains(target)) return;
      const panel = document.getElementById(panelId);
      if (panel?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    const handleScroll = () => setIsOpen(false);

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, panelId]);

  const panel = (
    <AnimatePresence>
      {isOpen && panelStyle && (
        <>
          <motion.button
            type="button"
            aria-label={`Close ${title} details`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-[1090] bg-black/45 md:hidden"
          />
          <motion.div
            id={panelId}
            role="dialog"
            aria-label={title}
            data-info-popover-open="true"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={panelStyle}
            className="fixed z-[1100] max-h-[min(52dvh,24rem)] w-auto overflow-y-auto rounded-2xl border border-white/10 bg-neutral-950 p-4 text-left shadow-2xl shadow-black/60 md:w-80 md:max-h-[75vh]"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-neutral-100">{title}</p>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-white/10 hover:text-neutral-200"
                aria-label={`Close ${title} details`}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-neutral-400">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <div className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-neutral-900/80 text-neutral-400 transition-colors hover:border-emerald-400/40 hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-controls={panelId}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>

      {typeof document !== 'undefined' && createPortal(panel, document.body)}
    </div>
  );
}
