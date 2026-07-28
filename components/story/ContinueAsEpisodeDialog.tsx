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
  RefreshCcw,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { prepareEpisodeContinuation } from '@/app/actions/episodes';
import { getStoryModelOverrides } from '@/app/actions/admin';
import { generateSeedPlanPreview } from '@/app/actions/story-runtime';
import {
  authorizeCurrentUserBillableAction,
  finalizeCurrentUserBillableAction,
  releaseCurrentUserBillableAction,
} from '@/app/actions/pricing-enforcement';
import { useStoryStore } from '@/lib/store/story-store';
import { useMentionAutocomplete } from '@/lib/hooks/useMentionAutocomplete';
import MentionSuggestionList from '@/components/ui/MentionSuggestionList';
import FilterDropdown, { type FilterDropdownOption } from '@/components/ui/FilterDropdown';
import SeriesBibleDialog from './SeriesBibleDialog';
import type { EpisodeContinuationSeed, SeriesBible } from '@/lib/types/episodes';
import type { SeedPlan, SourceFidelity } from '@/lib/types/story';
import { SOURCE_FIDELITY_OPTIONS } from '@/lib/ai/story-config';
import { buildSeededEpisodeConfig } from '@/lib/episodes/continuity';
import {
  SEED_GUIDANCE_WORD_CAP,
  SEED_SOURCE_WORD_CAP,
  countAuthoringWords,
} from '@/lib/story/authoring-limits';

const MAX_PREMISE_CHARS = 600;
type EpisodeAuthoringMode = 'prompt' | 'seeded';

const EPISODE_AUTHORING_OPTIONS: FilterDropdownOption[] = [
  { value: 'prompt', label: 'Episode idea' },
  { value: 'seeded', label: 'Seed Story' },
];

const SOURCE_FIDELITY_DROPDOWN_OPTIONS: FilterDropdownOption[] = SOURCE_FIDELITY_OPTIONS.map(
  (option) => ({
    value: option.value,
    label: option.label,
  })
);

export interface ContinueAsEpisodeDialogProps {
  open: boolean;
  storyId: string;
  nodeId: string;
  onClose: () => void;
}

