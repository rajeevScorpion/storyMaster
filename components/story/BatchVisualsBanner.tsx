'use client';

import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ImageIcon, Loader2, Lock, RefreshCw, Volume2, Check } from 'lucide-react';
import { useStoryStore } from '@/lib/store/story-store';
import { getPathToNode } from '@/lib/utils/story-map';
import type { StoryBeat } from '@/lib/types/story';

function beatHasReadyImage(beat: StoryBeat): boolean {
  return beat.imageStatus === 'ready' && Boolean(beat.imageUrl);
}

function beatHasPrompt(beat: StoryBeat): boolean {
  return Boolean((beat.finalImagePromptText || beat.storyboardPromptText || beat.imagePrompt || '').trim());
}

/**
 * Story-level banner for deferred (background) generation on batch stories. It
 * carries two branch-aware, terminal-gated actions:
 *
 * - **Create all visuals** — submits the current root→ending path to a background
 *   image batch (~50% cheaper, ready within a day). Async: the user can leave.
 * - **Generate all narration** — narrates the current path inline (client loop,
 *   one beat at a time). No provider discount; the saving is that narration is
 *   skipped during the auto-walk and only runs for the committed path. The user
 *   must keep the page open until it finishes.
 *
 * Both actions only activate on a terminal (ending) beat; elsewhere they show
 * disabled with guidance. Beats that already have the asset are skipped.
 */
