'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { filterAndRankOptions } from './filter-dropdown.shared';

/**
 * Payments Phase 5 (docs/payments/phase-5-plan.md §5, Unit C): keyboard support and an opt-in
 * `searchable` mode for the one shared dropdown every caller in the app uses (CLAUDE.md
 * "Conventions" -- never a native `<select>`). Both are additive: every existing prop keeps its
 * old default behaviour, so the 28 current callers are unaffected unless they opt in.
 */

export interface FilterDropdownOption {
  value: string;
  label: string;
  /** Optional second line in the menu, e.g. what an option is best at. Trigger stays label-only. */
  hint?: string;
}

type DropdownSize = 'compact' | 'form';
type DropdownMode = 'popover' | 'inline';

interface DropdownPosition {
  bottom?: number;
  left: number;
  maxHeight: number;
  maxWidth: number;
  minWidth: number;
  top?: number;
  width?: number;
}

interface ScrollIndicator {
  height: number;
  top: number;
  visible: boolean;
}

const SCROLL_TRACK_INSET = 4;
const MIN_SCROLL_THUMB_HEIGHT = 20;
const MAX_SCROLL_THUMB_HEIGHT = 32;
/** Keys the closed trigger opens the menu on. */
const OPEN_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ']);

export default function FilterDropdown({
  value,
  options,
  onChange,
  fullWidth = false,
  size = 'compact',
  mode = 'popover',
  ariaLabel,
  contextLabel,
  placeholder,
  searchable = false,
  searchPlaceholder,
}: {
  value: string;
  options: FilterDropdownOption[];
  onChange: (value: string) => void;
  fullWidth?: boolean;
  size?: DropdownSize;
  mode?: DropdownMode;
  ariaLabel?: string;
  /** Small field name shown beside the selected value inside the trigger. */
  contextLabel?: string;
  /**
   * Shown, muted, when `value` matches no option -- instead of silently falling back to the
   * first option's label. Omit to keep that old fallback exactly (existing callers do).
   */
  placeholder?: string;
  /** Opt-in: a search box pinned atop the menu that filters options by label. */
  searchable?: boolean;
  /** Overrides the search box's placeholder text. Defaults to "Search…". */
  searchPlaceholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [opensUp, setOpensUp] = useState(false);
  const [menuPosition, setMenuPosition] = useState<DropdownPosition | null>(null);
  const [scrollIndicator, setScrollIndicator] = useState<ScrollIndicator>({
    height: MIN_SCROLL_THUMB_HEIGHT,
    top: 0,
    visible: false,
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();
  const prefersReducedMotion = useReducedMotion();

  const filteredOptions = useMemo(
    () => (searchable ? filterAndRankOptions(options, query) : options),
    [options, query, searchable]
  );

  const optionId = useCallback((index: number) => `${baseId}-option-${index}`, [baseId]);
  const listboxId = `${baseId}-listbox`;
  const activeOptionId = filteredOptions.length > 0 ? optionId(activeIndex) : undefined;

  const closeMenu = useCallback((focusTrigger: boolean) => {
    setIsOpen(false);
    setQuery('');
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [closeMenu]);

  const selected = options.find((o) => o.value === value);
  const showsPlaceholder = !selected && Boolean(placeholder);
  const triggerLabel = selected?.label ?? (placeholder ?? options[0]?.label);
  const isForm = size === 'form';
  const updatePlacement = useCallback(() => {
    if (!ref.current || typeof window === 'undefined') return;

    const rect = ref.current.getBoundingClientRect();
    const viewportPadding = 8;
    const estimatedOptionHeight = isForm ? 44 : 36;
    const optionCount = Math.max(filteredOptions.length, 1); // room for a "No matches" row
    const searchHeaderHeight = searchable ? (isForm ? 52 : 44) : 0;
    const estimatedListHeight = Math.min(optionCount * estimatedOptionHeight + 16, 280);
    const estimatedMenuHeight = estimatedListHeight + searchHeaderHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const nextOpensUp = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      estimatedOptionHeight + 16 + searchHeaderHeight,
      Math.min(280 + searchHeaderHeight, (nextOpensUp ? spaceAbove : spaceBelow) - viewportPadding * 2)
    );
    const maxWidth = Math.max(0, window.innerWidth - viewportPadding * 2);
    const width = mode === 'inline' || fullWidth
      ? Math.min(rect.width, maxWidth)
      : Math.min(Math.max(rect.width, 180), maxWidth);
    const menuWidth = width;
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding)
    );

    setOpensUp(nextOpensUp);
    setMenuPosition({
      bottom: nextOpensUp ? Math.max(viewportPadding, window.innerHeight - rect.top + 4) : undefined,
      left,
      maxHeight,
      maxWidth,
      minWidth: Math.min(rect.width, maxWidth),
      top: nextOpensUp ? undefined : Math.min(window.innerHeight - viewportPadding, rect.bottom - 1),
      width,
    });
  }, [fullWidth, isForm, mode, filteredOptions.length, searchable]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = window.requestAnimationFrame(updatePlacement);
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [isOpen, updatePlacement]);

  const updateScrollIndicator = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    const overflow = element.scrollHeight - element.clientHeight;
    const trackHeight = Math.max(0, element.clientHeight - SCROLL_TRACK_INSET * 2);
    if (overflow <= 1 || trackHeight <= 0) {
      setScrollIndicator((current) => (
        current.visible ? { ...current, visible: false } : current
      ));
      return;
    }

    const height = Math.min(
      trackHeight,
      MAX_SCROLL_THUMB_HEIGHT,
      Math.max(MIN_SCROLL_THUMB_HEIGHT, (element.clientHeight / element.scrollHeight) * trackHeight)
    );
    const top = (element.scrollTop / overflow) * (trackHeight - height);
    setScrollIndicator({ height, top, visible: true });
  }, []);

  useEffect(() => {
    if (!isOpen || !menuPosition) return;

    const frame = window.requestAnimationFrame(updateScrollIndicator);
    const element = scrollRef.current;
    const resizeObserver = element && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateScrollIndicator)
      : null;
    if (element && resizeObserver) resizeObserver.observe(element);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
    };
  }, [isOpen, menuPosition, filteredOptions.length, updateScrollIndicator]);

  // Keep the highlighted row in view as it moves by keyboard.
  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex, filteredOptions]);

  // Searchable: the search box owns focus while the menu is open, so it also owns navigation.
  useEffect(() => {
    if (isOpen && searchable) searchInputRef.current?.focus();
  }, [isOpen, searchable]);

  const openMenu = useCallback(() => {
    updatePlacement();
    const startIndex = Math.max(0, options.findIndex((o) => o.value === value));
    setActiveIndex(startIndex);
    setIsOpen(true);
  }, [options, updatePlacement, value]);

  const moveActive = useCallback((delta: number) => {
    setActiveIndex((current) => {
      const max = Math.max(0, filteredOptions.length - 1);
      return Math.min(max, Math.max(0, current + delta));
    });
  }, [filteredOptions.length]);

  const selectActive = useCallback(() => {
    const option = filteredOptions[activeIndex];
    if (!option) return; // e.g. the "No matches" row
    onChange(option.value);
    closeMenu(true);
  }, [filteredOptions, activeIndex, onChange, closeMenu]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isOpen) {
      if (OPEN_KEYS.has(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    // Reached only in non-searchable mode: searchable moves focus to the search box on open.
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        return;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        e.preventDefault();
        setActiveIndex(Math.max(0, filteredOptions.length - 1));
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectActive();
        return;
      case 'Escape':
        // Stop here: Modal's panel closes on any Escape that bubbles to it, and an Escape meant for
        // an open dropdown must not also dismiss the dialog around it.
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
        return;
      case 'Tab':
        closeMenu(false);
        return;
      default:
        return;
    }
  };

  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        return;
      // Home/End are deliberately left to the text field, so they still move the caret in the query.
      case 'Enter':
        // Never let Enter fall through to a submit on a form this dropdown lives inside.
        e.preventDefault();
        selectActive();
        return;
      case 'Escape':
        // React bubbles portal events through the component tree, so this would otherwise reach and
        // close an enclosing Modal.
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
        return;
      case 'Tab':
        // The search box is portaled to <body>, outside any dialog's focus trap: a default Tab would
        // carry focus out of the dialog. Close and hand focus back to the trigger instead.
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
        return;
      default:
        return;
    }
  };

  const containerClassName = [
    'relative',
    fullWidth ? 'w-full' : '',
    isOpen ? 'z-20' : '',
  ].join(' ').trim();
  const triggerClassName = [
    'flex items-center border bg-neutral-800/80 transition-all duration-200',
    fullWidth ? 'w-full justify-between' : 'gap-2',
    isForm ? 'min-h-12 rounded-2xl px-4 py-3 text-left text-sm' : 'rounded-xl px-3 py-2 text-sm',
    isOpen
      ? 'border-emerald-500/40 text-emerald-300'
      : 'border-white/10 text-neutral-200 hover:border-white/20',
    isOpen ? (opensUp ? 'rounded-t-none' : 'rounded-b-none') : '',
  ].join(' ');
  const menuWrapperClassName = [
    // Portaled to <body>, so it must sit above every dialog that can hold it: Modal is 1100, the
    // story dialogs 1200. At 1000 the list opened behind the billing dialog, invisible and unclickable.
    'fixed z-[1300] overflow-hidden',
    mode === 'inline' || fullWidth ? 'w-full' : '',
  ].join(' ');
  const menuCardClassName = [
    'flex flex-col overflow-hidden bg-neutral-900/95 border border-emerald-500/40 backdrop-blur-xl shadow-2xl',
    isForm
      ? opensUp ? 'rounded-2xl rounded-b-none' : 'rounded-2xl rounded-t-none'
      : opensUp ? 'rounded-xl rounded-b-none' : 'rounded-xl rounded-t-none',
  ].join(' ');
  const listboxClassName = [
    // In normal flow, not absolute: an absolute list adds no height, so its wrapper collapsed and
    // every menu opened at its padding (8px). min-h-0 lets it shrink and scroll under maxHeight.
    'dropdown-scrollbar min-h-0 overflow-y-auto',
    isForm ? 'py-1.5' : 'py-1',
  ].join(' ');
  const optionClassName = [
    'w-full flex items-center gap-2 transition-colors',
    isForm ? 'px-4 py-3 text-sm text-left' : 'px-3 py-2 text-sm text-left',
  ].join(' ');
  const menuMotionProps = prefersReducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.12 },
      }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: 'auto' },
        exit: { opacity: 0, height: 0 },
        transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
      };
  const menu = typeof document !== 'undefined' ? createPortal(
    <AnimatePresence>
      {isOpen && menuPosition && (
        <motion.div
          ref={menuRef}
          {...menuMotionProps}
          className={menuWrapperClassName}
          style={{
            bottom: menuPosition.bottom,
            left: menuPosition.left,
            maxWidth: menuPosition.maxWidth,
            minWidth: menuPosition.minWidth,
            top: menuPosition.top,
            width: menuPosition.width,
          }}
        >
          <div className={menuCardClassName} style={{ maxHeight: menuPosition.maxHeight }}>
            {searchable && (
              <div className={`shrink-0 border-b border-white/10 ${isForm ? 'p-2' : 'p-1.5'}`}>
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500"
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActiveIndex(0);
                    }}
                    onKeyDown={handleSearchInputKeyDown}
                    placeholder={searchPlaceholder ?? 'Search…'}
                    aria-label={ariaLabel ? `Search ${ariaLabel}` : 'Search options'}
                    aria-controls={listboxId}
                    aria-activedescendant={activeOptionId}
                    className="w-full rounded-lg border border-white/10 bg-neutral-950/60 py-1.5 pl-8 pr-2.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-emerald-400/40"
                  />
                </div>
              </div>
            )}
            <div className="relative flex min-h-0 flex-col">
              <div
                ref={scrollRef}
                id={listboxId}
                className={listboxClassName}
                role="listbox"
                onScroll={updateScrollIndicator}
              >
                {filteredOptions.length === 0 ? (
                  <div className={`${optionClassName} cursor-default text-neutral-500`} role="presentation">
                    No matches
                  </div>
                ) : (
                  filteredOptions.map((opt, index) => {
                    const isSelected = opt.value === value;
                    const isActive = index === activeIndex;
                    return (
                      <button
                        type="button"
                        key={opt.value}
                        ref={(el) => {
                          optionRefs.current[index] = el;
                        }}
                        id={optionId(index)}
                        onClick={() => {
                          onChange(opt.value);
                          closeMenu(false);
                        }}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={`${optionClassName} ${
                          isSelected
                            ? 'text-emerald-400'
                            : 'text-neutral-400 hover:text-emerald-300'
                        } ${isActive ? 'bg-emerald-500/10' : 'hover:bg-emerald-500/10'}`}
                        role="option"
                        aria-selected={isSelected}
                      >
                        <Check
                          className={`w-3 h-3 shrink-0 ${
                            isSelected ? 'opacity-100' : 'opacity-0'
                          }`}
                        />
                        {opt.hint ? (
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate">{opt.label}</span>
                            <span className="truncate text-[11px] text-neutral-500">{opt.hint}</span>
                          </span>
                        ) : (
                          opt.label
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              {scrollIndicator.visible && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-1 right-1 top-1 w-1"
                >
                  <span
                    className="absolute left-0 w-1 rounded-full bg-emerald-600/90"
                    style={{ height: scrollIndicator.height, top: scrollIndicator.top }}
                  />
                </span>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  ) : null;

  return (
    <div ref={ref} className={containerClassName}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (isOpen) {
            closeMenu(false);
          } else {
            openMenu();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        className={triggerClassName}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={isOpen && !searchable ? activeOptionId : undefined}
        aria-label={ariaLabel}
      >
        <span className={fullWidth ? 'flex min-w-0 flex-1 items-center justify-between gap-3' : ''}>
          <span
            className={[
              fullWidth ? 'min-w-0 truncate' : '',
              showsPlaceholder ? 'text-neutral-500' : '',
            ].filter(Boolean).join(' ')}
          >
            {triggerLabel}
          </span>
          {contextLabel && (
            <span className="mr-1 shrink-0 whitespace-nowrap text-[10px] font-normal tracking-wide text-neutral-500">
              {contextLabel}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-emerald-400' : 'text-neutral-500'
          }`}
        />
      </button>
      {menu}
    </div>
  );
}
