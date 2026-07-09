'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Check, Copy, ExternalLink, ImageIcon, Loader2, Upload, WandSparkles } from 'lucide-react';

import { generateDraftStoryCoverImage } from '@/app/actions/storyline-covers';
import { getImageUploadOptimizationSettings } from '@/app/actions/admin';
import type { StoryCoverPromptVariant } from '@/lib/story/cover-prompts';
import type { StorylineFormat, StorylineShareCoverSource } from '@/lib/types/database';
import type { ImageContinuityProviderState, ImageContinuityStrategy } from '@/lib/ai/image-continuity.shared';
import type { ImageModelSelection } from '@/lib/ai/image-models.shared';
import {
  blobToDataUrl,
  compressImageFile,
  formatFileSize,
} from '@/lib/media/clientImageCompression';
import {
  DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS,
  getAssetTypeCompressionEnabled,
  type ImageCompressionMetadata,
  type ImageUploadOptimizationSettings,
} from '@/lib/media/imageUploadOptimization';

export const ACCEPTED_COVER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const SOCIAL_COVER_MAX_BYTES = 5 * 1024 * 1024;
const YOUTUBE_THUMBNAIL_MAX_BYTES = 3 * 1024 * 1024;
const REEL_THUMBNAIL_MAX_BYTES = 3 * 1024 * 1024;
const ASPECT_RATIO_TOLERANCE = 0.02;

export type CoverAssetKind = 'social' | 'youtube' | 'reel';

