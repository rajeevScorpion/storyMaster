'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, MoreVertical } from 'lucide-react';

export interface RowAction {
  key: string;
  label: string;
  icon: typeof MoreVertical;
  /** Navigating actions render as links so they keep middle-click and open-in-new-tab. */
  href?: string;
  onSelect?: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

interface RowActionsMenuProps {
  actions: RowAction[];
  /** Names the trigger for screen readers, e.g. "Actions for The Tiny Robot's Quest". */
  ariaLabel: string;
  /** Shows a spinner in place of the dots while a chosen action is running. */
  busy?: boolean;
  className?: string;
}

const MENU_WIDTH = 208;
const VIEWPORT_MARGIN = 8;
const ESTIMATED_ITEM_HEIGHT = 40;

/**
 * Overflow menu for list rows.
 *
 * List cards used to fan their actions out as a row of bare icons, which cost
 * every card a wide reserved gutter and, because the icons were revealed on
 * hover, left touch devices with no way to reach them at all. One always-visible
 * trigger fixes both: the row keeps its width for content, and the actions are
 * labelled rather than guessed from an icon.
 *
 * The menu is portalled to the body because these rows live inside scrolling,
 * animated containers (the My Stories drawer) that would otherwise clip it.
 * Being portalled, it is positioned against the trigger's viewport rect and
 * simply closes if anything scrolls underneath it.
 */
export default function RowActionsMenu({
  actions,
  ariaLabel,
  busy = false,
  className = '',
}: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  // Set on first open, and kept afterwards so the exit animation still has a
  // place to play out. Null until then, which also keeps SSR and the first
  // client render agreeing that there is no portal yet.
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const placeMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const estimatedHeight = actions.length * ESTIMATED_ITEM_HEIGHT + 12;
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip above the trigger when the menu would run off the bottom — rows
    // near the end of a long list are exactly where actions get used.
    const top = spaceBelow < estimatedHeight + VIEWPORT_MARGIN
      ? Math.max(VIEWPORT_MARGIN, rect.top - estimatedHeight - 6)
      : rect.bottom + 6;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN
    );

    setPosition({ top, left });
  }, [actions.length]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // A portalled menu can't follow its trigger through a scroll, so close
    // rather than let it drift away from the row it belongs to.
    const handleScrollOrResize = () => setOpen(false);

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open]);

  if (actions.length === 0) return null;

  const toggle = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!open) placeMenu();
    setOpen((value) => !value);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
          open
            ? 'border-white/20 bg-neutral-800 text-white'
            : 'border-transparent text-neutral-500 hover:border-white/10 hover:bg-white/5 hover:text-neutral-200'
        } ${className}`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-neutral-300" />
        ) : (
          <MoreVertical className="h-4 w-4" />
        )}
      </button>

      {position && typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open && (
                <motion.div
                  ref={menuRef}
                  role="menu"
                  aria-label={ariaLabel}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
                  className="fixed z-[60] overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/95 py-1.5 shadow-2xl backdrop-blur-md"
                >
                  {actions.map((action) => {
                    const Icon = action.icon;
                    const toneClass = action.disabled
                      ? 'cursor-not-allowed text-neutral-600'
                      : action.tone === 'danger'
                        ? 'text-red-300 hover:bg-red-500/10 hover:text-red-200'
                        : 'text-neutral-200 hover:bg-white/10 hover:text-white';
                    const content = (
                      <>
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{action.label}</span>
                      </>
                    );
                    const itemClass = `flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-sans transition-colors ${toneClass}`;

                    if (action.href && !action.disabled) {
                      return (
                        <Link
                          key={action.key}
                          href={action.href}
                          role="menuitem"
                          className={itemClass}
                          onClick={() => {
                            setOpen(false);
                            action.onSelect?.();
                          }}
                        >
                          {content}
                        </Link>
                      );
                    }

                    return (
                      <button
                        key={action.key}
                        type="button"
                        role="menuitem"
                        disabled={action.disabled}
                        className={itemClass}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (action.disabled) return;
                          setOpen(false);
                          action.onSelect?.();
                        }}
                      >
                        {content}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )
        : null}
    </>
  );
}
