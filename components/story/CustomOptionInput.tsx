'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Loader2, PenLine, Send, X } from 'lucide-react';
import { useStoryStore } from '@/lib/store/story-store';
import { collectNamedCharactersForNode } from '@/lib/utils/story-map';
import { useMentionAutocomplete } from '@/lib/hooks/useMentionAutocomplete';
import MentionSuggestionList from '@/components/ui/MentionSuggestionList';
import {
  MAX_CUSTOM_OPTIONS_PER_BEAT,
  countCustomOptions,
} from '@/lib/beat-control/custom-options';

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const customOptionCount = countCustomOptions(session?.storyMap.nodes[nodeId]?.data.options);
  const customOptionLimitReached = customOptionCount >= MAX_CUSTOM_OPTIONS_PER_BEAT;

  const characterNames = useMemo(() => {
    if (!session) return [];
    return collectNamedCharactersForNode(session.storyMap, nodeId).map((character) => character.name);
  }, [session, nodeId]);

  const mentions = useMentionAutocomplete({
    names: characterNames,
    text,
    setText,
    textareaRef,
    maxLength: MAX_CUSTOM_OPTION_CHARS,
  });
  const { closeMention } = mentions;

  useEffect(() => {
    setExpanded(false);
    setText('');
    setError(null);
    closeMention();
  }, [nodeId, closeMention]);

  useEffect(() => {
    if (!expanded) return;
    const frameId = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [expanded]);

  useEffect(() => {
    if (customOptionLimitReached && expanded && !submitting) {
      setExpanded(false);
    }
  }, [customOptionLimitReached, expanded, submitting]);

  const submit = async () => {
    if (submitting || customOptionLimitReached || !text.trim()) return;
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
        disabled={disabled || customOptionLimitReached}
        className="relative w-full rounded-2xl border border-dashed border-white/15 bg-neutral-900/40 p-4 text-left backdrop-blur-md transition-all duration-300 hover:border-emerald-400/30 hover:bg-neutral-900/70 disabled:cursor-not-allowed disabled:opacity-70 md:p-5"
        aria-label={
          customOptionLimitReached
            ? `Custom choice limit reached, ${customOptionCount} of ${MAX_CUSTOM_OPTIONS_PER_BEAT}`
            : `Write a custom choice, ${customOptionCount} of ${MAX_CUSTOM_OPTIONS_PER_BEAT} used`
        }
      >
        <span className="flex flex-wrap items-center gap-2 text-sm font-sans text-neutral-400">
          <PenLine className="h-4 w-4 text-emerald-400/70" />
          {customOptionLimitReached ? 'Custom choice limit reached' : 'Write your own next choice…'}
          <span className="ml-auto inline-flex min-w-9 items-center justify-center rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-200">
            {customOptionCount}/{MAX_CUSTOM_OPTIONS_PER_BEAT}
          </span>
          <span className="hidden w-full items-center gap-1 pl-6 text-xs text-neutral-600 sm:flex">
            <AtSign className="h-3 w-3" /> mention story characters
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      ref={composerRef}
      className="relative z-0 rounded-2xl border border-emerald-400/25 bg-neutral-900/70 p-4 backdrop-blur-md transition-[background-color,border-color,box-shadow] duration-200 focus-within:z-20 focus-within:border-emerald-300/70 focus-within:bg-neutral-900/95 focus-within:shadow-[0_20px_58px_rgba(0,0,0,0.7)] focus-within:backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-sans uppercase tracking-wider text-emerald-200/90">Your own choice</p>
          <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-200">
            {customOptionCount}/{MAX_CUSTOM_OPTIONS_PER_BEAT}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setError(null);
            mentions.closeMention();
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
            mentions.syncMentionState(event.target.value, event.target.selectionStart);
          }}
          onClick={(event) => mentions.syncMentionState(text, event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            // When the @mention popup is open, ArrowUp/Down cycle and Enter/Tab
            // accept the highlighted name. Otherwise keys fall through to normal
            // textarea behavior — "Add choice" submits on click/tap only, never
            // on Enter, so typing never surprises the user or advances the story.
            mentions.handleKeyDown(event);
          }}
          className="w-full resize-none rounded-xl border border-white/10 bg-neutral-950/70 p-3 font-serif text-base text-neutral-100 placeholder:font-sans placeholder:text-sm placeholder:text-neutral-600 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60"
          aria-label="Custom option text"
        />
        <MentionSuggestionList
          open={Boolean(mentions.mention)}
          suggestions={mentions.suggestions}
          highlightIndex={mentions.highlightIndex}
          onHighlight={mentions.setHighlightIndex}
          onSelect={mentions.applySuggestion}
        />
      </div>
      {error && <p className="mt-2 text-xs leading-snug text-rose-300">{error}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-neutral-600">
          {text.length}/{MAX_CUSTOM_OPTION_CHARS}
        </p>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || customOptionLimitReached || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-4 py-1.5 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Add choice
        </button>
      </div>
    </div>
  );
}
