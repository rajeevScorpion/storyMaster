'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AtSign, Loader2, PenLine, Send, X } from 'lucide-react';
import { useStoryStore } from '@/lib/store/story-store';
import { collectNamedCharactersForNode } from '@/lib/utils/story-map';
import { extractMentionQueryAtCursor } from '@/lib/utils/character-mentions';

const MAX_CUSTOM_OPTION_CHARS = 200;

export interface CustomOptionInputProps {
  nodeId: string;
  disabled?: boolean;
}

/**
 * Pack 1 custom option composer. Users write their own next choice; typing
 * `@` suggests named characters from the current story path. The backend
 * re-validates mentions, so this UI is a convenience, not the gate.
 */
export default function CustomOptionInput({ nodeId, disabled }: CustomOptionInputProps) {
  const session = useStoryStore((state) => state.session);
  const addCustomOptionForNode = useStoryStore((state) => state.addCustomOptionForNode);

  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const characterNames = useMemo(() => {
    if (!session) return [];
    return collectNamedCharactersForNode(session.storyMap, nodeId).map((character) => character.name);
  }, [session, nodeId]);

  useEffect(() => {
    setExpanded(false);
    setText('');
    setError(null);
    setMention(null);
  }, [nodeId]);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    return characterNames
      .filter((name) => name.toLowerCase().startsWith(query))
      .slice(0, 5);
  }, [mention, characterNames]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [suggestions.length, mention?.query]);

  const syncMentionState = (value: string, cursor: number | null) => {
    setMention(cursor === null ? null : extractMentionQueryAtCursor(value, cursor));
  };

  const applySuggestion = (name: string) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(mention.start + 1 + mention.query.length);
    const next = `${before}@${name}${after}`;
    setText(next.slice(0, MAX_CUSTOM_OPTION_CHARS));
    setMention(null);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        const cursor = before.length + name.length + 1;
        textarea.focus();
        textarea.setSelectionRange(cursor, cursor);
      }
    });
  };

  const submit = async () => {
    if (submitting || !text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await addCustomOptionForNode(nodeId, text);
      if (result.status === 'added') {
        setText('');
        setExpanded(false);
        return;
      }
      if (result.status === 'invalid_mentions') {
        const available = result.availableCharacters.length
          ? ` Available characters: ${result.availableCharacters.join(', ')}.`
          : '';
        setError(
          `We could not find ${result.unknownMentions.join(', ')} in this story. Choose one of the existing character names or remove the mention.${available}`
        );
        return;
      }
      setError(result.error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        disabled={disabled}
        className="w-full rounded-2xl border border-dashed border-white/15 bg-neutral-900/40 p-4 text-left backdrop-blur-md transition-all duration-300 hover:border-emerald-400/30 hover:bg-neutral-900/70 disabled:cursor-not-allowed disabled:opacity-50 md:p-5"
      >
        <span className="flex items-center gap-2 text-sm font-sans text-neutral-400">
          <PenLine className="h-4 w-4 text-emerald-400/70" />
          Write your own next choice…
          <span className="ml-auto hidden items-center gap-1 text-xs text-neutral-600 sm:flex">
            <AtSign className="h-3 w-3" /> mention story characters
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="relative rounded-2xl border border-emerald-400/25 bg-neutral-900/70 p-4 backdrop-blur-md">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-sans uppercase tracking-wider text-emerald-200/80">Your own choice</p>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setError(null);
            setMention(null);
          }}
          disabled={submitting}
          className="rounded-full p-1 text-neutral-500 transition-colors hover:bg-white/10 hover:text-neutral-200 disabled:opacity-50"
          aria-label="Close custom option input"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative mt-2">
        <textarea
          ref={textareaRef}
          value={text}
          rows={2}
          disabled={submitting}
          placeholder="Write your own next choice. Use @name to reference story characters."
          onChange={(event) => {
            setText(event.target.value.slice(0, MAX_CUSTOM_OPTION_CHARS));
            syncMentionState(event.target.value, event.target.selectionStart);
          }}
          onClick={(event) => syncMentionState(text, event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (suggestions.length > 0 && mention) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlightIndex((index) => (index + 1) % suggestions.length);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlightIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                applySuggestion(suggestions[highlightIndex]);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setMention(null);
                return;
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          className="w-full resize-none rounded-xl border border-white/10 bg-neutral-950/70 p-3 font-serif text-base text-neutral-100 placeholder:font-sans placeholder:text-sm placeholder:text-neutral-600 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60"
          aria-label="Custom option text"
        />
        <AnimatePresence>
          {mention && suggestions.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.12 }}
              role="listbox"
              aria-label="Character suggestions"
              className="absolute bottom-full left-3 z-50 mb-1 w-56 overflow-hidden rounded-xl border border-white/10 bg-neutral-900/95 py-1 shadow-2xl backdrop-blur-md"
            >
              {suggestions.map((name, index) => (
                <li key={name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlightIndex}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applySuggestion(name);
                    }}
                    onMouseEnter={() => setHighlightIndex(index)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      index === highlightIndex ? 'bg-emerald-400/15 text-emerald-100' : 'text-neutral-200'
                    }`}
                  >
                    <AtSign className="h-3.5 w-3.5 shrink-0 text-emerald-400/70" />
                    {name}
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
      {error && <p className="mt-2 text-xs leading-snug text-rose-300">{error}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-neutral-600">
          {text.length}/{MAX_CUSTOM_OPTION_CHARS}
        </p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-4 py-1.5 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Add choice
        </button>
      </div>
    </div>
  );
}
