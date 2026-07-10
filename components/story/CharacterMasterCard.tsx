'use client';

import { motion } from 'motion/react';
import { UserRound } from 'lucide-react';
import type { CharacterMaster } from '@/lib/types/character-library';

export interface CharacterMasterCardProps {
  master: CharacterMaster;
  onOpen: (master: CharacterMaster) => void;
}

/**
 * Pack 2 library card shown in the My Stories "Characters" tab. Click opens
 * the detail dialog for viewing/editing/archiving.
 */
export default function CharacterMasterCard({ master, onOpen }: CharacterMasterCardProps) {
  const thumbnail = master.portraitUrl ?? master.referenceSheetUrl;
  const isArchived = Boolean(master.archivedAt);

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      type="button"
      onClick={() => onOpen(master)}
      className={`group flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all ${
        isArchived
          ? 'bg-neutral-900/30 border-white/5 opacity-60'
          : 'bg-neutral-900/60 border-white/5 hover:border-white/15'
      }`}
    >
      <span className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-neutral-800">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt={master.name} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            <UserRound className="h-6 w-6 text-neutral-600" />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-serif text-neutral-200 transition-colors group-hover:text-white">
          {master.name}
        </span>
        {master.type && (
          <span className="mt-0.5 block truncate text-xs text-neutral-500">{master.type}</span>
        )}
        <span className="mt-2 flex items-center gap-2">
          {isArchived && (
            <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
              archived
            </span>
          )}
          {master.sourceType === 'generated_from_story' && (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-emerald-400">
              from a story
            </span>
          )}
        </span>
      </span>
    </motion.button>
  );
}
