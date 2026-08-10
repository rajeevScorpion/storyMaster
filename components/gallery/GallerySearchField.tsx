'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

const COMMIT_DELAY_MS = 250;

interface GallerySearchFieldProps {
  /** The committed query — i.e. what the URL says. */
  value: string;
  onChange: (next: string) => void;
  /**
   * Fired on a deliberate click or tap while search is closed. Not on focus:
   * tabbing past the field must not swap the page out from under a keyboard
   * user, and typing opens search on its own through the committed query.
   */
  onActivate?: () => void;
  onEscape?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * The one search input. It appears inline in the top bar on desktop and inside
 * the expanded search header on mobile, never both at once, so there is only
 * ever one thing holding the caret.
 *
 * Typing is debounced before it reaches the URL: every keystroke would otherwise
 * be a history entry and a query.
 */
export default function GallerySearchField({
  value,
  onChange,
  onActivate,
  onEscape,
  autoFocus = false,
  placeholder = 'Search stories, authors, genres',
  className = '',
}: GallerySearchFieldProps) {
  const [input, setInput] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // What the URL last confirmed, so an external change (Back, Clear all, a
  // rail's See all) can be told apart from the echo of our own commit.
  const [committed, setCommitted] = useState(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Adjusted during render rather than from an effect: the field must not spend
  // a frame showing a query the URL has already moved off.
  if (value !== committed) {
    setCommitted(value);
    setInput(value);
  }

  useEffect(() => {
    const trimmed = input.trim();
    // Trailing whitespace is not a new query, so typing a space mid-phrase does
    // not fire a request or rewrite what is in the field.
    if (trimmed === committed) return;

    const timer = setTimeout(() => {
      setCommitted(trimmed);
      onChangeRef.current(trimmed);
    }, COMMIT_DELAY_MS);

    return () => clearTimeout(timer);
  }, [input, committed]);

  useEffect(() => {
    if (!autoFocus) return;
    // Focus after paint so the mobile keyboard opens with the field in place.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  const clear = () => {
    setInput('');
    setCommitted('');
    onChangeRef.current('');
    inputRef.current?.focus();
  };

  return (
    <div className={`relative ${className}`}>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onPointerDown={onActivate}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            if (input) clear();
            else onEscape?.();
          }
        }}
        placeholder={placeholder}
        aria-label="Search stories"
        className="min-h-11 w-full rounded-full border border-white/10 bg-white/[0.07] py-2 pl-10 pr-11 text-sm text-neutral-100 placeholder-neutral-500 outline-none backdrop-blur-md transition-colors focus:border-emerald-500/50 focus:bg-neutral-900/80 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {input && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-0.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500 transition-colors hover:text-neutral-200"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
