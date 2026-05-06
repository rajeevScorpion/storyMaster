'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { Check, Copy, ExternalLink, ImageIcon, Loader2, Upload, WandSparkles } from 'lucide-react';

import { generateDraftStoryCoverImage } from '@/app/actions/storyline-covers';
import type { StoryCoverPromptVariant } from '@/lib/story/cover-prompts';
import type { StorylineFormat, StorylineShareCoverSource } from '@/lib/types/database';

export const ACCEPTED_COVER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const SOCIAL_COVER_MAX_BYTES = 5 * 1024 * 1024;
const YOUTUBE_THUMBNAIL_MAX_BYTES = 3 * 1024 * 1024;
const REEL_THUMBNAIL_MAX_BYTES = 3 * 1024 * 1024;
const ASPECT_RATIO_TOLERANCE = 0.02;

export type CoverAssetKind = 'social' | 'youtube' | 'reel';

export type CoverUploadPreview = {
  dataUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  width: number;
  height: number;
  source: 'uploaded' | 'custom_generated';
};

export type PersistedStorylineCoverAsset = {
  url: string;
  label: string;
  description: string;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
  updatedAt?: string | null;
};

export type StorylineCoverEditorPersistedAssets = {
  shareCover: PersistedStorylineCoverAsset | null;
  youtubeThumbnail: PersistedStorylineCoverAsset | null;
  reelThumbnail: PersistedStorylineCoverAsset | null;
};

export type StorylineCoverEditorSubmission = {
  shareCoverDataUrl: string | null;
  youtubeThumbnailDataUrl: string | null;
  reelThumbnailDataUrl: string | null;
  shareCoverSource: StorylineShareCoverSource | null;
  youtubeThumbnailSource: StorylineShareCoverSource | null;
  reelThumbnailSource: StorylineShareCoverSource | null;
  socialCoverPrompt: string | null;
  youtubeThumbnailPrompt: string | null;
  reelThumbnailPrompt: string | null;
  audioCoverPrompt: string | null;
};

interface StorylineCoverEditorFormProps {
  mode: 'publish' | 'manage';
  storyId?: string | null;
  storylineId?: string | null;
  title?: string | null;
  detailText?: string | null;
  introText?: string | null;
  storyFormat: StorylineFormat;
  isVerticalStory: boolean;
  socialCoverPrompt: string;
  youtubeThumbnailPrompt: string;
  reelThumbnailPrompt: string;
  audioCoverPrompt?: string | null;
  socialCoverCoinCost: number;
  audioCoverCoinCost: number;
  reelThumbnailCoinCost: number;
  sectionTitle: string;
  helperText: string;
  submitLabel: string;
  canSubmitBase?: boolean;
  blockedMessage?: string | null;
  emptyHint?: string | null;
  submitBusy?: boolean;
  persistedAssets?: StorylineCoverEditorPersistedAssets | null;
  onCancel: () => void;
  onSubmit: (submission: StorylineCoverEditorSubmission) => Promise<void> | void;
}

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

function formatAssetDimensions(asset: { width?: number | null; height?: number | null }): string | null {
  if (!asset.width || !asset.height) return null;
  return `${asset.width}x${asset.height}`;
}

function formatAssetTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function AssetCard({ asset }: { asset: PersistedStorylineCoverAsset }) {
  const dimensions = formatAssetDimensions(asset);
  const updatedAt = formatAssetTimestamp(asset.updatedAt);

  return (
    <a
      href={asset.url}
      target="_blank"
      rel="noreferrer"
      className="overflow-hidden rounded-xl border border-white/10 bg-black/20 transition-colors hover:border-white/20 hover:bg-black/30"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.url} alt="" className="aspect-video w-full object-cover" />
      <div className="space-y-1.5 p-3 text-xs leading-5 text-neutral-400">
        <p className="font-medium text-neutral-200">{asset.label}</p>
        <p>{asset.description}</p>
        {dimensions && <p>{dimensions}</p>}
        {asset.mimeType && <p>{asset.mimeType}</p>}
        {updatedAt && <p>Updated {updatedAt}</p>}
        <p className="inline-flex items-center gap-1 text-emerald-300">
          <ExternalLink className="h-3.5 w-3.5" />
          Open asset
        </p>
      </div>
    </a>
  );
}

