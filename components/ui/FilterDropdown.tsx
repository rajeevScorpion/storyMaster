'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export interface FilterDropdownOption {
  value: string;
  label: string;
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

export default function FilterDropdown({
  value,
  options,
  onChange,
  fullWidth = false,
  size = 'compact',
  mode = 'popover',
  ariaLabel,
  contextLabel,
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
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [opensUp, setOpensUp] = useState(false);
  const [menuPosition, setMenuPosition] = useState<DropdownPosition | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find((o) => o.value === value);
  const isForm = size === 'form';
  const updatePlacement = useCallback(() => {
    if (!ref.current || typeof window === 'undefined') return;

    const rect = ref.current.getBoundingClientRect();
    const viewportPadding = 8;
    const estimatedOptionHeight = isForm ? 44 : 36;
    const estimatedMenuHeight = Math.min(options.length * estimatedOptionHeight + 16, 280);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const nextOpensUp = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      estimatedOptionHeight + 16,
      Math.min(280, (nextOpensUp ? spaceAbove : spaceBelow) - viewportPadding * 2)
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
  }, [fullWidth, isForm, mode, options.length]);

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
    'fixed z-[1000] overflow-hidden',
    mode === 'inline' || fullWidth ? 'w-full' : '',
  ].join(' ');
  const menuClassName = [
    'dropdown-scrollbar max-h-72 overflow-y-auto bg-neutral-900/95 border border-emerald-500/40 backdrop-blur-xl shadow-2xl',
    isForm
      ? opensUp ? 'rounded-2xl rounded-b-none py-1.5' : 'rounded-2xl rounded-t-none py-1.5'
      : opensUp ? 'rounded-xl rounded-b-none py-1' : 'rounded-xl rounded-t-none py-1',
  ].join(' ');
  const optionClassName = [
    'w-full flex items-center gap-2 transition-colors',
    isForm ? 'px-4 py-3 text-sm text-left' : 'px-3 py-2 text-sm text-left',
  ].join(' ');
  const menu = typeof document !== 'undefined' ? createPortal(
    <AnimatePresence>
      {isOpen && menuPosition && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
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
          <div className={menuClassName} role="listbox" style={{ maxHeight: menuPosition.maxHeight }}>
            {options.map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`${optionClassName} ${
                  opt.value === value
                    ? 'text-emerald-400'
                    : 'text-neutral-400 hover:bg-emerald-500/10 hover:text-emerald-300'
                }`}
                role="option"
                aria-selected={opt.value === value}
              >
                <Check
                  className={`w-3 h-3 shrink-0 ${
                    opt.value === value ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                {opt.label}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  ) : null;

  return (
    <div ref={ref} className={containerClassName}>
      <button
        type="button"
        onClick={() => {
          if (!isOpen) {
            updatePlacement();
          }
          setIsOpen(!isOpen);
        }}
        className={triggerClassName}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
      >
        <span className={fullWidth ? 'flex min-w-0 flex-1 items-center justify-between gap-3' : ''}>
          <span className={fullWidth ? 'min-w-0 truncate' : ''}>
            {selected?.label || options[0]?.label}
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
