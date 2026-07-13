'use client';

import { AnimatePresence, motion } from 'motion/react';
import { AtSign } from 'lucide-react';

export interface MentionSuggestionListProps {
  open: boolean;
  suggestions: string[];
  highlightIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (name: string) => void;
  /** Optional avatar/thumbnail per name (falls back to the @ icon). */
  avatarUrlByName?: Record<string, string | undefined>;
  className?: string;
}

/**
 * Pack 2 shared @mention popup: tap a name (mousedown so the textarea keeps
 * focus), hover to highlight; keyboard cycling is driven by the hook.
 */
export default function MentionSuggestionList({
  open,
  suggestions,
  highlightIndex,
  onHighlight,
  onSelect,
  avatarUrlByName,
  className,
}: MentionSuggestionListProps) {
  return (
    <AnimatePresence>
      {open && suggestions.length > 0 && (
        <motion.ul
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.12 }}
          role="listbox"
          aria-label="Character suggestions"
          className={
            className ??
            'absolute bottom-full left-3 z-50 mb-1 w-56 overflow-hidden rounded-xl border border-white/10 bg-neutral-900/95 py-1 shadow-2xl backdrop-blur-md'
          }
        >
          {suggestions.map((name, index) => {
            const avatarUrl = avatarUrlByName?.[name];
            return (
              <li key={name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlightIndex}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(name);
                  }}
                  onMouseEnter={() => onHighlight(index)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    index === highlightIndex ? 'bg-emerald-400/15 text-emerald-100' : 'text-neutral-200'
                  }`}
                >
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt=""
                      className="h-5 w-5 shrink-0 rounded-full border border-white/10 object-cover"
                    />
                  ) : (
                    <AtSign className="h-3.5 w-3.5 shrink-0 text-emerald-400/70" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                </button>
              </li>
            );
          })}
        </motion.ul>
      )}
    </AnimatePresence>
  );
}
