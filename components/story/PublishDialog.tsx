'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, Check, Loader2, ExternalLink, Copy, ImageIcon, WandSparkles } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePricingRuntime } from '@/lib/hooks/usePricingRuntime';
import { useStoryStore } from '@/lib/store/story-store';
import { extractStoryline } from '@/lib/utils/storyline';
import { uploadNodeAssets, uploadCoverImage, extractStoragePath, stripBase64FromStoryMap } from '@/lib/supabase/storage';
import { publishStoryline, saveStory, copyCoverToPublicBucket } from '@/app/actions/persistence';
import { generateDraftStoryCoverImage } from '@/app/actions/storyline-covers';
import {
  buildStoryCoverPromptInputFromSession,
  generateStoryCoverPrompt,
  type StoryCoverPromptVariant,
} from '@/lib/story/cover-prompts';
import type { Character, StoryBeat, StoryMap, StorySession } from '@/lib/types/story';

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

const ACCEPTED_COVER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const SOCIAL_COVER_MAX_BYTES = 5 * 1024 * 1024;
const YOUTUBE_THUMBNAIL_MAX_BYTES = 3 * 1024 * 1024;
const REEL_THUMBNAIL_MAX_BYTES = 3 * 1024 * 1024;
const ASPECT_RATIO_TOLERANCE = 0.02;

type CoverAssetKind = 'social' | 'youtube' | 'reel';

type CoverUploadPreview = {
  dataUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  width: number;
  height: number;
  source: 'uploaded' | 'custom_generated';
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Could not read the selected image.'));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve({ width: image.width, height: image.height });
    image.onerror = () => reject(new Error('Could not inspect the selected image.'));
    image.src = dataUrl;
  });
}

function assertAspectRatio(width: number, height: number, targetRatio: number, label: string) {
  if (height <= 0 || Math.abs((width / height) - targetRatio) > ASPECT_RATIO_TOLERANCE) {
    throw new Error(`Image must use a ${label} aspect ratio.`);
  }
}

