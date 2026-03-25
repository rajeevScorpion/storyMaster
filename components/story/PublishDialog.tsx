'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, Check, Loader2, ExternalLink } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useStoryStore } from '@/lib/store/story-store';
import { extractStoryline } from '@/lib/utils/storyline';
import { uploadNodeAssets, uploadCoverImage, extractStoragePath } from '@/lib/supabase/storage';
import { publishStoryline, saveStory, copyCoverToPublicBucket } from '@/app/actions/persistence';
import type { StoryBeat } from '@/lib/types/story';

interface PublishDialogProps {
  isOpen: boolean;
  onClose: () => void;
  endingNodeId: string;
}

export default function PublishDialog({ isOpen, onClose, endingNodeId }: PublishDialogProps) {
  const { user } = useAuth();
  const session = useStoryStore((state) => state.session);
  const [status, setStatus] = useState<'idle' | 'saving' | 'uploading' | 'publishing' | 'done' | 'error'>('idle');
  const [storylineUrl, setStorylineUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!session || !user) return null;

  const { storyMap } = session;
  const storylineData = extractStoryline(storyMap, endingNodeId);

  const handlePublish = async () => {
    try {
      // Step 1: Save the story first if not yet saved
      let storyId = session.savedStoryId;
      if (!storyId) {
        setStatus('saving');
        const result = await saveStory(session, storyMap);
        storyId = result.storyId;
        // Update local session with savedStoryId
        useStoryStore.setState((state) => ({
          session: state.session ? { ...state.session, savedStoryId: storyId } : null,
        }));
      }

      // Step 2: Upload storyline assets to public bucket
      setStatus('uploading');
      const nodeIds = storylineData.path.map((n) => n.id);
      const assetMap = await uploadNodeAssets(
        'public-storylines',
        `${user.id}/${storyId}`,
        storyMap,
        nodeIds
      );

      // Step 3: Upload cover image (second beat = first user choice)
      const coverIdx = storylineData.path.length > 1 ? 1 : 0;
      const coverNode = storylineData.path[coverIdx];
      let coverImageUrl: string | null = null;
      const coverImgData = coverNode?.data.imageUrl;
      if (coverImgData) {
        if (coverImgData.startsWith('data:')) {
          coverImageUrl = await uploadCoverImage(user.id, storyId!, coverImgData);
        } else if (extractStoragePath(coverImgData, 'story-assets')) {
          coverImageUrl = await copyCoverToPublicBucket(storyId!, coverImgData);
        } else if (extractStoragePath(coverImgData, 'public-storylines')) {
          coverImageUrl = coverImgData;
        }
      }

      // Step 4: Build beats with storage URLs
      const beatsWithUrls: StoryBeat[] = storylineData.beats.map((beat, i) => {
        const nodeId = storylineData.path[i].id;
        const urls = assetMap[nodeId];
        return {
          ...beat,
          imageUrl: urls?.imageUrl || beat.imageUrl,
          audioUrl: urls?.audioUrl || beat.audioUrl,
        };
      });

      // Step 5: Publish to database
      setStatus('publishing');
      const { storylineId } = await publishStoryline({
        storyId: storyId!,
        title: session.title,
        beats: beatsWithUrls,
        choices: storylineData.choices,
        nodePath: nodeIds,
        coverImageUrl,
      });

      setStorylineUrl(`/storyline/${storylineId}`);
      setStatus('done');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to publish');
      setStatus('error');
    }
  };

  const statusMessages: Record<string, string> = {
    saving: 'Saving story...',
    uploading: 'Uploading images & audio...',
    publishing: 'Publishing storyline...',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={status === 'done' || status === 'idle' || status === 'error' ? onClose : undefined}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            className="bg-neutral-900/95 border border-white/10 rounded-2xl p-6 max-w-md w-full backdrop-blur-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-serif text-neutral-100">Publish Storyline</h2>
              {(status === 'idle' || status === 'done' || status === 'error') && (
                <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-4 h-4 text-neutral-400" />
                </button>
              )}
            </div>

            {/* Idle: confirmation */}
            {status === 'idle' && (
              <div className="space-y-4">
                <p className="text-sm text-neutral-400">
                  This will publish your storyline for everyone to discover and play.
                </p>
                <div className="bg-white/5 rounded-xl p-3 space-y-1">
                  <p className="text-sm font-medium text-neutral-200">{session.title}</p>
                  <p className="text-xs text-neutral-500">
                    {storylineData.beats.length} beats &middot; {storylineData.choices.length} choices
                  </p>
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePublish}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-xl hover:bg-emerald-500/30 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    Publish
                  </button>
                </div>
              </div>
            )}

            {/* In progress */}
            {(status === 'saving' || status === 'uploading' || status === 'publishing') && (
              <div className="flex flex-col items-center py-6 gap-4">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                <p className="text-sm text-neutral-400">{statusMessages[status]}</p>
              </div>
            )}

            {/* Done */}
            {status === 'done' && (
              <div className="space-y-4">
                <div className="flex flex-col items-center py-4 gap-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Check className="w-6 h-6 text-emerald-400" />
                  </div>
                  <p className="text-sm text-neutral-300">Storyline published successfully!</p>
                </div>
                {storylineUrl && (
                  <a
                    href={storylineUrl}
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 text-neutral-300 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View Storyline
                  </a>
                )}
                <button
                  onClick={onClose}
                  className="w-full px-4 py-2 text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  Close
                </button>
              </div>
            )}

            {/* Error */}
            {status === 'error' && (
              <div className="space-y-4">
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                  <p className="text-sm text-red-300">{errorMsg}</p>
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => { setStatus('idle'); setErrorMsg(null); }}
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
