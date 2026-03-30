'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export interface FilterDropdownOption {
  value: string;
  label: string;
}

export default function FilterDropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: FilterDropdownOption[];
  onChange: (value: string) => void;
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 bg-neutral-800/80 border px-3 py-2 text-sm cursor-pointer transition-all duration-200 ${
          isOpen
            ? 'border-emerald-500/40 rounded-xl rounded-b-none text-emerald-300'
            : 'border-white/10 rounded-xl text-neutral-200 hover:border-white/20'
        }`}
      >
        {selected?.label || options[0]?.label}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${
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
            className="absolute top-full -mt-px left-0 z-50 w-max min-w-full overflow-hidden"
          >
            <div className="bg-neutral-900/95 backdrop-blur-xl border border-emerald-500/40 rounded-xl rounded-t-none shadow-2xl pt-1 pb-1">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                    opt.value === value
                      ? 'text-emerald-400'
                      : 'text-neutral-400 hover:bg-emerald-500/10 hover:text-emerald-300'
                  }`}
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