/**
 * Pack 2 Continue-as-Episode flow: prepares the continuation seed server-side
 * (branch + carried characters + bible + journal), lets the author provide
 * either a premise or a previewed seed story (with @name mentions over the
 * carried cast), and starts Episode N+1 with the inherited universe settings.
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
  const [sourceText, setSourceText] = useState('');
  const [guidanceText, setGuidanceText] = useState('');
  const [authoringMode, setAuthoringMode] = useState<EpisodeAuthoringMode>('prompt');
  const [sourceFidelity, setSourceFidelity] = useState<SourceFidelity>('strictly_follow');
  const [seedPreview, setSeedPreview] = useState<SeedPlan | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
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
    setSourceText('');
    setGuidanceText('');
    setAuthoringMode('prompt');
    setSourceFidelity('strictly_follow');
    setSeedPreview(null);
    setPreviewing(false);
    setPreviewError(null);
    setMemoryExpanded(false);
    prepareEpisodeContinuation({ storyId, nodeId })
      .then((prepared) => {
        if (!cancelled) {
          setSeed(prepared);
          setAuthoringMode(prepared.authoringDefaults.mode);
          setSourceFidelity(prepared.authoringDefaults.sourceFidelity);
        }
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

  const episodeText = authoringMode === 'seeded' ? sourceText : premise;
  const mentions = useMentionAutocomplete({
    names: carriedNames,
    text: episodeText,
    setText: authoringMode === 'seeded' ? setSourceText : setPremise,
    textareaRef,
    maxLength: authoringMode === 'prompt' ? MAX_PREMISE_CHARS : undefined,
  });

  const sourceWordCount = countAuthoringWords(sourceText);
  const guidanceWordCount = countAuthoringWords(guidanceText);
  const isOverSourceWordCap = sourceWordCount > SEED_SOURCE_WORD_CAP;
  const isOverGuidanceWordCap = guidanceWordCount > SEED_GUIDANCE_WORD_CAP;
  const inheritedBeatCount = seed?.inheritedConfig.maxBeats ?? 0;
  const isBusy = starting || previewing;

  const clearSeedPreview = () => {
    setSeedPreview(null);
    setPreviewError(null);
  };

  const buildPreviewPricingError = (
    authorization: Awaited<ReturnType<typeof authorizeCurrentUserBillableAction>>
  ) => {
    if (authorization.status === 'allowed' || authorization.status === 'bypassed') {
      return null;
    }
    if (authorization.reason === 'sign_in_required') {
      return 'Sign in to preview a seeded episode.';
    }

    const availableCoins = authorization.availableCoins.toLocaleString();
    if (authorization.reason === 'checkout_unavailable') {
      return `You need ${authorization.coinCost.toLocaleString()} coins to preview this episode, and checkout is unavailable. You currently have ${availableCoins} coins.`;
    }
    return `You need ${authorization.coinCost.toLocaleString()} coins to preview this episode. You currently have ${availableCoins} coins.`;
  };

  const handleGeneratePreview = async () => {
    if (
      !seed
      || previewing
      || starting
      || !sourceText.trim()
      || isOverSourceWordCap
      || isOverGuidanceWordCap
    ) {
      return;
    }
    if (sourceFidelity === 'strictly_follow' && sourceWordCount < inheritedBeatCount) {
      setPreviewError(
        `Strictly Follow needs at least ${inheritedBeatCount} words to create ${inheritedBeatCount} non-empty beats.`
      );
      return;
    }

    setPreviewing(true);
    setPreviewError(null);
    let reservationId: string | null = null;
    let shouldReleaseReservation = false;

    try {
      const authorization = await authorizeCurrentUserBillableAction({
        actionKey: 'preview_seed_plan',
        idempotencyKey: `preview_seed_episode:${seed.branchId}:${seed.nextEpisodeNumber}:${Date.now()}`,
        metadata: {
          authoringMode: 'seeded',
          beatCount: inheritedBeatCount,
          language: seed.inheritedConfig.language,
          sourceFidelity,
          episodeNumber: seed.nextEpisodeNumber,
        },
      });
      const pricingError = buildPreviewPricingError(authorization);
      if (pricingError) {
        setPreviewError(pricingError);
        return;
      }

      reservationId = authorization.status === 'allowed' && authorization.mode === 'hard'
        ? authorization.reservationId
        : null;
      shouldReleaseReservation = Boolean(reservationId);

      const previewConfig = buildSeededEpisodeConfig(seed.inheritedConfig, {
        sourceText: sourceText.trim(),
        guidanceText: guidanceText.trim(),
        sourceFidelity,
      });
      const modelOverrides = await getStoryModelOverrides().catch(() => undefined);
      const previewSessionId = crypto.randomUUID();
      const nextPreview = await generateSeedPlanPreview({
        storyConfig: previewConfig,
        sourceText: sourceText.trim(),
        beatCount: inheritedBeatCount,
        workingTitle: `Episode ${seed.nextEpisodeNumber}`,
        guidanceText: guidanceText.trim(),
        sourceFidelity,
        modelOverrides,
        costTelemetry: {
          activityKey: 'preview_seed_plan',
          storySessionId: previewSessionId,
          metadata: {
            beatCount: inheritedBeatCount,
            language: seed.inheritedConfig.language,
            sourceFidelity,
            episodeNumber: seed.nextEpisodeNumber,
          },
        },
      });

      setSeedPreview(nextPreview);
      if (reservationId) {
        await finalizeCurrentUserBillableAction({
          reservationId,
          metadata: {
            action: 'preview_seed_episode',
            beatCount: inheritedBeatCount,
            episodeNumber: seed.nextEpisodeNumber,
          },
        });
        shouldReleaseReservation = false;
      }
    } catch (previewFailure: unknown) {
      if (reservationId && shouldReleaseReservation) {
        try {
          await releaseCurrentUserBillableAction({
            reservationId,
            reason: 'preview_seed_episode_failed',
            releaseStatus: 'failed',
            metadata: {
              message: previewFailure instanceof Error
                ? previewFailure.message
                : 'Failed to preview seeded episode',
            },
          });
        } catch {
          // Ignore secondary release failures.
        }
      }
      setPreviewError(
        previewFailure instanceof Error
          ? previewFailure.message
          : 'Failed to generate the episode beat preview.'
      );
    } finally {
      setPreviewing(false);
    }
  };

  const handleStart = async () => {
    if (!seed || isBusy || !episodeText.trim()) return;
    if (authoringMode === 'seeded' && !seedPreview) return;
    setStarting(true);
    // Generation continues on the old story's URL — stop the page effect from
    // reloading the old story out from under the new episode session.
    sessionStorage.setItem('kissago_skip_story_reload', storyId);
    onClose();
    try {
      const continuationSeed = authoringMode === 'seeded' && seedPreview
        ? {
            ...seed,
            inheritedConfig: buildSeededEpisodeConfig(seed.inheritedConfig, {
              sourceText: sourceText.trim(),
              guidanceText: guidanceText.trim(),
              sourceFidelity,
              seedPlan: seedPreview,
            }),
          }
        : seed;
      await continueAsEpisode(episodeText.trim(), continuationSeed);
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
            if (event.target === event.currentTarget && !isBusy) onClose();
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
                disabled={isBusy}
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

                  <div className={`grid gap-3 ${authoringMode === 'seeded' ? 'sm:grid-cols-2' : ''}`}>
                    <div className="space-y-1.5">
                      <p className="text-xs font-sans uppercase tracking-wider text-neutral-500">
                        Episode authoring
                      </p>
                      <FilterDropdown
                        value={authoringMode}
                        options={EPISODE_AUTHORING_OPTIONS}
                        onChange={(value) => {
                          setAuthoringMode(value as EpisodeAuthoringMode);
                          mentions.closeMention();
                          clearSeedPreview();
                        }}
                        fullWidth
                        size="form"
                        mode="inline"
                        ariaLabel="Choose episode authoring mode"
                      />
                    </div>
                    {authoringMode === 'seeded' && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-sans uppercase tracking-wider text-neutral-500">
                          Source fidelity
                        </p>
                        <FilterDropdown
                          value={sourceFidelity}
                          options={SOURCE_FIDELITY_DROPDOWN_OPTIONS}
                          onChange={(value) => {
                            setSourceFidelity(value as SourceFidelity);
                            clearSeedPreview();
                          }}
                          fullWidth
                          size="form"
                          mode="inline"
                          ariaLabel="Choose episode source fidelity"
                        />
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <p className="text-xs font-sans uppercase tracking-wider text-neutral-500">
                      {authoringMode === 'seeded'
                        ? `Paste the story for Episode ${seed.nextEpisodeNumber}`
                        : `What happens in Episode ${seed.nextEpisodeNumber}?`}
                    </p>
                    <div className="relative mt-2">
                      <textarea
                        ref={textareaRef}
                        value={episodeText}
                        rows={authoringMode === 'seeded' ? 7 : 3}
                        disabled={isBusy}
                        placeholder={
                          authoringMode === 'seeded'
                            ? 'Paste the original episode story. Kissago will divide it into the inherited number of beats.'
                            : 'Set up the next adventure. Use @name to feature a carried character.'
                        }
                        onChange={(event) => {
                          const nextValue = authoringMode === 'prompt'
                            ? event.target.value.slice(0, MAX_PREMISE_CHARS)
                            : event.target.value;
                          if (authoringMode === 'seeded') {
                            setSourceText(nextValue);
                            clearSeedPreview();
                          } else {
                            setPremise(nextValue);
                          }
                          mentions.syncMentionState(nextValue, event.target.selectionStart);
                        }}
                        onClick={(event) =>
                          mentions.syncMentionState(episodeText, event.currentTarget.selectionStart)
                        }
                        onKeyDown={(event) => {
                          mentions.handleKeyDown(event);
                        }}
                        className="w-full resize-none rounded-xl border border-white/10 bg-neutral-900/70 p-3 font-serif text-base text-neutral-100 placeholder:font-sans placeholder:text-sm placeholder:text-neutral-600 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60"
                        aria-label={authoringMode === 'seeded' ? 'Episode source story' : 'Episode premise'}
                        aria-invalid={authoringMode === 'seeded' && isOverSourceWordCap}
                      />
                      <MentionSuggestionList
                        open={Boolean(mentions.mention)}
                        suggestions={mentions.suggestions}
                        highlightIndex={mentions.highlightIndex}
                        onHighlight={mentions.setHighlightIndex}
                        onSelect={(name) => {
                          mentions.applySuggestion(name);
                          if (authoringMode === 'seeded') clearSeedPreview();
                        }}
                        avatarUrlByName={avatarUrlByName}
                      />
                    </div>
                    <p className="mt-1 flex items-center justify-between gap-3 text-[11px] text-neutral-600">
                      <span className="flex items-center gap-1">
                        <AtSign className="h-3 w-3" /> mention carried characters
                      </span>
                      {authoringMode === 'seeded' ? (
                        <span className={isOverSourceWordCap ? 'text-rose-300' : ''}>
                          Story {sourceWordCount}/{SEED_SOURCE_WORD_CAP} words
                        </span>
                      ) : (
                        <span>{premise.length}/{MAX_PREMISE_CHARS}</span>
                      )}
                    </p>
                  </div>

                  {authoringMode === 'seeded' && (
                    <>
                      <div>
                        <p className="text-xs font-sans uppercase tracking-wider text-neutral-500">
                          Extra visual guidance
                        </p>
                        <textarea
                          value={guidanceText}
                          rows={3}
                          disabled={isBusy}
                          placeholder="Optional character appearance, scene, location, or world details. This cannot change the story."
                          onChange={(event) => {
                            setGuidanceText(event.target.value);
                            clearSeedPreview();
                          }}
                          className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-neutral-900/70 p-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 disabled:opacity-60"
                          aria-label="Episode extra visual guidance"
                          aria-invalid={isOverGuidanceWordCap}
                        />
                        <p className={`mt-1 text-right text-[11px] ${isOverGuidanceWordCap ? 'text-rose-300' : 'text-neutral-600'}`}>
                          Guidance {guidanceWordCount}/{SEED_GUIDANCE_WORD_CAP} words
                        </p>
                      </div>

                      <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.04] p-4">
                        <p className="text-xs uppercase tracking-wider text-emerald-300">
                          Seeded episode
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                          Episode {seed.nextEpisodeNumber} will use the inherited {inheritedBeatCount}-beat length.
                          {sourceFidelity === 'strictly_follow'
                            ? ' Your wording will remain unchanged and only be divided into beats.'
                            : ' Preview the adapted beat path before starting.'}
                        </p>
                      </div>

                      {previewError && (
                        <p className="text-xs leading-snug text-rose-300">{previewError}</p>
                      )}

                      {seedPreview && (
                        <div className="space-y-3 rounded-2xl border border-white/10 bg-neutral-900/40 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-wider text-emerald-300">
                                Episode beat preview
                              </p>
                              <p className="mt-1 text-[11px] text-neutral-500">
                                Confirm or edit your canonical episode path.
                              </p>
                            </div>
                            <span className="text-xs text-neutral-500">{seedPreview.beatCount} beats</span>
                          </div>

                          {seedPreview.beats.map((beat, index) => (
                            <div
                              key={`episode-seed-beat-${beat.beatIndex}`}
                              className="rounded-xl border border-white/10 bg-neutral-950/60 p-3"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                                  Beat {index + 1}
                                </p>
                                {beat.isEnding && (
                                  <span className="text-[10px] uppercase tracking-wider text-emerald-300">
                                    Ending
                                  </span>
                                )}
                              </div>
                              <input
                                value={beat.title}
                                disabled={isBusy}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setSeedPreview((current) => current ? {
                                    ...current,
                                    beats: current.beats.map((candidate, candidateIndex) => (
                                      candidateIndex === index ? { ...candidate, title: value } : candidate
                                    )),
                                  } : current);
                                }}
                                className="mt-2 min-h-10 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-emerald-400/40 disabled:opacity-60"
                                aria-label={`Episode beat ${index + 1} title`}
                              />
                              <textarea
                                value={beat.storyText}
                                rows={4}
                                disabled={isBusy}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setSeedPreview((current) => current ? {
                                    ...current,
                                    beats: current.beats.map((candidate, candidateIndex) => (
                                      candidateIndex === index ? { ...candidate, storyText: value } : candidate
                                    )),
                                  } : current);
                                }}
                                className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 font-serif text-sm text-neutral-200 outline-none focus:border-emerald-400/40 disabled:opacity-60"
                                aria-label={`Episode beat ${index + 1} story text`}
                              />
                              <textarea
                                value={beat.sceneSummary}
                                rows={2}
                                disabled={isBusy}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setSeedPreview((current) => current ? {
                                    ...current,
                                    beats: current.beats.map((candidate, candidateIndex) => (
                                      candidateIndex === index ? { ...candidate, sceneSummary: value } : candidate
                                    )),
                                  } : current);
                                }}
                                className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 outline-none focus:border-emerald-400/40 disabled:opacity-60"
                                aria-label={`Episode beat ${index + 1} scene summary`}
                              />
                              {!beat.isEnding && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {beat.options.map((option) => (
                                    <span
                                      key={option.id}
                                      className={`rounded-full border px-2 py-1 text-[10px] ${
                                        option.isCanonical
                                          ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'
                                          : 'border-white/10 text-neutral-500'
                                      }`}
                                    >
                                      {option.label}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

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

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/5 p-5">
              <button
                type="button"
                onClick={onClose}
                disabled={isBusy}
                className="rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
              >
                Not now
              </button>
              {authoringMode === 'seeded' && seedPreview && (
                <button
                  type="button"
                  onClick={() => void handleGeneratePreview()}
                  disabled={isBusy || isOverSourceWordCap || isOverGuidanceWordCap}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-neutral-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Regenerate
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (authoringMode === 'seeded' && !seedPreview) {
                    void handleGeneratePreview();
                    return;
                  }
                  void handleStart();
                }}
                disabled={
                  !seed
                  || isBusy
                  || !episodeText.trim()
                  || (authoringMode === 'seeded' && (isOverSourceWordCap || isOverGuidanceWordCap))
                }
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400 px-5 py-2 text-xs font-semibold text-neutral-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {previewing
                  ? 'Previewing beats'
                  : authoringMode === 'seeded' && !seedPreview
                    ? 'Preview Beats'
                    : seed
                      ? `Start Episode ${seed.nextEpisodeNumber}`
                      : 'Start Episode'}
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
