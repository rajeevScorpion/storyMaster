'use client';

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ImageIcon, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useStoryStore } from '@/lib/store/story-store';
import type { StoryBeat } from '@/lib/types/story';

function beatHasReadyImage(beat: StoryBeat): boolean {
  return beat.imageStatus === 'ready' && Boolean(beat.imageUrl);
}

function beatHasPrompt(beat: StoryBeat): boolean {
  return Boolean((beat.finalImagePromptText || beat.storyboardPromptText || beat.imagePrompt || '').trim());
}

/**
 * Story-level banner for deferred (background) image generation. Offers a
 * "Create visuals" action for a text-only / prompt-only story, and shows an
 * in-flight status once a batch is submitted. Renders nothing when there is
 * nothing to generate. Cost saving: batch runs at ~50% of live price.
 */
export default function BatchVisualsBanner() {
  const session = useStoryStore((state) => state.session);
  const submitImageBatch = useStoryStore((state) => state.submitImageBatch);
  const reconcileCurrentStoryBatch = useStoryStore((state) => state.reconcileCurrentStoryBatch);
  const isSubmitting = useStoryStore((state) => state.isSubmittingImageBatch);
  const message = useStoryStore((state) => state.imageBatchMessage);

  const stats = useMemo(() => {
    if (!session) return { total: 0, ready: 0, pending: 0, needing: 0 };
    let total = 0;
    let ready = 0;
    let pending = 0;
    let needing = 0;
    for (const node of Object.values(session.storyMap.nodes)) {
      const beat = node.data;
      if (!beatHasPrompt(beat)) continue;
      total += 1;
      if (beatHasReadyImage(beat)) ready += 1;
      else if (beat.imageStatus === 'pending') pending += 1;
      else needing += 1;
    }
    return { total, ready, pending, needing };
  }, [session]);

  const isReel = session?.storyConfig.storyKind === 'reel';
  const savedStoryId = session?.savedStoryId ?? null;
  const canShow = Boolean(session) && !isReel && Boolean(savedStoryId);
  // Show the create CTA only when there are beats still lacking an image and
  // none are already queued.
  const showCreate = canShow && stats.pending === 0 && stats.needing > 0;
  const showInFlight = canShow && stats.pending > 0;

  if (!showCreate && !showInFlight) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={showInFlight ? 'in-flight' : 'create'}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-white/10 bg-neutral-900/85 px-4 py-3 shadow-xl backdrop-blur-md"
        >
          {showInFlight ? (
            <>
              <span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                <ImageIcon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 text-left">
                <p className="text-sm text-neutral-100">Visuals are generating in the background</p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {stats.ready} of {stats.total} ready · check back within a day.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void reconcileCurrentStoryBatch()}
                className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-neutral-800/80 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Check now
              </button>
            </>
          ) : (
            <>
              <span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 text-left">
                <p className="text-sm text-neutral-100">Create visuals for this story</p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {message
                    ? message
                    : `Generate images for ${stats.needing} beat${stats.needing === 1 ? '' : 's'} in the background — ready within a day, ~50% cheaper.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void submitImageBatch()}
                disabled={isSubmitting}
                className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {isSubmitting ? 'Submitting…' : 'Create visuals'}
              </button>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
