'use client';

import { motion } from 'motion/react';

interface ChoiceTransitionProps {
  optionLabel: string;
}

export default function ChoiceTransition({ optionLabel }: ChoiceTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.4 }}
      className="flex items-center justify-center py-6"
    >
      <div className="px-5 py-2.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-md">
        <p className="text-sm font-sans text-emerald-300/80">
          <span className="text-emerald-500/60 uppercase tracking-wider text-xs mr-2">You chose</span>
          {optionLabel}
        </p>
      </div>
    </motion.div>
  );
}
