'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Check, Loader2, ExternalLink } from 'lucide-react';

import { useAuth } from '@/lib/hooks/useAuth';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { useStoryStore } from '@/lib/store/story-store';
import { extractStoryline } from '@/lib/utils/storyline';
import { uploadNodeAssets, uploadCoverImage, extractStoragePath, stripBase64FromStoryMap } from '@/lib/supabase/storage';
import { publishStoryline, saveStory, copyCoverToPublicBucket } from '@/app/actions/persistence';
import {
  buildStoryCoverPromptInputFromSession,
  generateStoryCoverPrompt,
} from '@/lib/story/cover-prompts';
import type { Character, StoryBeat, StoryMap, StorySession } from '@/lib/types/story';

import StorylineCoverEditorForm, {
  type StorylineCoverEditorSubmission,
} from './StorylineCoverEditorForm';

interface PublishDialogProps {
  isOpen: boolean;
  onClose: () => void;
  endingNodeId: string;
  publishMode?: 'standard' | 'audio_story';
  allowMissingImages?: boolean;
}

function sanitizeCharactersForPersistence(characters: Character[]): Character[] {
  return characters.map((character) => {
    const cleanedGallery = (character.referenceSheetGallery ?? [])
      .filter((entry) => Boolean(entry?.url) && !entry.url.startsWith('data:'));

    return {
      ...character,
      portraitBase64: undefined,
      referenceSheetUrl: character.referenceSheetUrl?.startsWith('data:')
        ? undefined
        : character.referenceSheetUrl,
      referenceSheetGallery: cleanedGallery.length > 0 ? cleanedGallery : undefined,
    };
  });
}

function buildPersistableSessionSnapshot(session: StorySession, storyMap: StoryMap): StorySession {
  return {
    ...session,
    characters: sanitizeCharactersForPersistence(session.characters),
    beats: [],
    storyMap,
  };
}

function sanitizeBeatForPublish(beat: StoryBeat): StoryBeat {
  const { imageGallery: _imageGallery, persistedImageUrl: _persistedImageUrl, ...rest } = beat;
  void _imageGallery;
  void _persistedImageUrl;

  return {
    ...rest,
    characters: sanitizeCharactersForPersistence(beat.characters),
    imageGallery: [],
    persistedImageUrl: undefined,
    imageUrl: beat.imageUrl?.startsWith('data:') ? undefined : beat.imageUrl,
    audioUrl: beat.audioUrl?.startsWith('data:') ? undefined : beat.audioUrl,
  };
}

