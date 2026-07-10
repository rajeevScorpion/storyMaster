'use client';

// Pack 2: shared @name mention autocomplete state machine, extracted from the
// Pack 1 CustomOptionInput so the same UX works in the custom option composer,
// the episode premise textarea, and the landing prompt. Typing '@' pops up the
// suggestion list; keep typing to filter, ArrowUp/ArrowDown to cycle, Enter or
// Tab (or tap) to select.

import { useCallback, useMemo, useState, type KeyboardEvent, type RefObject } from 'react';
import { extractMentionQueryAtCursor } from '@/lib/utils/character-mentions';

type MentionField = HTMLTextAreaElement | HTMLInputElement;

export interface UseMentionAutocompleteOptions<T extends MentionField> {
  /** Candidate names shown in the popup (already scoped to the context). */
  names: string[];
  /** The controlled textarea/input value. */
  text: string;
  /** Setter for the controlled value (used when a suggestion is applied). */
  setText: (next: string) => void;
  textareaRef: RefObject<T | null>;
  maxLength?: number;
  maxSuggestions?: number;
  /** Called after a suggestion is applied (e.g. to also select the character). */
  onSelect?: (name: string) => void;
}

export interface MentionAutocomplete<T extends MentionField> {
  /** Active mention context under the cursor, or null. */
  mention: { query: string; start: number } | null;
  suggestions: string[];
  highlightIndex: number;
  setHighlightIndex: (index: number) => void;
  /** Sync the mention context from the current cursor position. */
  syncMentionState: (value: string, cursor: number | null) => void;
  /** Replace the typed @query with @Name and restore focus/cursor. */
  applySuggestion: (name: string) => void;
  closeMention: () => void;
  /**
   * Keyboard handling for the popup (cycle/select/dismiss). Returns true when
   * the event was consumed and the caller should stop further handling.
   */
  handleKeyDown: (event: KeyboardEvent<T>) => boolean;
}

export function useMentionAutocomplete<T extends MentionField = HTMLTextAreaElement>({
  names,
  text,
  setText,
  textareaRef,
  maxLength,
  maxSuggestions = 5,
  onSelect,
}: UseMentionAutocompleteOptions<T>): MentionAutocomplete<T> {
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    return names
      .filter((name) => name.toLowerCase().startsWith(query))
      .slice(0, maxSuggestions);
  }, [mention, names, maxSuggestions]);

  // Reset the highlight whenever the query or result set changes — done
  // during render (React's "adjust state when props change" pattern) instead
  // of an effect to avoid a cascading re-render.
  const highlightResetKey = `${mention?.query ?? ''}:${suggestions.length}`;
  const [lastHighlightResetKey, setLastHighlightResetKey] = useState(highlightResetKey);
  if (highlightResetKey !== lastHighlightResetKey) {
    setLastHighlightResetKey(highlightResetKey);
    setHighlightIndex(0);
  }

  const syncMentionState = (value: string, cursor: number | null) => {
    setMention(cursor === null ? null : extractMentionQueryAtCursor(value, cursor));
  };

  // Stable so callers can safely list it in effect dependencies.
  const closeMention = useCallback(() => setMention(null), []);

  const applySuggestion = (name: string) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.start + 1 + mention.query.length);
    const next = `${before}@${name}${after}`;
    setText(maxLength ? next.slice(0, maxLength) : next);
    setMention(null);
    onSelect?.(name);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        const cursor = before.length + name.length + 1;
        textarea.focus();
        textarea.setSelectionRange(cursor, cursor);
      }
    });
  };

  const handleKeyDown = (event: KeyboardEvent<T>): boolean => {
    if (suggestions.length === 0 || !mention) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((index) => (index + 1) % suggestions.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      applySuggestion(suggestions[highlightIndex]);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setMention(null);
      return true;
    }
    return false;
  };

  return {
    mention,
    suggestions,
    highlightIndex,
    setHighlightIndex,
    syncMentionState,
    applySuggestion,
    closeMention,
    handleKeyDown,
  };
}
