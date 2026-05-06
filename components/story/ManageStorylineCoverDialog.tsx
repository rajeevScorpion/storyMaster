'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ExternalLink, Loader2, X } from 'lucide-react';

import {
  getPublishedStorylineCoverEditorState,
  updatePublishedStorylineShareAssets,
  type PublishedStorylineCoverEditorState,
} from '@/app/actions/storyline-covers';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';

import StorylineCoverEditorForm, {
  type StorylineCoverEditorPersistedAssets,
  type StorylineCoverEditorSubmission,
} from './StorylineCoverEditorForm';

interface ManageStorylineCoverDialogProps {
  isOpen: boolean;
  onClose: () => void;
  storylineId: string | null;
}

function buildPersistedAssets(
  editorState: PublishedStorylineCoverEditorState
): StorylineCoverEditorPersistedAssets {
  return {
    shareCover: editorState.shareCoverUrl
      ? {
          url: editorState.shareCoverUrl,
          label: 'Social Share Cover',
          description: 'Used for WhatsApp, Open Graph, and Twitter previews.',
          width: editorState.shareCoverWidth,
          height: editorState.shareCoverHeight,
          mimeType: editorState.shareCoverMimeType,
          updatedAt: editorState.shareCoverUpdatedAt,
        }
      : null,
    youtubeThumbnail: editorState.youtubeThumbnailUrl
      ? {
          url: editorState.youtubeThumbnailUrl,
          label: 'YouTube Thumbnail',
          description: 'Stored as a separate creator-facing 16:9 thumbnail.',
          width: editorState.youtubeThumbnailWidth,
          height: editorState.youtubeThumbnailHeight,
          mimeType: editorState.youtubeThumbnailMimeType,
          updatedAt: editorState.youtubeThumbnailUpdatedAt,
        }
      : null,
    reelThumbnail: editorState.reelThumbnailUrl
      ? {
          url: editorState.reelThumbnailUrl,
          label: 'Reel Thumbnail',
          description: 'Used for vertical reel and shorts workflows.',
          width: editorState.reelThumbnailWidth,
          height: editorState.reelThumbnailHeight,
          mimeType: editorState.reelThumbnailMimeType,
          updatedAt: editorState.reelThumbnailUpdatedAt,
        }
      : null,
  };
}

export default function ManageStorylineCoverDialog({
  isOpen,
  onClose,
  storylineId,
}: ManageStorylineCoverDialogProps) {
  const { data: pricing } = usePricingRuntime();
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving' | 'done' | 'error'>('loading');
  const [editorState, setEditorState] = useState<PublishedStorylineCoverEditorState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadEditorState = async (id: string) => {
    setStatus('loading');
    setErrorMsg(null);
    try {
      const result = await getPublishedStorylineCoverEditorState(id);
      setEditorState(result);
      setStatus('idle');
    } catch (error: any) {
      setEditorState(null);
      setErrorMsg(error?.message || 'Could not load this storyline cover.');
      setStatus('error');
    }
  };

  useEffect(() => {
    if (!isOpen || !storylineId) return;
    void loadEditorState(storylineId);
  }, [isOpen, storylineId]);

  const handleDialogClose = () => {
    setStatus('loading');
    setErrorMsg(null);
    onClose();
  };

  const handleSave = async (submission: StorylineCoverEditorSubmission) => {
    if (!storylineId) return;

    setStatus('saving');
    setErrorMsg(null);
    try {
      const updated = await updatePublishedStorylineShareAssets({
        storylineId,
        ...submission,
      });
      setEditorState(updated);
      setStatus('done');
    } catch (error: any) {
      setErrorMsg(error?.message || 'Could not update this storyline cover.');
      setStatus('error');
    }
  };

  const socialCoverCoinCost = (pricing.actionCosts.generate_social_share_cover ?? 1) * 10;
  const audioCoverCoinCost = (pricing.actionCosts.generate_audio_story_cover ?? 1) * 10;
  const reelThumbnailCoinCost = (pricing.actionCosts.generate_reel_thumbnail ?? 1) * 10;

  return (
    <AnimatePresence>
      {isOpen && storylineId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={status === 'idle' || status === 'done' || status === 'error' ? handleDialogClose : undefined}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900/95 p-6 shadow-2xl backdrop-blur-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-serif text-neutral-100">Manage Cover</h2>
              {(status === 'idle' || status === 'done' || status === 'error') && (
                <button onClick={handleDialogClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-4 h-4 text-neutral-400" />
                </button>
              )}
            </div>

            {status === 'loading' && (
              <div className="flex flex-col items-center py-8 gap-4">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                <p className="text-sm text-neutral-400">Loading cover assets...</p>
              </div>
            )}

            {status === 'idle' && editorState && (
              <StorylineCoverEditorForm
                mode="manage"
                storyId={editorState.storyId}
                storylineId={editorState.storylineId}
                title={editorState.title}
                detailText={`${editorState.beatCount} beats`}
                introText="Update the assets used when this published storyline is shared. Changes are saved in place and the storyline URL stays the same."
                storyFormat={editorState.storyFormat}
                isVerticalStory={editorState.isVerticalStory}
                socialCoverPrompt={editorState.socialCoverPrompt}
                youtubeThumbnailPrompt={editorState.youtubeThumbnailPrompt}
                reelThumbnailPrompt={editorState.reelThumbnailPrompt}
                audioCoverPrompt={editorState.audioCoverPrompt}
                socialCoverCoinCost={socialCoverCoinCost}
                audioCoverCoinCost={audioCoverCoinCost}
                reelThumbnailCoinCost={reelThumbnailCoinCost}
                sectionTitle={editorState.storyFormat === 'audio_story' ? 'Manage Cover Image for Sharing' : 'Manage Share Cover / Thumbnail'}
                helperText={editorState.storyFormat === 'audio_story'
                  ? 'This cover is used when your audio story is shared on WhatsApp and social media.'
                  : 'These assets control the public share cover, YouTube thumbnail, and reel thumbnail for this published storyline.'}
                submitLabel="Save Changes"
                emptyHint="Existing published assets stay live until you save a replacement."
                submitBusy={false}
                persistedAssets={buildPersistedAssets(editorState)}
                onCancel={handleDialogClose}
                onSubmit={(submission) => void handleSave(submission)}
              />
            )}

            {status === 'saving' && (
              <div className="flex flex-col items-center py-8 gap-4">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                <p className="text-sm text-neutral-400">Saving cover changes...</p>
              </div>
            )}

            {status === 'done' && editorState && (
              <div className="space-y-4">
                <div className="flex flex-col items-center py-4 gap-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Check className="w-6 h-6 text-emerald-400" />
                  </div>
                  <p className="text-sm text-neutral-300">Cover updated successfully.</p>
                </div>
                <a
                  href={editorState.storylineUrl}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 text-neutral-300 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open Storyline
                </a>
                <button
                  onClick={handleDialogClose}
                  className="w-full px-4 py-2 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  Close
                </button>
              </div>
            )}

            {status === 'error' && (
              <div className="space-y-4">
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                  <p className="text-sm text-red-300">{errorMsg}</p>
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={handleDialogClose}
                    className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => storylineId && void loadEditorState(storylineId)}
                    className="px-4 py-2 text-sm bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 text-neutral-300 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