async function validateCoverUpload(file: File, kind: CoverAssetKind): Promise<CoverUploadPreview> {
  if (!ACCEPTED_COVER_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_COVER_IMAGE_TYPES)[number])) {
    throw new Error('Use a JPG, PNG, or WebP image.');
  }

  const maxBytes = kind === 'social'
    ? SOCIAL_COVER_MAX_BYTES
    : kind === 'youtube'
      ? YOUTUBE_THUMBNAIL_MAX_BYTES
      : REEL_THUMBNAIL_MAX_BYTES;
  if (file.size > maxBytes) {
    throw new Error(`Image must be ${(maxBytes / (1024 * 1024)).toFixed(0)} MB or smaller.`);
  }

  const dataUrl = await readFileAsDataUrl(file);
  const { width, height } = await readImageDimensions(dataUrl);

  if (kind === 'youtube') {
    assertAspectRatio(width, height, 16 / 9, '16:9');
    if (width < 1280 || height < 720) throw new Error('YouTube thumbnails must be at least 1280x720.');
  } else if (kind === 'reel') {
    assertAspectRatio(width, height, 9 / 16, '9:16');
    if (width < 1080 || height < 1920) throw new Error('Reel thumbnails must be at least 1080x1920.');
  } else if (width < 600 || height < 315) {
    throw new Error('Share covers should be at least 600x315. 1200x630 is recommended.');
  }

  return {
    dataUrl,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    width,
    height,
    source: 'uploaded',
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
  const [shareCoverPreview, setShareCoverPreview] = useState<CoverUploadPreview | null>(null);
  const [youtubePreview, setYoutubePreview] = useState<CoverUploadPreview | null>(null);
  const [reelPreview, setReelPreview] = useState<CoverUploadPreview | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [generatingCover, setGeneratingCover] = useState<StoryCoverPromptVariant | null>(null);
  const shareCoverInputRef = useRef<HTMLInputElement>(null);
  const youtubeInputRef = useRef<HTMLInputElement>(null);
  const reelInputRef = useRef<HTMLInputElement>(null);

  if (!session || !user) return null;

  const { storyMap } = session;
  const storylineData = extractStoryline(storyMap, endingNodeId);
  const hasAllBeatImages = storylineData.beats.every((beat) => Boolean(beat.imageUrl || beat.persistedImageUrl));
  const canPublishBase = allowMissingImages || hasAllBeatImages;
  const isVerticalStory = session.storyConfig.isVerticalStory || session.storyConfig.aspectRatio === '9:16';
  const isPromptOnlyStory = session.storyConfig.imageGenerationMode === 'prompt_only';
  const storyFormat = publishMode === 'audio_story' ? 'audio_story' : 'visual_story';
  const hasShareAsset = Boolean(shareCoverPreview || youtubePreview);
  const canPublish = canPublishBase && (publishMode !== 'audio_story' || hasShareAsset);
  const dialogTitle = publishMode === 'audio_story' ? 'Publish Audio Story' : 'Publish Storyline';
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
    setCoverError(null);
    setCopiedPrompt(null);
    setGeneratingCover(null);
    setShareCoverPreview(null);
    setYoutubePreview(null);
    setReelPreview(null);
    onClose();
  };

  const copyPrompt = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPrompt(key);
      window.setTimeout(() => setCopiedPrompt(null), 1600);
    } catch {
      setCoverError('Could not copy the prompt.');
    }
  };

  const handleCoverFileSelected = async (
    event: ChangeEvent<HTMLInputElement>,
    kind: CoverAssetKind
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setCoverError(null);
    try {
      const preview = await validateCoverUpload(file, kind);
      if (kind === 'youtube') {
        setYoutubePreview(preview);
        setShareCoverPreview(null);
      } else if (kind === 'reel') {
        setReelPreview(preview);
      } else {
        setShareCoverPreview(preview);
        setYoutubePreview(null);
      }
    } catch (error: any) {
      setCoverError(error?.message || 'Could not validate the selected image.');
    }
  };

  const generateCover = async (variant: StoryCoverPromptVariant) => {
    const kind = variant === 'audio' ? 'audio' : variant === 'reel' ? 'reel' : variant === 'youtube' ? 'youtube' : 'social';
    const prompt = variant === 'audio' ? socialCoverPrompt : variant === 'youtube' ? youtubeThumbnailPrompt : variant === 'reel' ? reelThumbnailPrompt : socialCoverPrompt;
    setGeneratingCover(variant);
    setCoverError(null);
    try {
      const result = await generateDraftStoryCoverImage({
        storyId: session.savedStoryId ?? null,
        prompt,
        kind,
      });
      const { width, height } = await readImageDimensions(result.dataUrl);
      const preview: CoverUploadPreview = {
        dataUrl: result.dataUrl,
        fileName: `${variant}-cover.webp`,
        fileSize: 0,
        mimeType: 'image/webp',
        width,
        height,
        source: 'custom_generated',
      };
      if (variant === 'youtube') {
        setYoutubePreview(preview);
        setShareCoverPreview(null);
      } else if (variant === 'reel') {
        setReelPreview(preview);
      } else {
        setShareCoverPreview(preview);
        setYoutubePreview(null);
      }
    } catch (error: any) {
      setCoverError(error?.message || 'Cover generation failed.');
    } finally {
      setGeneratingCover(null);
    }
  };

  const handlePublish = async () => {
    if (!canPublish) {
      setErrorMsg(publishMode === 'audio_story' && !hasShareAsset
        ? 'Add a sharing cover before publishing this audio story.'
        : 'Add an image to every beat before publishing a full storyline.');
      setStatus('error');
      return;
    }

    try {
      // Step 1: Save the story first if not yet saved
      let storyId = session.savedStoryId;
      if (!storyId) {
        setStatus('saving');
        const compactStoryMap = stripBase64FromStoryMap(storyMap);
        const persistableSession = buildPersistableSessionSnapshot(session, compactStoryMap);
        const result = await saveStory(persistableSession, compactStoryMap);
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

      // Step 4: Build beats with storage URLs.
      // Drop imageGallery (editor-only, may carry local data URLs from a fresh
      // upload) and persistedImageUrl (transient local pointer). Anything left
      // is needed by the storyline player.
      const beatsWithUrls: StoryBeat[] = storylineData.beats.map((beat, i) => {
        const nodeId = storylineData.path[i].id;
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

      // Step 5: Publish to database
      setStatus('publishing');
      const { storylineId } = await publishStoryline({
        storyId: storyId!,
        title: session.title,
        beats: beatsWithUrls,
        choices: storylineData.choices,
        nodePath: nodeIds,
        coverImageUrl,
        publishMode,
        shareCoverDataUrl: shareCoverPreview?.dataUrl ?? null,
        youtubeThumbnailDataUrl: youtubePreview?.dataUrl ?? null,
        reelThumbnailDataUrl: reelPreview?.dataUrl ?? null,
        shareCoverSource: shareCoverPreview?.source ?? null,
        youtubeThumbnailSource: youtubePreview?.source ?? null,
        reelThumbnailSource: reelPreview?.source ?? null,
        socialCoverPrompt,
        youtubeThumbnailPrompt,
        reelThumbnailPrompt: isVerticalStory ? reelThumbnailPrompt : null,
        audioCoverPrompt: publishMode === 'audio_story' ? socialCoverPrompt : null,
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
  const activeSharePreview = youtubePreview ?? shareCoverPreview;
  const shareCoverTitle = publishMode === 'audio_story' ? 'Cover Image for Sharing' : 'Share Cover / Thumbnail';
  const shareCoverHelper = publishMode === 'audio_story'
    ? 'This cover will be shown when your audio story is shared on WhatsApp and social media.'
    : 'This dedicated image is used for WhatsApp, social previews, and crawler metadata.';

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
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-serif text-neutral-100">{dialogTitle}</h2>
              {(status === 'idle' || status === 'done' || status === 'error') && (
                <button onClick={handleDialogClose} className="p-1 hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-4 h-4 text-neutral-400" />
                </button>
              )}
            </div>

            {/* Idle: confirmation */}
            {status === 'idle' && (
              <div className="space-y-4">
                <p className="text-sm text-neutral-400">
                  {publishMode === 'audio_story'
                    ? 'This will publish your story as an audio-first storyline. Missing beat images will show a neutral placeholder in the player.'
                    : 'This will publish your storyline for everyone to discover and play.'}
                </p>
                <div className="bg-white/5 rounded-xl p-3 space-y-1">
                  <p className="text-sm font-medium text-neutral-200">{session.title}</p>
                  <p className="text-xs text-neutral-500">
                    {storylineData.beats.length} beats &middot; {storylineData.choices.length} choices
                  </p>
                </div>
                <section className="rounded-xl border border-white/10 bg-neutral-950/50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-200">
                      <ImageIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium text-neutral-100">{shareCoverTitle}</h3>
                      <p className="mt-1 text-xs leading-5 text-neutral-400">{shareCoverHelper}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void copyPrompt(publishMode === 'audio_story' ? 'audio' : 'social', socialCoverPrompt)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copiedPrompt === (publishMode === 'audio_story' ? 'audio' : 'social')
                        ? 'Copied'
                        : publishMode === 'audio_story'
                          ? 'Copy Audio Cover Prompt'
                          : 'Copy Social Cover Prompt'}
                    </button>
                    <button
                      type="button"
                      onClick={() => shareCoverInputRef.current?.click()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload Share Cover
                    </button>
                    <button
                      type="button"
                      onClick={() => void generateCover(publishMode === 'audio_story' ? 'audio' : 'social')}
                      disabled={Boolean(generatingCover)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {generatingCover === (publishMode === 'audio_story' ? 'audio' : 'social')
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <WandSparkles className="h-3.5 w-3.5" />}
                      {publishMode === 'audio_story'
                        ? `Generate Cover (${audioCoverCoinCost.toLocaleString()} coins)`
                        : `Generate Cover (${socialCoverCoinCost.toLocaleString()} coins)`}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyPrompt('youtube', youtubeThumbnailPrompt)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copiedPrompt === 'youtube' ? 'Copied' : 'Copy YouTube Prompt'}
                    </button>
                    <button
                      type="button"
                      onClick={() => youtubeInputRef.current?.click()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload YouTube Thumbnail
                    </button>
                    <button
                      type="button"
                      onClick={() => void generateCover('youtube')}
                      disabled={Boolean(generatingCover)}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {generatingCover === 'youtube'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <WandSparkles className="h-3.5 w-3.5" />}
                      Generate YouTube Thumbnail ({socialCoverCoinCost.toLocaleString()} coins)
                    </button>
                  </div>

                  {isVerticalStory && (
                    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium text-neutral-200">Reel Thumbnail</p>
                          <p className="mt-1 text-xs text-neutral-500">1080x1920, separate from the social OG image.</p>
                        </div>
                        {reelPreview && <Check className="h-4 w-4 text-emerald-300" />}
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => void copyPrompt('reel', reelThumbnailPrompt)}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copiedPrompt === 'reel' ? 'Copied' : 'Copy Reel Prompt'}
                        </button>
                        <button
                          type="button"
                          onClick={() => reelInputRef.current?.click()}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          Upload Reel Thumbnail
                        </button>
                        <button
                          type="button"
                          onClick={() => void generateCover('reel')}
                          disabled={Boolean(generatingCover)}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {generatingCover === 'reel'
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <WandSparkles className="h-3.5 w-3.5" />}
                          Generate Reel Thumbnail ({reelThumbnailCoinCost.toLocaleString()} coins)
                        </button>
                      </div>
                    </div>
                  )}

                  <input
                    ref={shareCoverInputRef}
                    type="file"
                    accept={ACCEPTED_COVER_IMAGE_TYPES.join(',')}
                    onChange={(event) => void handleCoverFileSelected(event, 'social')}
                    className="hidden"
                  />
                  <input
                    ref={youtubeInputRef}
                    type="file"
                    accept={ACCEPTED_COVER_IMAGE_TYPES.join(',')}
                    onChange={(event) => void handleCoverFileSelected(event, 'youtube')}
                    className="hidden"
                  />
                  <input
                    ref={reelInputRef}
                    type="file"
                    accept={ACCEPTED_COVER_IMAGE_TYPES.join(',')}
                    onChange={(event) => void handleCoverFileSelected(event, 'reel')}
                    className="hidden"
                  />

                  {activeSharePreview && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={activeSharePreview.dataUrl} alt="" className="aspect-video w-full object-cover" />
                      </div>
                      <div className="text-xs leading-5 text-neutral-400">
                        <p className="font-medium text-neutral-200">
                          {youtubePreview ? 'YouTube thumbnail selected' : 'Share cover selected'}
                        </p>
                        <p>{activeSharePreview.width}x{activeSharePreview.height}</p>
                        <p>{activeSharePreview.mimeType}</p>
                        {activeSharePreview.fileSize > 0 && (
                          <p>{(activeSharePreview.fileSize / (1024 * 1024)).toFixed(2)} MB</p>
                        )}
                        <p className="mt-1 text-emerald-300">
                          {youtubePreview
                            ? 'A 1200x630 share cover will be derived from this thumbnail.'
                            : 'This will be processed to 1200x630 for social previews.'}
                        </p>
                      </div>
                    </div>
                  )}

                  {reelPreview && (
                    <p className="mt-3 text-xs text-neutral-400">
                      Reel thumbnail ready: {reelPreview.width}x{reelPreview.height}.
                    </p>
                  )}

                  {coverError && (
                    <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                      {coverError}
                    </div>
                  )}

                  {!activeSharePreview && publishMode !== 'audio_story' && (
                    <p className="mt-4 text-xs leading-5 text-neutral-500">
                      {isPromptOnlyStory
                        ? 'If you publish without uploading or generating a cover, Kissago will use a branded default cover.'
                        : 'If you skip this, Kissago will process the best available beat image into a dedicated share cover.'}
                    </p>
                  )}
                </section>
                {!canPublish && (
                  <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                    <p className="text-sm text-amber-200">
                      {publishMode === 'audio_story' && !hasShareAsset
                        ? 'Audio story publishing needs a sharing cover. Upload a cover or generate one first.'
                        : 'Full storyline publishing needs an image on every beat. Upload the missing beat images first, or use audio-story publishing when it is enabled.'}
                    </p>
                  </div>
                )}
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={handleDialogClose}
                    className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePublish}
                    disabled={!canPublish || Boolean(generatingCover)}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-xl hover:bg-emerald-500/30 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    {publishLabel}
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

            {/* Error */}
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
