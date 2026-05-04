'use client';

import { motion } from 'motion/react';

interface ChoiceTransitionProps {
  optionLabel: string;
  className?: string;
}

export default function ChoiceTransition({ optionLabel, className = '' }: ChoiceTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`pointer-events-none flex items-center justify-center px-3 ${className}`}
    >
      <div className="max-w-full rounded-full border border-emerald-400/25 bg-neutral-950/70 px-4 py-2.5 shadow-2xl shadow-emerald-950/25 backdrop-blur-xl md:px-5">
        <p className="truncate text-sm font-sans text-emerald-200/90">
          <span className="mr-2 text-xs uppercase tracking-wider text-emerald-400/70">You chose</span>
          {optionLabel}
        </p>
      </div>
    </motion.div>
  );
}
