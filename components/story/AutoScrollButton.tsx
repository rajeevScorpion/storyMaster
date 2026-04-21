'use client';

import { ChevronsDown } from 'lucide-react';

export default function AutoScrollButton({
  active,
  disabled = false,
  onClick,
  className = '',
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`p-2.5 backdrop-blur-md rounded-full border transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.18)]'
          : 'bg-neutral-900/60 border-white/10 text-neutral-400 hover:border-white/20 hover:bg-neutral-800 hover:text-neutral-200'
      } ${className}`}
      title={active ? 'Stop auto-scroll' : 'Auto-scroll story text'}
      aria-pressed={active}
      aria-label={active ? 'Stop auto-scroll' : 'Auto-scroll story text'}
    >
      <ChevronsDown className="h-5 w-5" />
    </button>
  );
}