export default function BatchVisualsBanner() {
  const session = useStoryStore((state) => state.session);
  const submitImageBatch = useStoryStore((state) => state.submitImageBatch);
  const submitStatefulVisuals = useStoryStore((state) => state.submitStatefulVisuals);
  const reconcileCurrentStoryBatch = useStoryStore((state) => state.reconcileCurrentStoryBatch);
  const refreshBatchImages = useStoryStore((state) => state.refreshBatchImages);
  const isSubmitting = useStoryStore((state) => state.isSubmittingImageBatch);
  const message = useStoryStore((state) => state.imageBatchMessage);
  const generateNarrationBatch = useStoryStore((state) => state.generateNarrationBatch);
  const isGeneratingNarrationBatch = useStoryStore((state) => state.isGeneratingNarrationBatch);
  const narrationBatchMessage = useStoryStore((state) => state.narrationBatchMessage);

  const stats = useMemo(() => {
    if (!session) {
      return {
        total: 0, ready: 0, pending: 0, pathNeeding: 0,
        narrationTotal: 0, narrationReady: 0, narrationPending: 0, narrationPathNeeding: 0,
        isTerminal: false,
      };
    }
    let total = 0;
    let ready = 0;
    let pending = 0;
    for (const node of Object.values(session.storyMap.nodes)) {
      const beat = node.data;
      if (!beatHasPrompt(beat)) continue;
      total += 1;
      if (beatHasReadyImage(beat)) ready += 1;
      else if (beat.imageStatus === 'pending') pending += 1;
    }

    // Beats needing images / narration on the current root→current-node path.
    const path = getPathToNode(session.storyMap, session.storyMap.currentNodeId);
    let pathNeeding = 0;
    // Narration is tracked per narratable beat (one with story text) so the
    // "X of N" counter and CTA line up with what the server job actually does.
    let narrationTotal = 0;
    let narrationReady = 0;
    let narrationPending = 0;
    let narrationPathNeeding = 0;
    for (const node of path) {
      const beat = node.data;
      if (beatHasPrompt(beat) && !beatHasReadyImage(beat) && beat.imageStatus !== 'pending') {
        pathNeeding += 1;
      }
      const narratable = Boolean(beat.storyText && beat.storyText.trim());
      if (!narratable) continue;
      narrationTotal += 1;
      if (beat.audioUrl) narrationReady += 1;
      else if (beat.audioStatus === 'pending') narrationPending += 1;
      else narrationPathNeeding += 1;
    }

    const currentNode = session.storyMap.nodes[session.storyMap.currentNodeId];
    const isTerminal = Boolean(
      currentNode && (currentNode.data.isEnding === true || (currentNode.data.options?.length ?? 0) === 0)
    );

    return {
      total, ready, pending, pathNeeding,
      narrationTotal, narrationReady, narrationPending, narrationPathNeeding,
      isTerminal,
    };
  }, [session]);

  const isReel = session?.storyConfig.storyKind === 'reel';
  const savedStoryId = session?.savedStoryId ?? null;
  const deliveryMode = session?.storyConfig.imageDeliveryMode;
  const isStatefulDelivery = deliveryMode === 'stateful';
  const defersImages = Boolean(
    session &&
    (deliveryMode === 'batch' ||
      deliveryMode === 'stateful' ||
      session.storyConfig.imageGenerationMode === 'prompt_only')
  );
  // Narration defers on any deferred-delivery "generate" story (not prompt-only).
  const isBatchMode = Boolean(
    session &&
    !isReel &&
    Boolean(savedStoryId) &&
    session.storyConfig.imageGenerationMode === 'generate' &&
    (deliveryMode === 'batch' || deliveryMode === 'stateful')
  );

  // --- Visuals section ---
  const canShowVisuals = Boolean(session) && !isReel && Boolean(savedStoryId) && defersImages;
  const showInFlight = canShowVisuals && stats.pending > 0;

  // Server workers stream beats in for both fast (stateful) images and background
  // narration. Poll the cloud so assets appear without a manual refresh. Use
  // refreshBatchImages (a field-level merge that never flips isLoading or resets
  // the current beat) — never loadStoryFromCloud (full reload → preloader flash +
  // navigation reset) and never reconcile (which would kick another worker pass).
  const shouldPoll =
    Boolean(savedStoryId) &&
    ((isStatefulDelivery && stats.pending > 0) || stats.narrationPending > 0);
  useEffect(() => {
    if (!shouldPoll || !savedStoryId) return;
    const id = window.setInterval(() => {
      void refreshBatchImages(savedStoryId);
    }, 6000);
    return () => window.clearInterval(id);
  }, [shouldPoll, savedStoryId, refreshBatchImages]);

  const showCreate = canShowVisuals && stats.pending === 0 && stats.pathNeeding > 0;
  const showVisuals = showCreate || showInFlight;
  const createEnabled = stats.isTerminal && !isSubmitting;

  // --- Narration section ---
  // Narration is a SERVER background job (like fast visuals): once submitted the
  // user can leave. In-flight = beats still pending audio, or a submit in flight.
  const narrationInProgress = stats.narrationPending > 0 || isGeneratingNarrationBatch;
  const showNarration = isBatchMode &&
    (narrationInProgress || stats.narrationPathNeeding > 0 || Boolean(narrationBatchMessage));
  const narrationEnabled = stats.isTerminal && !isGeneratingNarrationBatch;

  if (!showVisuals && !showNarration) return null;

  return (
    <div className="mb-3 w-full">
      <div className="flex w-full flex-col gap-2 rounded-2xl border border-white/10 bg-neutral-900/90 px-4 py-3 shadow-xl backdrop-blur-md">
        {/* ---- Visuals ---- */}
        {showVisuals && (
          <AnimatePresence mode="wait">
            <motion.div
              key={showInFlight ? 'in-flight' : 'create'}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="flex w-full items-center gap-3"
            >
              {showInFlight ? (
                <>
                  <span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                    <ImageIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 text-left">
                    <p className="text-sm text-neutral-100">
                      {isStatefulDelivery ? 'Visuals are generating now' : 'Visuals are generating in the background'}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      {isStatefulDelivery
                        ? `Beat ${Math.min(stats.ready + 1, stats.total)} of ${stats.total} · runs on our servers — you can close this tab and come back.`
                        : `${stats.ready} of ${stats.total} ready · check back within a day.`}
                    </p>
                  </div>
                  {!isStatefulDelivery && (
                    <button
                      type="button"
                      onClick={() => void reconcileCurrentStoryBatch()}
                      className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-neutral-800/80 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Check now
                    </button>
                  )}
                  {isStatefulDelivery && (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-neutral-800/80 px-3 py-2 text-xs text-neutral-300">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Generating…
                    </span>
                  )}
                </>
              ) : (
                <>
                  <div className="min-w-0 text-left">
                    <p className="text-sm text-neutral-100">Create all visuals for this story</p>
                    <p className="mt-0.5 text-xs text-neutral-400">
                      {message
                        ? message
                        : createEnabled
                        ? isStatefulDelivery
                          ? `Generate images for ${stats.pathNeeding} beat${stats.pathNeeding === 1 ? '' : 's'} — consistent characters. Runs on our servers (~8 min/beat), so you can leave and come back.`
                          : `Generate images for ${stats.pathNeeding} beat${stats.pathNeeding === 1 ? '' : 's'} on this path in the background — ready within a day, ~50% cheaper. You can leave and come back.`
                        : 'Reach the end of the story to create all visuals in one go.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void (isStatefulDelivery ? submitStatefulVisuals('current_path') : submitImageBatch('current_path'))}
                    disabled={!createEnabled}
                    title={createEnabled ? undefined : 'Finish the story — the button activates on the ending beat.'}
                    className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                      createEnabled
                        ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
                        : 'cursor-not-allowed border-white/10 bg-neutral-800/60 text-neutral-500'
                    }`}
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : createEnabled ? (
                      <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {isSubmitting ? 'Submitting…' : 'Create all visuals'}
                  </button>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {/* ---- Divider ---- */}
        {showVisuals && showNarration && <div className="h-px w-full bg-white/10" />}

        {/* ---- Narration ---- */}
        {showNarration && (
          <div className="flex w-full items-center gap-3">
            {narrationInProgress ? (
              <>
                <span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                </span>
                <div className="min-w-0 text-left">
                  <p className="text-sm text-neutral-100">Generating narration on our servers</p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {stats.narrationTotal > 0
                      ? `Beat ${Math.min(stats.narrationReady + 1, stats.narrationTotal)} of ${stats.narrationTotal} · you can close this tab and come back.`
                      : 'Submitting… you can close this tab and come back.'}
                  </p>
                </div>
                {/* Escape hatch for a stalled job: if a beat is stuck pending (the
                    worker died mid-run, or a beat was never picked up), re-submit
                    the server job — it only re-runs beats still missing audio. */}
                {stats.narrationPending > 0 && !isGeneratingNarrationBatch && (
                  <button
                    type="button"
                    onClick={() => void generateNarrationBatch()}
                    title="Stuck for a while? Re-run narration for any beats still missing audio."
                    className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-neutral-800/80 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Resume
                  </button>
                )}
              </>
            ) : stats.narrationPathNeeding > 0 ? (
              <>
                <div className="min-w-0 text-left">
                  <p className="text-sm text-neutral-100">Generate all narration for this story</p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {narrationEnabled
                      ? `Narrate ${stats.narrationPathNeeding} beat${stats.narrationPathNeeding === 1 ? '' : 's'} on this path — runs on our servers, so you can leave and come back.`
                      : 'Reach the end of the story to generate all narration in one go.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void generateNarrationBatch()}
                  disabled={!narrationEnabled}
                  title={narrationEnabled ? undefined : 'Finish the story — the button activates on the ending beat.'}
                  className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                    narrationEnabled
                      ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
                      : 'cursor-not-allowed border-white/10 bg-neutral-800/60 text-neutral-500'
                  }`}
                >
                  {narrationEnabled ? (
                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Generate all narration
                </button>
              </>
            ) : (
              <>
                <span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 text-left">
                  <p className="text-sm text-neutral-100">Narration ready</p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {narrationBatchMessage ?? 'All beats on this path are narrated.'}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