export default function StorylineCoverEditorForm({
  mode,
  storyId = null,
  storylineId = null,
  title = null,
  detailText = null,
  introText = null,
  storyFormat,
  isVerticalStory,
  socialCoverPrompt,
  youtubeThumbnailPrompt,
  reelThumbnailPrompt,
  audioCoverPrompt = null,
  socialCoverCoinCost,
  audioCoverCoinCost,
  reelThumbnailCoinCost,
  sectionTitle,
  helperText,
  submitLabel,
  canSubmitBase = true,
  blockedMessage = null,
  emptyHint = null,
  submitBusy = false,
  persistedAssets = null,
  onCancel,
  onSubmit,
}: StorylineCoverEditorFormProps) {
  const [shareCoverPreview, setShareCoverPreview] = useState<CoverUploadPreview | null>(null);
  const [youtubePreview, setYoutubePreview] = useState<CoverUploadPreview | null>(null);
  const [reelPreview, setReelPreview] = useState<CoverUploadPreview | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [generatingCover, setGeneratingCover] = useState<StoryCoverPromptVariant | null>(null);
  const shareCoverInputRef = useRef<HTMLInputElement>(null);
  const youtubeInputRef = useRef<HTMLInputElement>(null);
  const reelInputRef = useRef<HTMLInputElement>(null);

  const primaryCoverVariant: StoryCoverPromptVariant = storyFormat === 'audio_story' ? 'audio' : 'social';
  const primaryCoverPrompt = storyFormat === 'audio_story'
    ? (audioCoverPrompt || socialCoverPrompt)
    : socialCoverPrompt;
  const activeSharePreview = youtubePreview ?? shareCoverPreview;
  const hasSelectedShareAsset = Boolean(shareCoverPreview || youtubePreview);
  const hasPendingChanges = Boolean(shareCoverPreview || youtubePreview || reelPreview);
  const canSubmit = mode === 'manage'
    ? hasPendingChanges && !submitBusy && !generatingCover
    : canSubmitBase && (storyFormat !== 'audio_story' || hasSelectedShareAsset) && !submitBusy && !generatingCover;
  const submitBlockedMessage = mode === 'manage'
    ? null
    : blockedMessage || (storyFormat === 'audio_story' && !hasSelectedShareAsset
      ? 'Audio story publishing needs a sharing cover. Upload a cover or generate one first.'
      : null);

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

  const copyPrompt = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPrompt(key);
      window.setTimeout(() => setCopiedPrompt(null), 1600);
    } catch {
      setCoverError('Could not copy the prompt.');
    }
  };

  const generateCover = async (variant: StoryCoverPromptVariant) => {
    const kind = variant === 'audio'
      ? 'audio'
      : variant === 'reel'
        ? 'reel'
        : variant === 'youtube'
          ? 'youtube'
          : 'social';
    const prompt = variant === 'audio'
      ? (audioCoverPrompt || socialCoverPrompt)
      : variant === 'youtube'
        ? youtubeThumbnailPrompt
        : variant === 'reel'
          ? reelThumbnailPrompt
          : socialCoverPrompt;

    setGeneratingCover(variant);
    setCoverError(null);
    try {
      const result = await generateDraftStoryCoverImage({
        storyId,
        storylineId,
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

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit({
      shareCoverDataUrl: shareCoverPreview?.dataUrl ?? null,
      youtubeThumbnailDataUrl: youtubePreview?.dataUrl ?? null,
      reelThumbnailDataUrl: reelPreview?.dataUrl ?? null,
      shareCoverSource: shareCoverPreview?.source ?? null,
      youtubeThumbnailSource: youtubePreview?.source ?? null,
      reelThumbnailSource: reelPreview?.source ?? null,
      socialCoverPrompt,
      youtubeThumbnailPrompt,
      reelThumbnailPrompt: isVerticalStory ? reelThumbnailPrompt : null,
      audioCoverPrompt: storyFormat === 'audio_story' ? (audioCoverPrompt || socialCoverPrompt) : null,
    });
  };

  const persistedCards = [
    persistedAssets?.shareCover,
    persistedAssets?.youtubeThumbnail,
    isVerticalStory ? persistedAssets?.reelThumbnail : null,
  ].filter(Boolean) as PersistedStorylineCoverAsset[];

  return (
    <div className="space-y-4">
      {introText && (
        <p className="text-sm text-neutral-400">
          {introText}
        </p>
      )}

      {(title || detailText) && (
        <div className="space-y-1 rounded-xl bg-white/5 p-3">
          {title && <p className="text-sm font-medium text-neutral-200">{title}</p>}
          {detailText && <p className="text-xs text-neutral-500">{detailText}</p>}
        </div>
      )}

      <section className="rounded-xl border border-white/10 bg-neutral-950/50 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-200">
            <ImageIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-neutral-100">{sectionTitle}</h3>
            <p className="mt-1 text-xs leading-5 text-neutral-400">{helperText}</p>
          </div>
        </div>

        {mode === 'manage' && (
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
              Current Published Assets
            </p>
            {persistedCards.length > 0 ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {persistedCards.map((asset) => (
                  <AssetCard key={`${asset.label}:${asset.url}`} asset={asset} />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-neutral-500">
                This storyline does not have any saved cover assets yet. New uploads will update it in place.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500">
              {storyFormat === 'audio_story' ? 'Sharing Cover' : 'Social Cover'}
            </p>
            <button
              type="button"
              onClick={() => void copyPrompt(primaryCoverVariant, primaryCoverPrompt)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
            >
              <Copy className="h-3.5 w-3.5" />
              {copiedPrompt === primaryCoverVariant
                ? 'Copied'
                : storyFormat === 'audio_story'
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
              onClick={() => void generateCover(primaryCoverVariant)}
              disabled={Boolean(generatingCover) || submitBusy}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generatingCover === primaryCoverVariant
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <WandSparkles className="h-3.5 w-3.5" />}
              {storyFormat === 'audio_story'
                ? `Generate Cover (${audioCoverCoinCost.toLocaleString()} coins)`
                : `Generate Cover (${socialCoverCoinCost.toLocaleString()} coins)`}
            </button>
          </div>

          <div className="grid gap-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-500">
              YouTube Thumbnail
            </p>
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
              disabled={Boolean(generatingCover) || submitBusy}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generatingCover === 'youtube'
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <WandSparkles className="h-3.5 w-3.5" />}
              Generate YouTube Thumbnail ({socialCoverCoinCost.toLocaleString()} coins)
            </button>
          </div>
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
                disabled={Boolean(generatingCover) || submitBusy}
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
                  ? 'Saving this will also refresh the social share cover.'
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

        {!activeSharePreview && emptyHint && (
          <p className="mt-4 text-xs leading-5 text-neutral-500">
            {emptyHint}
          </p>
        )}
      </section>

      {submitBlockedMessage && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-200">
            {submitBlockedMessage}
          </p>
        </div>
      )}

      <div className="flex gap-3 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-xl hover:bg-emerald-500/30 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'manage' ? <Check className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
