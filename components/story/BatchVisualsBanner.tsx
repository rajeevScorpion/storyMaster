'use client';

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ImageIcon, Loader2, Lock, RefreshCw } from 'lucide-react';
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
 * Story-level banner for deferred (background) image generation. Batch image
 * generation is branch-aware: the "Create all visuals" action only activates on
 * a terminal (ending) beat and submits the current root→ending path. On every
 * other beat the banner shows the same CTA disabled with guidance. Shared beats
 * that already have images are skipped server-side, preserving continuity.
 * Cost saving: batch runs at ~50% of live price.
 */
export default function BatchVisualsBanner() {
  const session = useStoryStore((state) => state.session);
  const submitImageBatch = useStoryStore((state) => state.submitImageBatch);
  const reconcileCurrentStoryBatch = useStoryStore((state) => state.reconcileCurrentStoryBatch);
  const isSubmitting = useStoryStore((state) => state.isSubmittingImageBatch);
  const message = useStoryStore((state) => state.imageBatchMessage);

  const stats = useMemo(() => {
    if (!session) return { total: 0, ready: 0, pending: 0, pathNeeding: 0, isTerminal: false };
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

    // Beats needing images on the current root→current-node path.
    const path = getPathToNode(session.storyMap, session.storyMap.currentNodeId);
    let pathNeeding = 0;
    for (const node of path) {
      const beat = node.data;
      if (beatHasPrompt(beat) && !beatHasReadyImage(beat) && beat.imageStatus !== 'pending') {
        pathNeeding += 1;
      }
    }

    const currentNode = session.storyMap.nodes[session.storyMap.currentNodeId];
    const isTerminal = Boolean(
      currentNode && (currentNode.data.isEnding === true || (currentNode.data.options?.length ?? 0) === 0)
    );

    return { total, ready, pending, pathNeeding, isTerminal };
  }, [session]);

  const isReel = session?.storyConfig.storyKind === 'reel';
  const savedStoryId = session?.savedStoryId ?? null;
  const defersImages = Boolean(
    session &&
    (session.storyConfig.imageDeliveryMode === 'batch' ||
      session.storyConfig.imageGenerationMode === 'prompt_only')
  );
  const canShow = Boolean(session) && !isReel && Boolean(savedStoryId) && defersImages;
  const showInFlight = canShow && stats.pending > 0;
  // Show the create CTA on any beat that still has image-less beats on its path,
  // but only enable it on a terminal beat.
  const showCreate = canShow && stats.pending === 0 && stats.pathNeeding > 0;

  if (!showCreate && !showInFlight) return null;

  const createEnabled = stats.isTerminal && !isSubmitting;

  return (
    <div className="mb-3 w-full">
      <AnimatePresence mode="wait">
        <motion.div
          key={showInFlight ? 'in-flight' : 'create'}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-neutral-900/90 px-4 py-3 shadow-xl backdrop-blur-md"
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
              <div className="min-w-0 text-left">
                <p className="text-sm text-neutral-100">Create all visuals for this story</p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {message
                    ? message
                    : createEnabled
                    ? `Generate images for ${stats.pathNeeding} beat${stats.pathNeeding === 1 ? '' : 's'} on this path in the background — ready within a day, ~50% cheaper.`
                    : 'Reach the end of the story to create all visuals in one batch.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void submitImageBatch('current_path')}
                disabled={!createEnabled}
                title={createEnabled ? undefined : 'Finish the story — the button activates on the ending beat.'}
                className={`ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
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
    </div>
  );
}