export default function PublishDialog({
  isOpen,
  onClose,
  endingNodeId,
  publishMode = 'standard',
  allowMissingImages = false,
}: PublishDialogProps) {
  const { user } = useAuth();
  const { data: pricing } = usePricingRuntime();
  const session = useStoryStore((state) => state.session);
  const [status, setStatus] = useState<'idle' | 'saving' | 'uploading' | 'publishing' | 'done' | 'error'>('idle');
  const [storylineUrl, setStorylineUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!session || !user) return null;

  const { storyMap } = session;
  const storylineData = extractStoryline(storyMap, endingNodeId);
  const hasAllBeatImages = storylineData.beats.every((beat) => Boolean(beat.imageUrl || beat.persistedImageUrl));
  const canPublishBase = allowMissingImages || hasAllBeatImages;
  const isVerticalStory = session.storyConfig.isVerticalStory || session.storyConfig.aspectRatio === '9:16';
  const isPromptOnlyStory = session.storyConfig.imageGenerationMode === 'prompt_only';
  const storyFormat = publishMode === 'audio_story' ? 'audio_story' : 'visual_story';
  const publishLabel = publishMode === 'audio_story' ? 'Publish Audio Story' : 'Publish Storyline';
  const socialCoverCoinCost = (pricing.actionCosts.generate_social_share_cover ?? 1) * 10;
  const audioCoverCoinCost = (pricing.actionCosts.generate_audio_story_cover ?? 1) * 10;
  const reelThumbnailCoinCost = (pricing.actionCosts.generate_reel_thumbnail ?? 1) * 10;
  const promptInput = buildStoryCoverPromptInputFromSession(session, storylineData.beats, { storyFormat });
  const socialCoverPrompt = generateStoryCoverPrompt(promptInput, { variant: publishMode === 'audio_story' ? 'audio' : 'social' });
  const youtubeThumbnailPrompt = generateStoryCoverPrompt(promptInput, { variant: 'youtube' });
  const reelThumbnailPrompt = generateStoryCoverPrompt(promptInput, { variant: 'reel' });

  const handleDialogClose = () => {
    setStatus('idle');
    setStorylineUrl(null);
    setErrorMsg(null);
    onClose();
  };

  const handlePublish = async (submission: StorylineCoverEditorSubmission) => {
    try {
      let storyId = session.savedStoryId;
      if (!storyId) {
        setStatus('saving');
        const compactStoryMap = stripBase64FromStoryMap(storyMap);
        const persistableSession = buildPersistableSessionSnapshot(session, compactStoryMap);
        const result = await saveStory(persistableSession, compactStoryMap);
        storyId = result.storyId;
        useStoryStore.setState((state) => ({
          session: state.session ? { ...state.session, savedStoryId: storyId } : null,
        }));
      }

      setStatus('uploading');
      const nodeIds = storylineData.path.map((node) => node.id);
      const assetMap = await uploadNodeAssets(
        'public-storylines',
        `${user.id}/${storyId}`,
        storyMap,
        nodeIds
      );

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

      const beatsWithUrls: StoryBeat[] = storylineData.beats.map((beat, index) => {
        const nodeId = storylineData.path[index].id;
        const urls = assetMap[nodeId];
        const resolvedImageUrl = urls?.imageUrl || beat.imageUrl;
        const resolvedAudioUrl = urls?.audioUrl || beat.audioUrl;
        const sanitizedBeat = sanitizeBeatForPublish(beat);
        return {
          ...sanitizedBeat,
          imageUrl: resolvedImageUrl && resolvedImageUrl.startsWith('data:') ? undefined : resolvedImageUrl,
          audioUrl: resolvedAudioUrl && resolvedAudioUrl.startsWith('data:') ? undefined : resolvedAudioUrl,
        };
      });

      setStatus('publishing');
      const { storylineId } = await publishStoryline({
        storyId: storyId!,
        title: session.title,
        beats: beatsWithUrls,
        choices: storylineData.choices,
        nodePath: nodeIds,
        coverImageUrl,
        publishMode,
        ...submission,
      });

      setStorylineUrl(`/storyline/${storylineId}`);
      setStatus('done');
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to publish');
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
          onClick={status === 'done' || status === 'idle' || status === 'error' ? handleDialogClose : undefined}
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
              <h2 className="text-lg font-serif text-neutral-100">
                {publishMode === 'audio_story' ? 'Publish Audio Story' : 'Publish Storyline'}
              </h2>
              {(status === 'idle' || status === 'done' || status === 'error') && (
                <button onClick={handleDialogClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-4 h-4 text-neutral-400" />
                </button>
              )}
            </div>

            {status === 'idle' && (
              <StorylineCoverEditorForm
                mode="publish"
                storyId={session.savedStoryId ?? null}
                title={session.title}
                detailText={`${storylineData.beats.length} beats · ${storylineData.choices.length} choices`}
                introText={publishMode === 'audio_story'
                  ? 'This will publish your story as an audio-first storyline. Missing beat images will show a neutral placeholder in the player.'
                  : 'This will publish your storyline for everyone to discover and play.'}
                storyFormat={storyFormat}
                isVerticalStory={isVerticalStory}
                socialCoverPrompt={socialCoverPrompt}
                youtubeThumbnailPrompt={youtubeThumbnailPrompt}
                reelThumbnailPrompt={reelThumbnailPrompt}
                audioCoverPrompt={publishMode === 'audio_story' ? socialCoverPrompt : null}
                socialCoverCoinCost={socialCoverCoinCost}
                audioCoverCoinCost={audioCoverCoinCost}
                reelThumbnailCoinCost={reelThumbnailCoinCost}
                sectionTitle={publishMode === 'audio_story' ? 'Cover Image for Sharing' : 'Share Cover / Thumbnail'}
                helperText={publishMode === 'audio_story'
                  ? 'This cover will be shown when your audio story is shared on WhatsApp and social media.'
                  : 'This dedicated image is used for WhatsApp, social previews, and crawler metadata.'}
                submitLabel={publishLabel}
                canSubmitBase={canPublishBase}
                blockedMessage={!canPublishBase
                  ? 'Full storyline publishing needs an image on every beat. Upload the missing beat images first, or use audio-story publishing when it is enabled.'
                  : null}
                emptyHint={publishMode === 'audio_story'
                  ? null
                  : isPromptOnlyStory
                    ? 'If you publish without uploading or generating a cover, Kissago will use a branded default cover.'
                    : 'If you skip this, Kissago will process the best available beat image into a dedicated share cover.'}
                onCancel={handleDialogClose}
                onSubmit={(submission) => void handlePublish(submission)}
              />
            )}

            {(status === 'saving' || status === 'uploading' || status === 'publishing') && (
              <div className="flex flex-col items-center py-6 gap-4">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                <p className="text-sm text-neutral-400">{statusMessages[status]}</p>
              </div>
            )}

            {status === 'done' && (
              <div className="space-y-4">
                <div className="flex flex-col items-center py-4 gap-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Check className="w-6 h-6 text-emerald-400" />
                  </div>
                  <p className="text-sm text-neutral-300">
                    {publishMode === 'audio_story'
                      ? 'Audio story published successfully!'
                      : 'Storyline published successfully!'}
                  </p>
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