export type CoverUploadPreview = {
  dataUrl: string;
  previewUrl: string;
  previewObjectUrl?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  width: number;
  height: number;
  source: 'uploaded' | 'custom_generated';
  originalFileSize?: number;
  optimizationMetadata?: ImageCompressionMetadata;
  optimizationWarning?: string;
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
  imageModelSelection?: ImageModelSelection | null;
  imageContinuity?: {
    requestedStrategy: ImageContinuityStrategy;
    previousState?: ImageContinuityProviderState | null;
  } | null;
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

function revokeCoverPreview(preview: CoverUploadPreview | null) {
  if (preview?.previewObjectUrl) {
    URL.revokeObjectURL(preview.previewObjectUrl);
  }
}

function buildCoverCompressionText(
  metadata: ImageCompressionMetadata | undefined,
  settings: ImageUploadOptimizationSettings
): string | null {
  if (!metadata || !settings.showCompressionStatsToUser) return null;
  if (!metadata.compressionApplied) {
    return metadata.skippedReason === 'already_optimized_webp' ? 'Image is already optimized.' : null;
  }
  return `Image optimized successfully. Original: ${formatFileSize(metadata.originalSizeBytes)}. Optimized: ${formatFileSize(metadata.optimizedSizeBytes)}.`;
}

function assertCoverUploadDimensions(kind: CoverAssetKind, width: number, height: number) {
  if (kind === 'youtube') {
    assertAspectRatio(width, height, 16 / 9, '16:9');
    if (width < 1280 || height < 720) throw new Error('YouTube thumbnails must be at least 1280x720.');
  } else if (kind === 'reel') {
    assertAspectRatio(width, height, 9 / 16, '9:16');
    if (width < 1080 || height < 1920) throw new Error('Reel thumbnails must be at least 1080x1920.');
  } else if (width < 600 || height < 315) {
    throw new Error('Share covers should be at least 600x315. 1200x630 is recommended.');
  }
}

async function validateCoverUpload(
  file: File,
  kind: CoverAssetKind,
  optimizationSettings: ImageUploadOptimizationSettings
): Promise<CoverUploadPreview> {
  if (!ACCEPTED_COVER_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_COVER_IMAGE_TYPES)[number])) {
    throw new Error('Use a JPG, PNG, or WebP image.');
  }

  const maxBytes = kind === 'social'
    ? SOCIAL_COVER_MAX_BYTES
    : kind === 'youtube'
      ? YOUTUBE_THUMBNAIL_MAX_BYTES
      : REEL_THUMBNAIL_MAX_BYTES;
  const compressionEnabled = getAssetTypeCompressionEnabled(
    kind === 'social' ? 'social_cover_image' : 'cover_image',
    optimizationSettings
  );
  if (!compressionEnabled && file.size > maxBytes) {
    throw new Error(`Image must be ${(maxBytes / (1024 * 1024)).toFixed(0)} MB or smaller.`);
  }

  if (!compressionEnabled) {
    const dataUrl = await readFileAsDataUrl(file);
    const { width, height } = await readImageDimensions(dataUrl);
    assertCoverUploadDimensions(kind, width, height);
    return {
      dataUrl,
      previewUrl: dataUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      width,
      height,
      source: 'uploaded',
    };
  }

  const result = await compressImageFile(file, {
    assetType: kind === 'social' ? 'social_cover_image' : 'cover_image',
    settings: optimizationSettings,
    orientation: kind === 'reel' ? 'portrait' : 'landscape',
  });
  const width = result.metadata.outputWidth;
  const height = result.metadata.outputHeight;
  try {
    assertCoverUploadDimensions(kind, width, height);
  } catch (error) {
    URL.revokeObjectURL(result.previewUrl);
    throw error;
  }
  const dataUrl = await blobToDataUrl(result.file);
  return {
    dataUrl,
    previewUrl: result.previewUrl,
    previewObjectUrl: result.previewUrl,
    fileName: result.file.name,
    fileSize: result.file.size,
    mimeType: result.file.type,
    width,
    height,
    source: 'uploaded',
    originalFileSize: file.size,
    optimizationMetadata: result.metadata,
    optimizationWarning: result.warningMessage ?? buildCoverCompressionText(result.metadata, optimizationSettings) ?? undefined,
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
  imageModelSelection = null,
  imageContinuity = null,
  onCancel,
  onSubmit,
}: StorylineCoverEditorFormProps) {
  const [shareCoverPreview, setShareCoverPreview] = useState<CoverUploadPreview | null>(null);
  const [youtubePreview, setYoutubePreview] = useState<CoverUploadPreview | null>(null);
  const [reelPreview, setReelPreview] = useState<CoverUploadPreview | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [isOptimizingCover, setIsOptimizingCover] = useState(false);
  const [optimizationSettings, setOptimizationSettings] = useState<ImageUploadOptimizationSettings>(
    DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS
  );
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
    ? hasPendingChanges && !submitBusy && !generatingCover && !isOptimizingCover
    : canSubmitBase && (storyFormat !== 'audio_story' || hasSelectedShareAsset) && !submitBusy && !generatingCover && !isOptimizingCover;
  const submitBlockedMessage = mode === 'manage'
    ? null
    : blockedMessage || (storyFormat === 'audio_story' && !hasSelectedShareAsset
      ? 'Audio story publishing needs a sharing cover. Upload a cover or generate one first.'
      : null);

  useEffect(() => {
    getImageUploadOptimizationSettings()
      .then(setOptimizationSettings)
      .catch(() => setOptimizationSettings(DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS));
  }, []);

  useEffect(() => () => revokeCoverPreview(shareCoverPreview), [shareCoverPreview]);
  useEffect(() => () => revokeCoverPreview(youtubePreview), [youtubePreview]);
  useEffect(() => () => revokeCoverPreview(reelPreview), [reelPreview]);

  const handleCoverFileSelected = async (
    event: ChangeEvent<HTMLInputElement>,
    kind: CoverAssetKind
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setCoverError(null);
    setIsOptimizingCover(true);
    try {
      const preview = await validateCoverUpload(file, kind, optimizationSettings);
      if (kind === 'youtube') {
        setYoutubePreview((prev) => {
          revokeCoverPreview(prev);
          return preview;
        });
        setShareCoverPreview((prev) => {
          revokeCoverPreview(prev);
          return null;
        });
      } else if (kind === 'reel') {
        setReelPreview((prev) => {
          revokeCoverPreview(prev);
          return preview;
        });
      } else {
        setShareCoverPreview((prev) => {
          revokeCoverPreview(prev);
          return preview;
        });
        setYoutubePreview((prev) => {
          revokeCoverPreview(prev);
          return null;
        });
      }
    } catch (error: any) {
      setCoverError(error?.message || 'Could not validate the selected image.');
    } finally {
      setIsOptimizingCover(false);
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
        imageModelSelection,
        imageContinuity,
      });
      const { width, height } = await readImageDimensions(result.dataUrl);
      const preview: CoverUploadPreview = {
        dataUrl: result.dataUrl,
        previewUrl: result.dataUrl,
        fileName: `${variant}-cover.webp`,
        fileSize: 0,
        mimeType: 'image/webp',
        width,
        height,
        source: 'custom_generated',
      };

      if (variant === 'youtube') {
        setYoutubePreview((prev) => {
          revokeCoverPreview(prev);
          return preview;
        });
        setShareCoverPreview((prev) => {
          revokeCoverPreview(prev);
          return null;
        });
      } else if (variant === 'reel') {
        setReelPreview((prev) => {
          revokeCoverPreview(prev);
          return preview;
        });
      } else {
        setShareCoverPreview((prev) => {
          revokeCoverPreview(prev);
          return preview;
        });
        setYoutubePreview((prev) => {
          revokeCoverPreview(prev);
          return null;
        });
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
              disabled={isOptimizingCover}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
            >
              {isOptimizingCover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {isOptimizingCover ? 'Optimizing...' : 'Upload Share Cover'}
            </button>
            <button
              type="button"
              onClick={() => void generateCover(primaryCoverVariant)}
              disabled={Boolean(generatingCover) || submitBusy || isOptimizingCover}
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
              disabled={isOptimizingCover}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
            >
              {isOptimizingCover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {isOptimizingCover ? 'Optimizing...' : 'Upload YouTube Thumbnail'}
            </button>
            <button
              type="button"
              onClick={() => void generateCover('youtube')}
              disabled={Boolean(generatingCover) || submitBusy || isOptimizingCover}
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
                disabled={isOptimizingCover}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-neutral-200 transition-colors hover:bg-white/10"
              >
                {isOptimizingCover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {isOptimizingCover ? 'Optimizing...' : 'Upload Reel Thumbnail'}
              </button>
              <button
                type="button"
                onClick={() => void generateCover('reel')}
                disabled={Boolean(generatingCover) || submitBusy || isOptimizingCover}
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

        {isOptimizingCover && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
            <Loader2 className="h-4 w-4 animate-spin" />
            Optimizing image for faster upload...
          </div>
        )}

        {activeSharePreview && (
          <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={activeSharePreview.previewUrl} alt="" className="aspect-video w-full object-cover" />
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
              {activeSharePreview.originalFileSize && activeSharePreview.originalFileSize !== activeSharePreview.fileSize && (
                <p>Original: {formatFileSize(activeSharePreview.originalFileSize)}</p>
              )}
              {activeSharePreview.optimizationWarning && (
                <p className="mt-1 text-emerald-300">{activeSharePreview.optimizationWarning}</p>
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
