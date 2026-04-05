'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export interface FilterDropdownOption {
  value: string;
  label: string;
}

type DropdownSize = 'compact' | 'form';
type DropdownMode = 'popover' | 'inline';

export default function FilterDropdown({
  value,
  options,
  onChange,
  fullWidth = false,
  size = 'compact',
  mode = 'popover',
}: {
  value: string;
  options: FilterDropdownOption[];
  onChange: (value: string) => void;
  fullWidth?: boolean;
  size?: DropdownSize;
  mode?: DropdownMode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find((o) => o.value === value);
  const isForm = size === 'form';
  const containerClassName = fullWidth ? 'relative w-full' : 'relative';
  const triggerClassName = [
    'flex items-center border bg-neutral-800/80 transition-all duration-200',
    fullWidth ? 'w-full justify-between' : 'gap-2',
    isForm ? 'min-h-12 rounded-2xl px-4 py-3 text-left text-sm' : 'rounded-xl px-3 py-2 text-sm',
    isOpen
      ? 'border-emerald-500/40 text-emerald-300'
      : 'border-white/10 text-neutral-200 hover:border-white/20',
    mode === 'popover' && isOpen ? 'rounded-b-none' : '',
    mode === 'inline' && isOpen ? 'rounded-b-none' : '',
  ].join(' ');
  const menuWrapperClassName = mode === 'inline'
    ? 'relative z-10 -mt-px w-full overflow-hidden'
    : `absolute top-full left-0 z-50 -mt-px overflow-hidden ${fullWidth ? 'w-full' : 'w-max min-w-full'}`;
  const menuClassName = [
    'bg-neutral-900/95 border border-emerald-500/40 backdrop-blur-xl shadow-2xl',
    isForm ? 'rounded-2xl rounded-t-none py-1.5' : 'rounded-xl rounded-t-none py-1',
  ].join(' ');
  const optionClassName = [
    'w-full flex items-center gap-2 transition-colors',
    isForm ? 'px-4 py-3 text-sm text-left' : 'px-3 py-2 text-sm text-left',
  ].join(' ');

  return (
    <div ref={ref} className={containerClassName}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={triggerClassName}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className={fullWidth ? 'min-w-0 flex-1 truncate' : ''}>
          {selected?.label || options[0]?.label}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-emerald-400' : 'text-neutral-500'
          }`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={menuWrapperClassName}
          >
            <div className={menuClassName} role="listbox">
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
      </AnimatePresence>
    </div>
  );
}
