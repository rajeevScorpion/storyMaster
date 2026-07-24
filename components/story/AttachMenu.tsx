'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Plus } from 'lucide-react';

/**
 * `pending` = the gate that decides this option is still resolving. The row is
 * rendered greyed out from the very first paint so options never pop into the
 * menu after an async check settles — the menu's shape is stable the whole time.
 */
export type AttachMenuOptionState = 'ready' | 'pending' | 'disabled';

export interface AttachMenuOption {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  state: AttachMenuOptionState;
  /** Replaces the description while the option is unavailable. */
  disabledReason?: string;
  /** Work is in flight for this option (e.g. an upload) — shows a spinner. */
  busy?: boolean;
  onSelect: () => void;
}

/** Menu width cap in px (19rem), matched to the popup's max width. */
const MENU_WIDTH = 304;
/** Rough per-row height, used only to decide whether to flip above the trigger. */
const ROW_HEIGHT = 52;
/** Gap between the anchor's bottom edge and the popup. */
const TRIGGER_GAP = 10;
/** Minimum distance the popup keeps from any viewport edge. */
const VIEWPORT_MARGIN = 12;

/**
 * A single `+` button that opens a popup menu of attach actions, replacing a row
 * of inline buttons that could not fit narrow screens. The trigger is one fixed
 * size at every width, so the toolbar can never overflow no matter how many
 * options exist.
 *
 * The popup is portalled to `document.body` and positioned from the trigger's
 * rect: the landing composer sits inside an animated `motion.div`, whose
 * transform creates a stacking context that would otherwise trap the menu below
 * later siblings (the prompt carousel, Advanced Options) no matter its z-index.
 */
export default function AttachMenu({
  open,
  onOpenChange,
  options,
  anchorEl,
  ariaLabel = 'Add characters and worlds',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: AttachMenuOption[];
  /**
   * Element the popup aligns to. The trigger now sits *inside* the composer
   * pill, so anchoring to the button itself would open the menu overlapping the
   * pill's lower edge — pass the pill to drop the menu clear of it instead.
   */
  anchorEl?: HTMLElement | null;
  ariaLabel?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const updatePosition = useCallback(() => {
    const anchor = anchorEl ?? triggerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);

    let left = rect.left;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - VIEWPORT_MARGIN - width;
    }
    left = Math.max(VIEWPORT_MARGIN, left);

    const estimatedHeight = options.length * ROW_HEIGHT + TRIGGER_GAP;
    let top = rect.bottom + TRIGGER_GAP;
    if (top + estimatedHeight > window.innerHeight - VIEWPORT_MARGIN) {
      const above = rect.top - estimatedHeight - TRIGGER_GAP;
      if (above > VIEWPORT_MARGIN) top = above;
    }

    setPosition({ top, left, width });
  }, [options.length, anchorEl]);

  // The opening measurement happens in the click handler below, not here, so the
  // effect only ever subscribes to external events.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', updatePosition);
    // Capture phase so the menu tracks any scrolling ancestor, not just window.
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // The trigger toggles itself — closing here too would immediately reopen.
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, close]);

  const popup = (
    <AnimatePresence>
      {open && position && (
        <motion.div
          ref={menuRef}
          role="menu"
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.12 }}
          style={{ top: position.top, left: position.left, width: position.width }}
          className="fixed z-[90] origin-top-left space-y-0.5 overflow-hidden rounded-xl border border-white/10 bg-neutral-900 p-2 shadow-2xl"
        >
          {options.map((option) => {
            const interactive = option.state === 'ready' && !option.busy;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                disabled={!interactive}
                aria-disabled={!interactive}
                onClick={() => {
                  if (!interactive) return;
                  close();
                  option.onSelect();
                }}
                className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-all duration-200 ${
                  interactive
                    ? 'text-neutral-100 hover:bg-emerald-500/10 hover:text-emerald-50 hover:shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35),0_0_22px_rgba(16,185,129,0.16)]'
                    : 'cursor-default text-neutral-500 opacity-60'
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] transition-colors duration-200 ${
                    interactive ? 'group-hover:border-emerald-400/40 group-hover:bg-emerald-500/15' : ''
                  }`}
                >
                  {option.busy || option.state === 'pending' ? (
                    <Loader2 size={13} className="animate-spin text-neutral-400" />
                  ) : (
                    option.icon
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{option.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-neutral-500">
                    {option.state === 'pending'
                      ? 'Checking availability…'
                      : option.state === 'disabled'
                        ? option.disabledReason ?? 'Not available'
                        : option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) {
            onOpenChange(false);
            return;
          }
          // Measure before opening so the popup's first paint is already in the
          // right place — no flash at the default position.
          updatePosition();
          onOpenChange(true);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-all duration-200 hover:bg-emerald-500/15 hover:text-emerald-200 hover:shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35),0_0_16px_rgba(16,185,129,0.2)]"
      >
        <Plus size={16} className={`transition-transform duration-200 ${open ? 'rotate-45' : ''}`} />
      </button>

      {typeof document !== 'undefined' && createPortal(popup, document.body)}
    </div>
  );
}
