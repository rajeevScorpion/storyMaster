'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  History,
  ImageIcon,
  ListRestart,
  Mic2,
  MoreVertical,
  PenLine,
  PlusCircle,
} from 'lucide-react';
import { useStoryStore } from '@/lib/store/story-store';

export interface BeatActionsMenuProps {
  nodeId: string;
  /** Story-changing edits on this beat require the timeline rewrite flow. */
  isLocked: boolean;
  allowImageRegeneration?: boolean;
  onEditText: () => void;
  onRegenerateImage: () => void;
  onRegenerateNarration: () => void;
  onRegenerateOptions: () => void;
  onViewVersions: () => void;
}

interface MenuItem {
  key: string;
  label: string;
  icon: typeof PenLine;
  onSelect: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Pack 1 per-beat actions menu. Rendered only for the story owner outside
 * exploration mode; every item is additionally flag-gated so the whole menu
 * disappears when the admin disables all beat controls.
 */
export default function BeatActionsMenu({
  nodeId,
  isLocked,
  allowImageRegeneration = true,
  onEditText,
  onRegenerateImage,
  onRegenerateNarration,
  onRegenerateOptions,
  onViewVersions,
}: BeatActionsMenuProps) {
  const settings = useStoryStore((state) => state.beatControlSettings);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('touchstart', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const items: MenuItem[] = [];
  if (settings.textEditEnabled) {
    items.push({ key: 'edit-text', label: 'Edit story text', icon: PenLine, onSelect: onEditText });
  }
  if (allowImageRegeneration && settings.imageRegenEnabled) {
    items.push({ key: 'regen-image', label: 'Regenerate image…', icon: ImageIcon, onSelect: onRegenerateImage });
  }
  if (settings.narrationRegenEnabled) {
    items.push({ key: 'regen-narration', label: 'Regenerate narration', icon: Mic2, onSelect: onRegenerateNarration });
  }
  if (settings.optionsRegenEnabled) {
    items.push({
      key: 'regen-options',
      label: 'Regenerate options',
      icon: ListRestart,
      onSelect: onRegenerateOptions,
      disabled: isLocked && !settings.timelineRewriteEnabled,
      disabledReason: 'Options for this beat already shaped the later story.',
    });
  }
  if (settings.imageVersionHistoryEnabled) {
    items.push({ key: 'versions', label: 'Image versions…', icon: History, onSelect: onViewVersions });
  }

  if (items.length === 0) return null;

  return (
    <div ref={containerRef} className="relative flex flex-col items-center">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Beat actions"
        title="Beat actions"
        className={`p-2.5 backdrop-blur-md rounded-full transition-all duration-300 border ${
          open
            ? 'bg-neutral-800 border-white/20 text-white'
            : 'bg-neutral-900/60 border-white/10 text-neutral-300 hover:border-white/20 hover:bg-neutral-800'
        }`}
      >
        <MoreVertical className="w-5 h-5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Beat actions"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-0 left-full z-50 ml-2 w-60 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/95 py-1.5 shadow-2xl backdrop-blur-md"
          >
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  title={item.disabled ? item.disabledReason : undefined}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-sans transition-colors ${
                    item.disabled
                      ? 'cursor-not-allowed text-neutral-600'
                      : 'text-neutral-200 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              );
            })}
            <BeatActionsCustomOptionHint />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BeatActionsCustomOptionHint() {
  const customOptionsEnabled = useStoryStore((state) => state.beatControlSettings.customOptionsEnabled);
  if (!customOptionsEnabled) return null;
  return (
    <p className="flex items-center gap-2 border-t border-white/5 px-4 pb-1.5 pt-2 text-[11px] leading-snug text-neutral-500">
      <PlusCircle className="h-3.5 w-3.5 shrink-0" />
      Write your own choice below the options list.
    </p>
  );
}
