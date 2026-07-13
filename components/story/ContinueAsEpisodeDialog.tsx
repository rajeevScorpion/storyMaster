'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import {
  AtSign,
  BookMarked,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Loader2,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { prepareEpisodeContinuation } from '@/app/actions/episodes';
import { useStoryStore } from '@/lib/store/story-store';
import { useMentionAutocomplete } from '@/lib/hooks/useMentionAutocomplete';
import MentionSuggestionList from '@/components/ui/MentionSuggestionList';
import SeriesBibleDialog from './SeriesBibleDialog';
import type { EpisodeContinuationSeed, SeriesBible } from '@/lib/types/episodes';

const MAX_PREMISE_CHARS = 600;

export interface ContinueAsEpisodeDialogProps {
  open: boolean;
  storyId: string;
  nodeId: string;
  onClose: () => void;
}

/**
 * Pack 2 Continue-as-Episode flow: prepares the continuation seed server-side
 * (branch + carried characters + bible + journal), lets the author write the
 * next episode's premise (with @name mentions over the carried cast), and
 * starts Episode N+1 with the inherited universe settings.
 */
export default function ContinueAsEpisodeDialog({
  open,
  storyId,
  nodeId,
  onClose,
}: ContinueAsEpisodeDialogProps) {
  const router = useRouter();
  const continueAsEpisode = useStoryStore((state) => state.continueAsEpisode);

  const [seed, setSeed] = useState<EpisodeContinuationSeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [premise, setPremise] = useState('');
  const [memoryExpanded, setMemoryExpanded] = useState(false);
  const [showBible, setShowBible] = useState(false);
  const [starting, setStarting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSeed(null);
    setPremise('');
    setMemoryExpanded(false);
    prepareEpisodeContinuation({ storyId, nodeId })
      .then((prepared) => {
        if (!cancelled) setSeed(prepared);
      })
      .catch((prepareError) => {
        if (!cancelled) {
          setError(
            prepareError instanceof Error
              ? prepareError.message
              : 'Could not prepare the next episode.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, storyId, nodeId]);

  const carriedNames = useMemo(
    () => (seed?.carriedCharacters ?? []).map((character) => character.name).filter(Boolean),
    [seed]
  );
  const avatarUrlByName = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const character of seed?.carriedCharacters ?? []) {
      map[character.name] = character.portraitUrl ?? character.referenceSheetUrl;
    }
    return map;
  }, [seed]);

  const mentions = useMentionAutocomplete({
    names: carriedNames,
    text: premise,
    setText: setPremise,
    textareaRef,
    maxLength: MAX_PREMISE_CHARS,
  });

  const handleStart = async () => {
    if (!seed || starting || !premise.trim()) return;
    setStarting(true);
    // Generation continues on the old story's URL — stop the page effect from
    // reloading the old story out from under the new episode session.
    sessionStorage.setItem('kissago_skip_story_reload', storyId);
    onClose();
    try {
      await continueAsEpisode(premise.trim(), seed);
      const newStoryId = useStoryStore.getState().session?.savedStoryId;
      if (newStoryId && newStoryId !== storyId) {
        router.replace(`/story/${newStoryId}`);
        window.setTimeout(() => sessionStorage.removeItem('kissago_skip_story_reload'), 2000);
      } else {
        sessionStorage.removeItem('kissago_skip_story_reload');
      }
    } catch {
      sessionStorage.removeItem('kissago_skip_story_reload');
    } finally {
      setStarting(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !starting) onClose();
          }}
        >
          <motion.section
            role="dialog"
            aria-label="Continue as episode"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/95 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center gap-3 border-b border-white/5 p-5">
              <Clapperboard className="h-5 w-5 shrink-0 text-emerald-300" />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-serif text-neutral-100">
                  {seed ? `Continue as Episode ${seed.nextEpisodeNumber}` : 'Continue as Episode'}
                </h2>
                <p className="mt-0.5 truncate text-xs text-neutral-500">
                  {seed
                    ? `Picks up after “${seed.parentStoryTitle}” with the same characters and universe.`
                    : 'Carrying your characters and world into the next episode.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={starting}
                className="rounded-full p-2 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-200 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {loading && (
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-neutral-900/60 p-4 text-sm text-neutral-400">
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
                  Gathering your characters and series memory…
                </div>
              )}
              {error && <p className="text-xs leading-snug text-rose-300">{error}</p>}

              {seed && (
                <>
                  {seed.carriedCharacters.length > 0 && (
                    <div>
                      <p className="text-xs font-sans uppercase tracking-wider text-neutral-500">
                        Coming along automatically
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {seed.carriedCharacters.map((character) => {
                          const avatar = character.portraitUrl ?? character.referenceSheetUrl;
                          return (
                            <span
                              key={character.id}
                              className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/5 py-1 pl-1 pr-3 text-xs text-emerald-100"
                            >
                              {avatar ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={avatar}
                                  alt=""
                                  className="h-6 w-6 rounded-full border border-white/10 object-cover"
                                />
                              ) : (
                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800">
                                  <UserRound className="h-3.5 w-3.5 text-neutral-500" />
                                </span>
                              )}
                              {character.name}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="relative">
                    <p className="text-xs font-sans uppercase tracking-wider text-neutral-500">
                      What happens in Episode {seed.nextEpisodeNumber}?
                    </p>
                    <div className="relative mt-2">
                      <textarea
                        ref={textareaRef}
                        value={premise}
                        rows={3}
                        disabled={starting}
                        placeholder="Set up the next adventure. Use @name to feature a carried character."
                        onChange={(event) => {
                          setPremise(event.target.value.slice(0, MAX_PREMISE_CHARS));
                          mentions.syncMentionState(event.target.value, event.target.selectionStart);
                        }}
                        onClick={(event) =>
                          mentions.syncMentionState(premise, event.currentTarget.selectionStart)
                        }
                        onKeyDown={(event) => {
                          mentions.handleKeyDown(event);
                        }}
                        className="w-full resize-none rounded-xl border border-white/10 bg-neutral-900/70 p-3 font-serif text-base text-neutral-100 placeholder:font-sans placeholder:text-sm placeholder:text-neutral-600 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60"
                        aria-label="Episode premise"
                      />
                      <MentionSuggestionList
                        open={Boolean(mentions.mention)}
                        suggestions={mentions.suggestions}
                        highlightIndex={mentions.highlightIndex}
                        onHighlight={mentions.setHighlightIndex}
                        onSelect={mentions.applySuggestion}
                        avatarUrlByName={avatarUrlByName}
                      />
                    </div>
                    <p className="mt-1 flex items-center justify-between text-[11px] text-neutral-600">
                      <span className="flex items-center gap-1">
                        <AtSign className="h-3 w-3" /> mention carried characters
                      </span>
                      {premise.length}/{MAX_PREMISE_CHARS}
                    </p>
                  </div>

                  {(seed.bible || seed.journalSummary) && (
                    <div className="rounded-2xl border border-white/10 bg-neutral-900/50">
                      <button
                        type="button"
                        onClick={() => setMemoryExpanded((value) => !value)}
                        className="flex w-full items-center justify-between gap-2 p-4 text-left"
                        aria-expanded={memoryExpanded}
                      >
                        <span className="flex items-center gap-2 text-sm text-neutral-200">
                          <BookMarked className="h-4 w-4 text-indigo-300" />
                          Series memory travels with you
                        </span>
                        {memoryExpanded ? (
                          <ChevronUp className="h-4 w-4 text-neutral-500" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-neutral-500" />
                        )}
                      </button>
                      {memoryExpanded && (
                        <div className="space-y-3 border-t border-white/5 p-4">
                          {seed.bible?.bibleText && (
                            <div>
                              <p className="text-[11px] font-sans uppercase tracking-wider text-neutral-500">
                                Story bible
                              </p>
                              <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-neutral-400">
                                {seed.bible.bibleText}
                              </p>
                              <button
                                type="button"
                                onClick={() => setShowBible(true)}
                                className="mt-2 text-xs font-medium text-indigo-300 transition-colors hover:text-indigo-200"
                              >
                                View / edit series bible
                              </button>
                            </div>
                          )}
                          {seed.journalSummary && (
                            <div>
                              <p className="text-[11px] font-sans uppercase tracking-wider text-neutral-500">
                                Previously in this series
                              </p>
                              <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-neutral-400">
                                {seed.journalSummary}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-[11px] leading-snug text-neutral-600">
                    Episode {seed.nextEpisodeNumber} inherits this story’s visual style, audience,
                    narration, and image settings.
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-white/5 p-5">
              <button
                type="button"
                onClick={onClose}
                disabled={starting}
                className="rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={!seed || starting || !premise.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-5 py-2 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {starting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {seed ? `Start Episode ${seed.nextEpisodeNumber}` : 'Start Episode'}
              </button>
            </div>
          </motion.section>

          <SeriesBibleDialog
            open={showBible}
            bible={seed?.bible ?? null}
            onClose={() => setShowBible(false)}
            onSaved={(saved: SeriesBible) =>
              setSeed((previous) => (previous ? { ...previous, bible: saved } : previous))
            }
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
