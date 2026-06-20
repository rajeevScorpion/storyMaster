'use client';

import Link from 'next/link';
import { type ComponentType, useEffect, useState } from 'react';
import {
  BookOpenText,
  Brush,
  Clapperboard,
  Clock3,
  FileText,
  ImageIcon,
  Loader2,
  Mic2,
  RefreshCcw,
  UserRound,
  Video,
  WandSparkles,
} from 'lucide-react';
import {
  getGlobalSettings,
  saveAdminNarrationVoiceSettings,
  setCycleOverride,
  setCycleMs,
  setStoryboardVignette,
  setStoryboardVignetteAmountPercent,
  setStoryboardImageSize,
  setStoryboardWebpCompression,
  setStoryboardWebpQualityPercent,
  setStoryboardClientProcessing,
  setStoryLoadingNodeLabels,
  setStoryLoadingHintTypewriter,
  setStoryLoadingReaderAnticipationMs,
  setStoryLoadingReaderStoryText,
  setStoryLoadingReaderOptions,
  setStoryLoadingReaderScrollSpeed,
  setStoryUiTextLineCount,
  setStoryTextOverlayWordsPerLine,
  setStoryUiAutoScroll,
  setStorylineChoiceFlashEnabled,
  setStorylineChoiceFlashMs,
  setTextTimeout,
  setImageTimeout,
  setTtsTimeout,
  setCloudSaveTimeout,
  setStoryAssetSignedUrlSwap,
  setClientStoryPersistenceEnabled,
  setStoryIncrementalAssetSync,
  setStoryAssetUploadPauseDuringGeneration,
  setStoryAssetSyncWarningTimeout,
  setAuthoringWordCap,
  setPreviewSeedPlanPriceCoins,
  setFreePlusCharacterSheets,
  setCreatorCharacterSheets,
  setStoryPromptOnlyModeEnabled,
  setVerticalStoriesSettingEnabled,
  setAudioStorylinePublishEnabled,
  setPromptOnlyMaxImagesPerBeat,
  setPromptOnlyImageGalleryCleanupEnabled,
  setPromptOnlyImageGalleryCleanupDays,
  setVideoDownload,
  setVideoDownloadAdminBypass,
  saveImageUploadOptimizationSettings,
  saveMediaStorageSettings,
} from '@/app/actions/admin';
import { generateNarrationVoiceSamples, getNarrationVoiceSampleStatusesForAdmin } from '@/app/actions/narration';
import {
  normalizeNarrationVoiceList,
  voicesToMultilineText,
  type NarrationVoiceSampleClientStatus,
  type NarrationVoiceSettings,
} from '@/lib/ai/narration-voices';
import {
  MAX_STORY_UI_TEXT_LINE_COUNT,
  MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
  MIN_STORY_UI_TEXT_LINE_COUNT,
  MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE,
  type StoryboardImageSize,
} from '@/lib/types/storyboard-settings';
import {
  DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS,
  type ImageUploadOptimizationSettings,
} from '@/lib/media/imageUploadOptimization';
import {
  DEFAULT_MEDIA_STORAGE_SETTINGS,
  type MediaStorageAdminState,
  type MediaStorageSettings,
} from '@/lib/media/storage-settings';

export type GlobalSettingsSection =
  | 'overview'
  | 'storyboard'
  | 'reels'
  | 'reader'
  | 'narration'
  | 'authoring'
  | 'characters'
  | 'media'
  | 'video-export'
  | 'generation'
  | 'pages';

type GlobalSettingsSubsection = Exclude<GlobalSettingsSection, 'overview'>;

type GlobalSettingsLink = {
  section: GlobalSettingsSection;
  label: string;
  href: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
};

const GLOBAL_SETTINGS_LINKS: GlobalSettingsLink[] = [
  {
    section: 'overview',
    label: 'Settings overview',
    href: '/admin/settings',
    description: 'Review the global runtime controls and jump into focused settings pages.',
    icon: WandSparkles,
  },
  {
    section: 'storyboard',
    label: 'Storyboard',
    href: '/admin/settings/storyboard',
    description: 'Image output, panel timing, WebP processing, layout, and vignette controls.',
    icon: Brush,
  },
  {
    section: 'reels',
    label: 'Reel Story',
    href: '/admin/settings/reels',
    description: 'Short-form reel defaults, prompt definers, retention windows, and manual cleanup.',
    icon: Clapperboard,
  },
  {
    section: 'reader',
    label: 'Reader and loader',
    href: '/admin/settings/reader',
    description: 'Story text display, auto-scroll, loading labels, and generated text reveal behavior.',
    icon: BookOpenText,
  },
  {
    section: 'narration',
    label: 'Narration voices',
    href: '/admin/settings/narration',
    description: 'User-led voice selection, curated voice lists, sample text, and sample generation status.',
    icon: Mic2,
  },
  {
    section: 'authoring',
    label: 'Authoring',
    href: '/admin/settings/authoring',
    description: 'Prompt/seed authoring limits and seed preview pricing.',
    icon: FileText,
  },
  {
    section: 'characters',
    label: 'Character references',
    href: '/admin/settings/characters',
    description: 'Character sheet availability for Free, Plus, and Creator workflows.',
    icon: UserRound,
  },
  {
    section: 'media',
    label: 'Image uploads',
    href: '/admin/settings/media',
    description: 'Client-side upload compression, raw limits, optimized size limits, and rollback controls.',
    icon: ImageIcon,
  },
  {
    section: 'video-export',
    label: 'Video export',
    href: '/admin/settings/video-export',
    description: 'Global video download availability and admin-only bypass for testing.',
    icon: Video,
  },
  {
    section: 'generation',
    label: 'Generation timeouts',
    href: '/admin/settings/generation',
    description: 'Gemini text, image, TTS, and cloud-save timeout guards.',
    icon: Clock3,
  },
  {
    section: 'pages',
    label: 'Pages',
    href: '/admin/settings/pages',
    description: 'Rollout legal, support, blog, docs, FAQ, and footer controls.',
    icon: FileText,
  },
];

const GLOBAL_SETTINGS_SECTION_LINKS = GLOBAL_SETTINGS_LINKS.filter(
  (item): item is GlobalSettingsLink & { section: GlobalSettingsSubsection } => item.section !== 'overview'
);

function ToggleRow({
  label,
  description,
  checked,
  onToggle,
  toggling,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
  toggling: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-900/60 p-4">
      <div>
        <p className="text-sm font-medium text-neutral-100">{label}</p>
        <p className="mt-0.5 text-xs text-neutral-400">{description}</p>
      </div>
      <button
        onClick={onToggle}
        disabled={toggling}
        className={`relative ml-6 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-neutral-600'}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function formatSampleTimestamp(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

function sampleStatusClassName(status: NarrationVoiceSampleClientStatus['status']): string {
  if (status === 'ready') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'failed') return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  if (status === 'generating') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-white/10 bg-neutral-800 text-neutral-400';
}

function formatToggleSummary(enabled: boolean): string {
  return enabled ? 'Enabled' : 'Disabled';
}

function OverviewLinkCard({
  href,
  label,
  description,
  summary,
  icon: Icon,
}: {
  href: string;
  label: string;
  description: string;
  summary: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-white/10 bg-neutral-900/60 p-4 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/10"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-emerald-500/10 p-2 text-emerald-300">
            <Icon size={16} />
          </span>
          <span className="text-sm font-medium text-neutral-100 group-hover:text-emerald-200">{label}</span>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
          Open
        </span>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-neutral-400">{description}</p>
      <p className="mt-4 text-xs text-emerald-300/80">{summary}</p>
    </Link>
  );
}

export default function GlobalSettings({ section = 'overview' }: { section?: GlobalSettingsSection }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cycleOverride, setCycleOverrideState] = useState(false);
  const [cycleOverrideToggling, setCycleOverrideToggling] = useState(false);
  const [cycleMs, setCycleMsState] = useState(5000);
  const [cycleMsInput, setCycleMsInput] = useState('5000');
  const [cycleMsSaving, setCycleMsSaving] = useState(false);
  const [vignetteEnabled, setVignetteEnabled] = useState(true);
  const [vignetteToggling, setVignetteToggling] = useState(false);
  const [vignetteAmountPercent, setVignetteAmountPercent] = useState(100);
  const [vignetteAmountInput, setVignetteAmountInput] = useState('100');
  const [vignetteAmountSaving, setVignetteAmountSaving] = useState(false);
  const [storyboardImageSize, setStoryboardImageSizeState] = useState<StoryboardImageSize>('1K');
  const [storyboardImageSizeSaving, setStoryboardImageSizeSaving] = useState(false);
  const [storyboardWebpCompressionEnabled, setStoryboardWebpCompressionEnabledState] = useState(false);
  const [storyboardWebpCompressionToggling, setStoryboardWebpCompressionToggling] = useState(false);
  const [storyboardWebpQualityPercent, setStoryboardWebpQualityPercentState] = useState(85);
  const [storyboardWebpQualityInput, setStoryboardWebpQualityInput] = useState('85');
  const [storyboardWebpQualitySaving, setStoryboardWebpQualitySaving] = useState(false);
  const [storyboardClientProcessingEnabled, setStoryboardClientProcessingEnabledState] = useState(false);
  const [storyboardClientProcessingToggling, setStoryboardClientProcessingToggling] = useState(false);
  const [storyboardLayoutMode, setStoryboardLayoutModeState] = useState<'2x2'>('2x2');
  const [loadingNodeLabelsEnabled, setLoadingNodeLabelsEnabledState] = useState(true);
  const [loadingNodeLabelsToggling, setLoadingNodeLabelsToggling] = useState(false);
  const [loadingHintTypewriterEnabled, setLoadingHintTypewriterEnabledState] = useState(false);
  const [loadingHintTypewriterToggling, setLoadingHintTypewriterToggling] = useState(false);
  const [loadingReaderAnticipationMs, setLoadingReaderAnticipationMsState] = useState(10000);
  const [loadingReaderAnticipationInput, setLoadingReaderAnticipationInput] = useState('10');
  const [loadingReaderAnticipationSaving, setLoadingReaderAnticipationSaving] = useState(false);
  const [loadingReaderStoryTextEnabled, setLoadingReaderStoryTextEnabledState] = useState(true);
  const [loadingReaderStoryTextToggling, setLoadingReaderStoryTextToggling] = useState(false);
  const [loadingReaderOptionsEnabled, setLoadingReaderOptionsEnabledState] = useState(true);
  const [loadingReaderOptionsToggling, setLoadingReaderOptionsToggling] = useState(false);
  const [loadingReaderScrollSpeedPxPerSecond, setLoadingReaderScrollSpeedPxPerSecondState] = useState(24);
  const [loadingReaderScrollSpeedInput, setLoadingReaderScrollSpeedInput] = useState('24');
  const [loadingReaderScrollSpeedSaving, setLoadingReaderScrollSpeedSaving] = useState(false);
  const [storyUiTextLineCount, setStoryUiTextLineCountState] = useState(7);
  const [storyUiTextLineCountInput, setStoryUiTextLineCountInput] = useState('7');
  const [storyUiTextLineCountSaving, setStoryUiTextLineCountSaving] = useState(false);
  const [storyTextOverlayWordsPerLine, setStoryTextOverlayWordsPerLineState] = useState(7);
  const [storyTextOverlayWordsPerLineInput, setStoryTextOverlayWordsPerLineInput] = useState('7');
  const [storyTextOverlayWordsPerLineSaving, setStoryTextOverlayWordsPerLineSaving] = useState(false);
  const [storyUiAutoScrollEnabled, setStoryUiAutoScrollEnabledState] = useState(true);
  const [storyUiAutoScrollToggling, setStoryUiAutoScrollToggling] = useState(false);
  const [clientStoryPersistenceEnabled, setClientStoryPersistenceEnabledState] = useState(false);
  const [clientStoryPersistenceToggling, setClientStoryPersistenceToggling] = useState(false);
  const [storylineChoiceFlashEnabled, setStorylineChoiceFlashEnabledState] = useState(true);
  const [storylineChoiceFlashToggling, setStorylineChoiceFlashToggling] = useState(false);
  const [storylineChoiceFlashMs, setStorylineChoiceFlashMsState] = useState(3000);
  const [storylineChoiceFlashInput, setStorylineChoiceFlashInput] = useState('3');
  const [storylineChoiceFlashSaving, setStorylineChoiceFlashSaving] = useState(false);
  const [freePlusCharacterSheetsEnabled, setFreePlusCharacterSheetsEnabledState] = useState(false);
  const [freePlusCharacterSheetsToggling, setFreePlusCharacterSheetsToggling] = useState(false);
  const [creatorCharacterSheetsEnabled, setCreatorCharacterSheetsEnabledState] = useState(false);
  const [creatorCharacterSheetsToggling, setCreatorCharacterSheetsToggling] = useState(false);
  const [storyPromptOnlyModeEnabled, setStoryPromptOnlyModeEnabledState] = useState(false);
  const [storyPromptOnlyModeToggling, setStoryPromptOnlyModeToggling] = useState(false);
  const [verticalStoriesSettingEnabled, setVerticalStoriesSettingEnabledState] = useState(false);
  const [verticalStoriesSettingToggling, setVerticalStoriesSettingToggling] = useState(false);
  const [audioStorylinePublishEnabled, setAudioStorylinePublishEnabledState] = useState(false);
  const [audioStorylinePublishToggling, setAudioStorylinePublishToggling] = useState(false);
  const [promptOnlyMaxImagesPerBeat, setPromptOnlyMaxImagesPerBeatState] = useState(3);
  const [promptOnlyMaxImagesInput, setPromptOnlyMaxImagesInput] = useState('3');
  const [promptOnlyMaxImagesSaving, setPromptOnlyMaxImagesSaving] = useState(false);
  const [promptOnlyGalleryCleanupEnabled, setPromptOnlyGalleryCleanupEnabledState] = useState(true);
  const [promptOnlyGalleryCleanupToggling, setPromptOnlyGalleryCleanupToggling] = useState(false);
  const [promptOnlyGalleryCleanupDays, setPromptOnlyGalleryCleanupDaysState] = useState(7);
  const [promptOnlyGalleryCleanupDaysInput, setPromptOnlyGalleryCleanupDaysInput] = useState('7');
  const [promptOnlyGalleryCleanupDaysSaving, setPromptOnlyGalleryCleanupDaysSaving] = useState(false);
  const [videoDownloadEnabled, setVideoDownloadEnabledState] = useState(false);
  const [videoDownloadToggling, setVideoDownloadToggling] = useState(false);
  const [videoDownloadAdminBypass, setVideoDownloadAdminBypassState] = useState(false);
  const [videoDownloadAdminBypassToggling, setVideoDownloadAdminBypassToggling] = useState(false);
  const [textTimeoutMs, setTextTimeoutMs] = useState(30000);
  const [textTimeoutInput, setTextTimeoutInput] = useState('30');
  const [textTimeoutSaving, setTextTimeoutSaving] = useState(false);
  const [imageTimeoutMs, setImageTimeoutMs] = useState(90000);
  const [imageTimeoutInput, setImageTimeoutInput] = useState('90');
  const [imageTimeoutSaving, setImageTimeoutSaving] = useState(false);
  const [ttsTimeoutMs, setTtsTimeoutMs] = useState(120000);
  const [ttsTimeoutInput, setTtsTimeoutInput] = useState('120');
  const [ttsTimeoutSaving, setTtsTimeoutSaving] = useState(false);
  const [cloudSaveTimeoutMs, setCloudSaveTimeoutMs] = useState(20000);
  const [cloudSaveTimeoutInput, setCloudSaveTimeoutInput] = useState('20');
  const [cloudSaveTimeoutSaving, setCloudSaveTimeoutSaving] = useState(false);
  const [storyAssetSignedUrlSwapEnabled, setStoryAssetSignedUrlSwapEnabledState] = useState(false);
  const [storyAssetSignedUrlSwapToggling, setStoryAssetSignedUrlSwapToggling] = useState(false);
  const [storyIncrementalAssetSyncEnabled, setStoryIncrementalAssetSyncEnabledState] = useState(false);
  const [storyIncrementalAssetSyncToggling, setStoryIncrementalAssetSyncToggling] = useState(false);
  const [storyAssetUploadPauseDuringGenerationEnabled, setStoryAssetUploadPauseDuringGenerationEnabledState] = useState(false);
  const [storyAssetUploadPauseDuringGenerationToggling, setStoryAssetUploadPauseDuringGenerationToggling] = useState(false);
  const [storyAssetSyncWarningTimeoutMs, setStoryAssetSyncWarningTimeoutMs] = useState(15000);
  const [storyAssetSyncWarningTimeoutInput, setStoryAssetSyncWarningTimeoutInput] = useState('15');
  const [storyAssetSyncWarningTimeoutSaving, setStoryAssetSyncWarningTimeoutSaving] = useState(false);
  const [authoringWordCap, setAuthoringWordCapState] = useState(500);
  const [authoringWordCapInput, setAuthoringWordCapInput] = useState('500');
  const [authoringWordCapSaving, setAuthoringWordCapSaving] = useState(false);
  const [previewSeedPlanPriceCoins, setPreviewSeedPlanPriceCoinsState] = useState(0);
  const [previewSeedPlanPriceCoinsInput, setPreviewSeedPlanPriceCoinsInput] = useState('0');
  const [previewSeedPlanPriceCoinsSaving, setPreviewSeedPlanPriceCoinsSaving] = useState(false);
  const [narrationVoiceSettings, setNarrationVoiceSettingsState] = useState<NarrationVoiceSettings | null>(null);
  const [narrationMaleVoiceInput, setNarrationMaleVoiceInput] = useState('');
  const [narrationFemaleVoiceInput, setNarrationFemaleVoiceInput] = useState('');
  const [narrationDefaultMaleVoice, setNarrationDefaultMaleVoice] = useState('');
  const [narrationDefaultFemaleVoice, setNarrationDefaultFemaleVoice] = useState('');
  const [narrationSampleEnglish, setNarrationSampleEnglish] = useState('');
  const [narrationSampleHindi, setNarrationSampleHindi] = useState('');
  const [narrationVoiceSampleStatuses, setNarrationVoiceSampleStatuses] = useState<NarrationVoiceSampleClientStatus[]>([]);
  const [narrationVoiceSaving, setNarrationVoiceSaving] = useState(false);
  const [narrationVoiceGenerating, setNarrationVoiceGenerating] = useState(false);
  const [narrationVoiceWarnings, setNarrationVoiceWarnings] = useState<string[]>([]);
  const [imageUploadSettings, setImageUploadSettings] = useState<ImageUploadOptimizationSettings>(
    DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS
  );
  const [imageUploadDraft, setImageUploadDraft] = useState<ImageUploadOptimizationSettings>(
    DEFAULT_IMAGE_UPLOAD_OPTIMIZATION_SETTINGS
  );
  const [imageUploadSaving, setImageUploadSaving] = useState(false);
  const [imageUploadMessage, setImageUploadMessage] = useState<string | null>(null);
  const [mediaStorage, setMediaStorage] = useState<MediaStorageAdminState>({
    settings: DEFAULT_MEDIA_STORAGE_SETTINGS,
    envStatus: {
      accountIdPresent: false,
      accessKeyPresent: false,
      secretKeyPresent: false,
      bucketNamePresent: false,
      privateBucketNamePresent: false,
      publicBaseUrlPresent: false,
      endpointPresent: false,
      environment: null,
      productionEnabled: false,
      effectiveEnabled: false,
      missing: [],
    },
  });
  const [mediaStorageDraft, setMediaStorageDraft] = useState<MediaStorageSettings>(DEFAULT_MEDIA_STORAGE_SETTINGS);
  const [mediaStorageSaving, setMediaStorageSaving] = useState(false);
  const [mediaStorageMessage, setMediaStorageMessage] = useState<string | null>(null);

  useEffect(() => {
    getGlobalSettings()
      .then(({
        cycleOverride: co,
        cycleMs: cm,
        vignetteEnabled: ve,
        vignetteAmountPercent: vap,
        storyboardImageSize: imageSize,
        storyboardWebpCompressionEnabled: webpCompressionEnabled,
        storyboardWebpQualityPercent: webpQualityPercent,
        storyboardClientProcessingEnabled: clientProcessingEnabled,
        storyboardLayoutMode: layoutMode,
        loadingNodeLabelsEnabled: labelsEnabled,
        loadingHintTypewriterEnabled: typewriterEnabled,
        loadingReaderAnticipationMs: readerAnticipationMs,
        loadingReaderStoryTextEnabled: readerStoryTextEnabled,
        loadingReaderOptionsEnabled: readerOptionsEnabled,
        loadingReaderScrollSpeedPxPerSecond: readerScrollSpeed,
        storyUiTextLineCount: uiTextLineCount,
        storyUiAutoScrollEnabled: uiAutoScrollEnabled,
        storyTextOverlayWordsPerLine: overlayWordsPerLine,
        clientStoryPersistenceEnabled: persistenceEnabled,
        storylineChoiceFlashEnabled: choiceFlashEnabled,
        storylineChoiceFlashMs: choiceFlashMs,
        freePlusCharacterSheetsEnabled: fpSheets,
        creatorCharacterSheetsEnabled: creatorSheets,
        storyPromptOnlyModeEnabled: promptOnlyModeEnabled,
        verticalStoriesSettingEnabled: verticalStoriesEnabled,
        audioStorylinePublishEnabled: audioPublishEnabled,
        promptOnlyMaxImagesPerBeat: promptOnlyMaxImages,
        promptOnlyImageGalleryCleanupEnabled: promptOnlyCleanupEnabled,
        promptOnlyImageGalleryCleanupDays: promptOnlyCleanupDays,
        videoDownloadEnabled: vidDl,
        videoDownloadAdminBypass: vidDlBypass,
        textTimeoutMs: tt,
        imageTimeoutMs: it,
        ttsTimeoutMs: at,
        cloudSaveTimeoutMs: st,
        storyAssetSignedUrlSwapEnabled: assetSwapEnabled,
        storyIncrementalAssetSyncEnabled: incrementalAssetSyncEnabled,
        storyAssetUploadPauseDuringGenerationEnabled: pauseUploadsDuringGenerationEnabled,
        storyAssetSyncWarningTimeoutMs: assetSyncWarningTimeoutMs,
        authoringWordCap: awc,
        previewSeedPlanPriceCoins: previewPriceCoins,
        imageUploadOptimizationSettings: nextImageUploadSettings,
        mediaStorage: nextMediaStorage,
        narrationVoiceSettings: nextNarrationVoiceSettings,
        narrationVoiceSampleStatuses: nextNarrationVoiceSampleStatuses,
      }) => {
        setCycleOverrideState(co);
        setCycleMsState(cm);
        setCycleMsInput(String(cm));
        setVignetteEnabled(ve);
        setVignetteAmountPercent(vap);
        setVignetteAmountInput(String(vap));
        setStoryboardImageSizeState(imageSize);
        setStoryboardWebpCompressionEnabledState(webpCompressionEnabled);
        setStoryboardWebpQualityPercentState(webpQualityPercent);
        setStoryboardWebpQualityInput(String(webpQualityPercent));
        setStoryboardClientProcessingEnabledState(clientProcessingEnabled);
        setStoryboardLayoutModeState(layoutMode);
        setLoadingNodeLabelsEnabledState(labelsEnabled);
        setLoadingHintTypewriterEnabledState(typewriterEnabled);
        setLoadingReaderAnticipationMsState(readerAnticipationMs);
        setLoadingReaderAnticipationInput(String(Math.round(readerAnticipationMs / 1000)));
        setLoadingReaderStoryTextEnabledState(readerStoryTextEnabled);
        setLoadingReaderOptionsEnabledState(readerOptionsEnabled);
        setLoadingReaderScrollSpeedPxPerSecondState(readerScrollSpeed);
        setLoadingReaderScrollSpeedInput(String(readerScrollSpeed));
        setStoryUiTextLineCountState(uiTextLineCount);
        setStoryUiTextLineCountInput(String(uiTextLineCount));
        setStoryUiAutoScrollEnabledState(uiAutoScrollEnabled);
        setStoryTextOverlayWordsPerLineState(overlayWordsPerLine);
        setStoryTextOverlayWordsPerLineInput(String(overlayWordsPerLine));
        setClientStoryPersistenceEnabledState(persistenceEnabled);
        setStorylineChoiceFlashEnabledState(choiceFlashEnabled);
        setStorylineChoiceFlashMsState(choiceFlashMs);
        setStorylineChoiceFlashInput(String(choiceFlashMs / 1000));
        setFreePlusCharacterSheetsEnabledState(fpSheets);
        setCreatorCharacterSheetsEnabledState(creatorSheets);
        setStoryPromptOnlyModeEnabledState(promptOnlyModeEnabled);
        setVerticalStoriesSettingEnabledState(verticalStoriesEnabled);
        setAudioStorylinePublishEnabledState(audioPublishEnabled);
        setPromptOnlyMaxImagesPerBeatState(promptOnlyMaxImages);
        setPromptOnlyMaxImagesInput(String(promptOnlyMaxImages));
        setPromptOnlyGalleryCleanupEnabledState(promptOnlyCleanupEnabled);
        setPromptOnlyGalleryCleanupDaysState(promptOnlyCleanupDays);
        setPromptOnlyGalleryCleanupDaysInput(String(promptOnlyCleanupDays));
        setVideoDownloadEnabledState(vidDl);
        setVideoDownloadAdminBypassState(vidDlBypass);
        setTextTimeoutMs(tt);
        setTextTimeoutInput(String(Math.round(tt / 1000)));
        setImageTimeoutMs(it);
        setImageTimeoutInput(String(Math.round(it / 1000)));
        setTtsTimeoutMs(at);
        setTtsTimeoutInput(String(Math.round(at / 1000)));
        setCloudSaveTimeoutMs(st);
        setCloudSaveTimeoutInput(String(Math.round(st / 1000)));
        setStoryAssetSignedUrlSwapEnabledState(assetSwapEnabled);
        setStoryIncrementalAssetSyncEnabledState(incrementalAssetSyncEnabled);
        setStoryAssetUploadPauseDuringGenerationEnabledState(pauseUploadsDuringGenerationEnabled);
        setStoryAssetSyncWarningTimeoutMs(assetSyncWarningTimeoutMs);
        setStoryAssetSyncWarningTimeoutInput(String(Math.round(assetSyncWarningTimeoutMs / 1000)));
        setAuthoringWordCapState(awc);
        setAuthoringWordCapInput(String(awc));
        setPreviewSeedPlanPriceCoinsState(previewPriceCoins);
        setPreviewSeedPlanPriceCoinsInput(String(previewPriceCoins));
        setImageUploadSettings(nextImageUploadSettings);
        setImageUploadDraft(nextImageUploadSettings);
        setMediaStorage(nextMediaStorage);
        setMediaStorageDraft(nextMediaStorage.settings);
        setNarrationVoiceSettingsState(nextNarrationVoiceSettings);
        setNarrationMaleVoiceInput(voicesToMultilineText(nextNarrationVoiceSettings.maleVoiceList));
        setNarrationFemaleVoiceInput(voicesToMultilineText(nextNarrationVoiceSettings.femaleVoiceList));
        setNarrationDefaultMaleVoice(nextNarrationVoiceSettings.defaultMaleVoice);
        setNarrationDefaultFemaleVoice(nextNarrationVoiceSettings.defaultFemaleVoice);
        setNarrationSampleEnglish(nextNarrationVoiceSettings.sampleTextByLanguage['en-IN']);
        setNarrationSampleHindi(nextNarrationVoiceSettings.sampleTextByLanguage['hi-IN']);
        setNarrationVoiceSampleStatuses(nextNarrationVoiceSampleStatuses);
        setLoading(false);
      })
      .catch((err) => {
        console.error('GlobalSettings: failed to load settings:', err);
        setLoadError(err.message || 'Failed to load settings');
        setLoading(false);
      });
  }, []);

  async function handleCycleMsSave() {
    const ms = parseInt(cycleMsInput, 10);
    if (!Number.isFinite(ms) || ms < 500) return;
    setCycleMsSaving(true);
    try {
      await setCycleMs(ms);
      setCycleMsState(ms);
    } finally {
      setCycleMsSaving(false);
    }
  }

  async function handleVignetteAmountSave() {
    const percent = parseInt(vignetteAmountInput, 10);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return;
    setVignetteAmountSaving(true);
    try {
      await setStoryboardVignetteAmountPercent(percent);
      setVignetteAmountPercent(percent);
    } finally {
      setVignetteAmountSaving(false);
    }
  }

  async function handleStoryboardImageSizeSave(size: StoryboardImageSize) {
    if (size === storyboardImageSize) return;
    setStoryboardImageSizeSaving(true);
    try {
      await setStoryboardImageSize(size);
      setStoryboardImageSizeState(size);
    } finally {
      setStoryboardImageSizeSaving(false);
    }
  }

  function parseNarrationVoiceInput(value: string): string[] {
    return normalizeNarrationVoiceList(value.split(/[\n,]/));
  }

  async function saveNarrationVoiceSection(nextEnabled = narrationVoiceSettings?.userLedVoiceSelectionEnabled ?? false) {
    const maleVoiceList = parseNarrationVoiceInput(narrationMaleVoiceInput);
    const femaleVoiceList = parseNarrationVoiceInput(narrationFemaleVoiceInput);

    setNarrationVoiceSaving(true);
    setNarrationVoiceWarnings([]);
    try {
      const result = await saveAdminNarrationVoiceSettings({
        userLedVoiceSelectionEnabled: nextEnabled,
        maleVoiceList,
        femaleVoiceList,
        defaultMaleVoice: narrationDefaultMaleVoice,
        defaultFemaleVoice: narrationDefaultFemaleVoice,
        sampleTextByLanguage: {
          'en-IN': narrationSampleEnglish,
          'hi-IN': narrationSampleHindi,
        },
      });
      setNarrationVoiceSettingsState(result.settings);
      setNarrationMaleVoiceInput(voicesToMultilineText(result.settings.maleVoiceList));
      setNarrationFemaleVoiceInput(voicesToMultilineText(result.settings.femaleVoiceList));
      setNarrationDefaultMaleVoice(result.settings.defaultMaleVoice);
      setNarrationDefaultFemaleVoice(result.settings.defaultFemaleVoice);
      setNarrationSampleEnglish(result.settings.sampleTextByLanguage['en-IN']);
      setNarrationSampleHindi(result.settings.sampleTextByLanguage['hi-IN']);
      setNarrationVoiceSampleStatuses(await getNarrationVoiceSampleStatusesForAdmin());
      setNarrationVoiceWarnings(result.warnings);
    } finally {
      setNarrationVoiceSaving(false);
    }
  }

  async function handleGenerateNarrationVoiceSamples(regenerateAll = false) {
    setNarrationVoiceGenerating(true);
    setNarrationVoiceWarnings([]);
    try {
      await saveNarrationVoiceSection(narrationVoiceSettings?.userLedVoiceSelectionEnabled ?? false);
      const result = await generateNarrationVoiceSamples({ regenerateAll });
      setNarrationVoiceSampleStatuses(result.statuses);
      const summary = [
        result.generatedCount > 0
          ? `Generated ${result.generatedCount} sample${result.generatedCount === 1 ? '' : 's'}`
          : 'No new samples generated',
        result.skippedCount > 0
          ? `kept ${result.skippedCount} ready sample${result.skippedCount === 1 ? '' : 's'}`
          : null,
        result.failedCount > 0
          ? `${result.failedCount} failed`
          : null,
      ].filter(Boolean).join(', ');
      setNarrationVoiceWarnings([`${summary}.`]);
    } finally {
      setNarrationVoiceGenerating(false);
    }
  }

  async function handleStoryboardWebpQualitySave() {
    const percent = parseInt(storyboardWebpQualityInput, 10);
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) return;
    setStoryboardWebpQualitySaving(true);
    try {
      await setStoryboardWebpQualityPercent(percent);
      setStoryboardWebpQualityPercentState(percent);
    } finally {
      setStoryboardWebpQualitySaving(false);
    }
  }

  async function handleLoadingReaderAnticipationSave() {
    const sec = parseInt(loadingReaderAnticipationInput, 10);
    if (!Number.isFinite(sec) || sec < 0) return;
    setLoadingReaderAnticipationSaving(true);
    try {
      const ms = sec * 1000;
      await setStoryLoadingReaderAnticipationMs(ms);
      setLoadingReaderAnticipationMsState(ms);
    } finally {
      setLoadingReaderAnticipationSaving(false);
    }
  }

  async function handleLoadingReaderScrollSpeedSave() {
    const pxPerSecond = parseInt(loadingReaderScrollSpeedInput, 10);
    if (!Number.isFinite(pxPerSecond) || pxPerSecond < 1) return;
    setLoadingReaderScrollSpeedSaving(true);
    try {
      await setStoryLoadingReaderScrollSpeed(pxPerSecond);
      setLoadingReaderScrollSpeedPxPerSecondState(pxPerSecond);
    } finally {
      setLoadingReaderScrollSpeedSaving(false);
    }
  }

  async function handleStoryUiTextLineCountSave() {
    const lines = parseInt(storyUiTextLineCountInput, 10);
    if (!Number.isFinite(lines) || lines < MIN_STORY_UI_TEXT_LINE_COUNT || lines > MAX_STORY_UI_TEXT_LINE_COUNT) return;
    setStoryUiTextLineCountSaving(true);
    try {
      await setStoryUiTextLineCount(lines);
      setStoryUiTextLineCountState(lines);
    } finally {
      setStoryUiTextLineCountSaving(false);
    }
  }

  async function handleStoryTextOverlayWordsPerLineSave() {
    const words = parseInt(storyTextOverlayWordsPerLineInput, 10);
    if (
      !Number.isFinite(words)
      || words < MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE
      || words > MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE
    ) return;
    setStoryTextOverlayWordsPerLineSaving(true);
    try {
      await setStoryTextOverlayWordsPerLine(words);
      setStoryTextOverlayWordsPerLineState(words);
    } finally {
      setStoryTextOverlayWordsPerLineSaving(false);
    }
  }

  async function handleStorylineChoiceFlashSave() {
    const seconds = storylineChoiceFlashInput.trim() === '' ? NaN : Number(storylineChoiceFlashInput);
    if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 30) return;
    const ms = Math.round(seconds * 1000);
    setStorylineChoiceFlashSaving(true);
    try {
      await setStorylineChoiceFlashMs(ms);
      setStorylineChoiceFlashMsState(ms);
      setStorylineChoiceFlashInput(String(ms / 1000));
    } finally {
      setStorylineChoiceFlashSaving(false);
    }
  }

  async function handleTimeoutSave(
    inputVal: string,
    minSec: number,
    setter: (ms: number) => Promise<void>,
    setMs: (ms: number) => void,
    setSaving: (v: boolean) => void
  ) {
    const sec = parseInt(inputVal, 10);
    if (!Number.isFinite(sec) || sec < minSec) return;
    setSaving(true);
    try {
      await setter(sec * 1000);
      setMs(sec * 1000);
    } finally {
      setSaving(false);
    }
  }

  async function handleAuthoringWordCapSave() {
    const words = parseInt(authoringWordCapInput, 10);
    if (!Number.isFinite(words) || words < 50) return;
    setAuthoringWordCapSaving(true);
    try {
      await setAuthoringWordCap(words);
      setAuthoringWordCapState(words);
    } finally {
      setAuthoringWordCapSaving(false);
    }
  }

  async function handlePreviewSeedPlanPriceSave() {
    const coins = previewSeedPlanPriceCoinsInput.trim() === '' ? NaN : Number(previewSeedPlanPriceCoinsInput);
    if (!Number.isFinite(coins) || coins < 0 || !Number.isInteger(coins)) return;
    setPreviewSeedPlanPriceCoinsSaving(true);
    try {
      await setPreviewSeedPlanPriceCoins(coins);
      setPreviewSeedPlanPriceCoinsState(coins);
    } finally {
      setPreviewSeedPlanPriceCoinsSaving(false);
    }
  }

  async function handlePromptOnlyMaxImagesSave() {
    const count = parseInt(promptOnlyMaxImagesInput, 10);
    if (!Number.isFinite(count) || count < 1 || count > 10) return;
    setPromptOnlyMaxImagesSaving(true);
    try {
      await setPromptOnlyMaxImagesPerBeat(count);
      setPromptOnlyMaxImagesPerBeatState(count);
    } finally {
      setPromptOnlyMaxImagesSaving(false);
    }
  }

  async function handlePromptOnlyGalleryCleanupDaysSave() {
    const days = parseInt(promptOnlyGalleryCleanupDaysInput, 10);
    if (!Number.isFinite(days) || days < 1 || days > 90) return;
    setPromptOnlyGalleryCleanupDaysSaving(true);
    try {
      await setPromptOnlyImageGalleryCleanupDays(days);
      setPromptOnlyGalleryCleanupDaysState(days);
    } finally {
      setPromptOnlyGalleryCleanupDaysSaving(false);
    }
  }

  function updateImageUploadDraft(patch: Partial<ImageUploadOptimizationSettings>) {
    setImageUploadDraft((current) => ({ ...current, ...patch }));
    setImageUploadMessage(null);
  }

  async function handleImageUploadSettingsSave() {
    setImageUploadSaving(true);
    setImageUploadMessage(null);
    try {
      const saved = await saveImageUploadOptimizationSettings(imageUploadDraft);
      setImageUploadSettings(saved);
      setImageUploadDraft(saved);
      setImageUploadMessage('Image upload optimization settings saved.');
    } catch (error: any) {
      setImageUploadMessage(error?.message || 'Failed to save image upload optimization settings.');
    } finally {
      setImageUploadSaving(false);
    }
  }

  function updateMediaStorageDraft(patch: Partial<MediaStorageSettings>) {
    setMediaStorageDraft((current) => ({ ...current, ...patch }));
    setMediaStorageMessage(null);
  }

  async function handleMediaStorageSettingsSave() {
    setMediaStorageSaving(true);
    setMediaStorageMessage(null);
    try {
      const saved = await saveMediaStorageSettings(mediaStorageDraft);
      setMediaStorage(saved);
      setMediaStorageDraft(saved.settings);
      setMediaStorageMessage('Media storage settings saved.');
    } catch (error: any) {
      setMediaStorageMessage(error?.message || 'Failed to save media storage settings.');
    } finally {
      setMediaStorageSaving(false);
    }
  }

  const parsedMs = parseInt(cycleMsInput, 10);
  const parsedVignetteAmountPercent = parseInt(vignetteAmountInput, 10);
  const parsedStoryboardWebpQualityPercent = parseInt(storyboardWebpQualityInput, 10);
  const storyboardCompressionControlsEnabled = storyboardClientProcessingEnabled && storyboardWebpCompressionEnabled;
  const parsedLoadingReaderAnticipationSec = parseInt(loadingReaderAnticipationInput, 10);
  const parsedLoadingReaderScrollSpeed = parseInt(loadingReaderScrollSpeedInput, 10);
  const parsedStoryUiTextLineCount = parseInt(storyUiTextLineCountInput, 10);
  const parsedStoryTextOverlayWordsPerLine = parseInt(storyTextOverlayWordsPerLineInput, 10);
  const parsedStorylineChoiceFlashSec = storylineChoiceFlashInput.trim() === ''
    ? NaN
    : Number(storylineChoiceFlashInput);
  const parsedStorylineChoiceFlashMs = Number.isFinite(parsedStorylineChoiceFlashSec)
    ? Math.round(parsedStorylineChoiceFlashSec * 1000)
    : NaN;
  const parsedAuthoringWordCap = parseInt(authoringWordCapInput, 10);
  const parsedPreviewSeedPlanPriceCoins = previewSeedPlanPriceCoinsInput.trim() === ''
    ? NaN
    : Number(previewSeedPlanPriceCoinsInput);
  const parsedPromptOnlyMaxImages = parseInt(promptOnlyMaxImagesInput, 10);
  const parsedPromptOnlyGalleryCleanupDays = parseInt(promptOnlyGalleryCleanupDaysInput, 10);
  const parsedNarrationMaleVoices = parseNarrationVoiceInput(narrationMaleVoiceInput);
  const parsedNarrationFemaleVoices = parseNarrationVoiceInput(narrationFemaleVoiceInput);
  const sectionMeta = GLOBAL_SETTINGS_LINKS.find((item) => item.section === section) ?? GLOBAL_SETTINGS_LINKS[0];
  const overviewSummaries: Record<Exclude<GlobalSettingsSection, 'overview'>, string> = {
    storyboard: `${storyboardImageSize} images, ${storyboardLayoutMode} layout, ${formatToggleSummary(vignetteEnabled).toLowerCase()} vignette`,
    reels: 'Prompt-only 9:16 reels, editable JSON definers, and manual draft cleanup',
    reader: `${storyUiTextLineCount} text lines, ${storyTextOverlayWordsPerLine} overlay words, branch flash ${formatToggleSummary(storylineChoiceFlashEnabled).toLowerCase()}`,
    narration: narrationVoiceSettings
      ? `${formatToggleSummary(narrationVoiceSettings.userLedVoiceSelectionEnabled)} user-led selection, ${narrationVoiceSampleStatuses.length} samples tracked`
      : 'Voice settings not loaded',
    authoring: `${authoringWordCap} word cap, ${previewSeedPlanPriceCoins} coin preview, vertical stories ${formatToggleSummary(verticalStoriesSettingEnabled).toLowerCase()}`,
    characters: `Free/Plus sheets ${formatToggleSummary(freePlusCharacterSheetsEnabled).toLowerCase()}, Creator sheets ${formatToggleSummary(creatorCharacterSheetsEnabled).toLowerCase()}`,
    media: `Storage ${mediaStorage.settings.storageProvider}, R2 ${formatToggleSummary(mediaStorage.settings.r2Enabled && mediaStorage.envStatus.effectiveEnabled).toLowerCase()}, compression ${formatToggleSummary(imageUploadSettings.clientSideCompressionEnabled).toLowerCase()}`,
    'video-export': `Video download ${formatToggleSummary(videoDownloadEnabled).toLowerCase()}, admin bypass ${formatToggleSummary(videoDownloadAdminBypass).toLowerCase()}`,
    generation: `${Math.round(textTimeoutMs / 1000)}s text, ${Math.round(imageTimeoutMs / 1000)}s image, incremental sync ${formatToggleSummary(storyIncrementalAssetSyncEnabled).toLowerCase()}`,
    pages: 'Managed rollout pages, footer controls, and route guards',
  };
  const imageUploadHasUnsavedChanges = JSON.stringify(imageUploadDraft) !== JSON.stringify(imageUploadSettings);
  const mediaStorageHasUnsavedChanges = JSON.stringify(mediaStorageDraft) !== JSON.stringify(mediaStorage.settings);

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-1 text-2xl text-neutral-100">{sectionMeta.label}</h1>
      <p className="mb-8 text-sm text-neutral-400">{sectionMeta.description}</p>

      {loadError && (
        <div className="mb-6 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          Failed to load settings - {loadError}. Try refreshing the page.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-neutral-400"><Loader2 size={16} className="animate-spin" />Loading settings...</div>
      ) : (
        <div className="space-y-6">
          {section === 'overview' && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-medium text-neutral-100">Global settings workspace</h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    Settings are grouped by workflow so new controls can be added without turning this page into a long scroll.
                  </p>
                </div>
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-wider text-emerald-300">
                  {GLOBAL_SETTINGS_SECTION_LINKS.length} sections
                </span>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {GLOBAL_SETTINGS_SECTION_LINKS.map(({ section: linkSection, href, label, description, icon }) => (
                  <OverviewLinkCard
                    key={href}
                    href={href}
                    label={label}
                    description={description}
                    icon={icon}
                    summary={overviewSummaries[linkSection]}
                  />
                ))}
              </div>
            </div>
          )}

          {section === 'storyboard' && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Storyboard</h2>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              Storyboard generation is always on. Every beat renders as a 2x2 panel grid; image size and browser-side WebP processing apply to new beat images only.
            </div>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Storyboard Image Size</p>
              <p className="text-xs text-neutral-400 mb-3">Gemini output size for new per-beat storyboard images.</p>
              <div className="inline-flex rounded-lg border border-white/10 bg-neutral-950/60 p-1">
                {(['1K', '2K'] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => handleStoryboardImageSizeSave(size)}
                    disabled={storyboardImageSizeSaving}
                    className={`rounded-md px-4 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                      storyboardImageSize === size
                        ? 'bg-emerald-500 text-neutral-950'
                        : 'text-neutral-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              {storyboardImageSizeSaving && (
                <span className="ml-3 inline-flex items-center gap-1 text-xs text-neutral-400">
                  <Loader2 size={12} className="animate-spin" />Saving
                </span>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Storyboard Layout</p>
              <p className="text-xs text-neutral-400 mb-3">Layout mode is stored for future formats. The active runtime mode remains the four-panel storyboard.</p>
              <div className="inline-flex rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">
                {storyboardLayoutMode} grid
              </div>
            </div>

            <ToggleRow
              label="Client-Side Image Processing"
              description="Allow the browser to process storyboard images after Gemini returns them. Turn off for direct 1K output testing."
              checked={storyboardClientProcessingEnabled}
              toggling={storyboardClientProcessingToggling}
              onToggle={async () => {
                setStoryboardClientProcessingToggling(true);
                const next = !storyboardClientProcessingEnabled;
                try {
                  await setStoryboardClientProcessing(next);
                  setStoryboardClientProcessingEnabledState(next);
                } finally {
                  setStoryboardClientProcessingToggling(false);
                }
              }}
            />

            <ToggleRow
              label="WebP Compression"
              description="Encode storyboard images as WebP in the browser when client-side processing is also enabled."
              checked={storyboardWebpCompressionEnabled}
              toggling={storyboardWebpCompressionToggling}
              onToggle={async () => {
                setStoryboardWebpCompressionToggling(true);
                const next = !storyboardWebpCompressionEnabled;
                try {
                  await setStoryboardWebpCompression(next);
                  setStoryboardWebpCompressionEnabledState(next);
                } finally {
                  setStoryboardWebpCompressionToggling(false);
                }
              }}
            />

            <div className={`rounded-xl border border-white/10 bg-neutral-900/60 p-4 ${storyboardCompressionControlsEnabled ? '' : 'opacity-60'}`}>
              <p className="text-sm font-medium text-neutral-100 mb-1">WebP Quality</p>
              <p className="text-xs text-neutral-400 mb-3">Compression quality from 1 to 100. Active only when both processing and WebP compression are on.</p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={storyboardWebpQualityInput}
                  disabled={!storyboardCompressionControlsEnabled}
                  onChange={(e) => setStoryboardWebpQualityInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed"
                  placeholder="85"
                />
                <span className="text-xs text-neutral-500">%</span>
                <button
                  onClick={handleStoryboardWebpQualitySave}
                  disabled={
                    !storyboardCompressionControlsEnabled ||
                    storyboardWebpQualitySaving ||
                    !Number.isFinite(parsedStoryboardWebpQualityPercent) ||
                    parsedStoryboardWebpQualityPercent < 1 ||
                    parsedStoryboardWebpQualityPercent > 100
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {storyboardWebpQualitySaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {storyboardWebpQualityPercent !== parsedStoryboardWebpQualityPercent && parsedStoryboardWebpQualityPercent >= 1 && parsedStoryboardWebpQualityPercent <= 100 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
              {Number.isFinite(parsedStoryboardWebpQualityPercent) && (parsedStoryboardWebpQualityPercent < 1 || parsedStoryboardWebpQualityPercent > 100) && (
                <p className="mt-3 text-xs text-amber-400">Use a value from 1 to 100.</p>
              )}
            </div>

            <ToggleRow
              label="Manual Panel Timing"
              description="Override audio-synced panel cycling with a fixed duration. When off, panels advance at narration duration / 4."
              checked={cycleOverride}
              toggling={cycleOverrideToggling}
              onToggle={async () => {
                setCycleOverrideToggling(true);
                const next = !cycleOverride;
                try {
                  await setCycleOverride(next);
                  setCycleOverrideState(next);
                } finally {
                  setCycleOverrideToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Storyboard Vignette"
              description="Apply a soft vignette to storyboard artwork only, while keeping UI chrome above the effect."
              checked={vignetteEnabled}
              toggling={vignetteToggling}
              onToggle={async () => {
                setVignetteToggling(true);
                const next = !vignetteEnabled;
                try {
                  await setStoryboardVignette(next);
                  setVignetteEnabled(next);
                } finally {
                  setVignetteToggling(false);
                }
              }}
            />

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Vignette Amount</p>
              <p className="text-xs text-neutral-400 mb-3">Intensity from 0 to 100. A value of 100 matches the current vignette strength.</p>
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Number.isFinite(parsedVignetteAmountPercent) ? Math.min(100, Math.max(0, parsedVignetteAmountPercent)) : vignetteAmountPercent}
                  onChange={(e) => setVignetteAmountInput(e.target.value)}
                  className="w-full max-w-sm accent-emerald-400"
                />
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={vignetteAmountInput}
                    onChange={(e) => setVignetteAmountInput(e.target.value)}
                    className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="100"
                  />
                  <span className="text-xs text-neutral-500">%</span>
                  <button
                    onClick={handleVignetteAmountSave}
                    disabled={
                      vignetteAmountSaving ||
                      !Number.isFinite(parsedVignetteAmountPercent) ||
                      parsedVignetteAmountPercent < 0 ||
                      parsedVignetteAmountPercent > 100
                    }
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                  >
                    {vignetteAmountSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                  </button>
                  {vignetteAmountPercent !== parsedVignetteAmountPercent && parsedVignetteAmountPercent >= 0 && parsedVignetteAmountPercent <= 100 && (
                    <span className="text-xs text-amber-400">Unsaved</span>
                  )}
                </div>
              </div>
              {Number.isFinite(parsedVignetteAmountPercent) && (parsedVignetteAmountPercent < 0 || parsedVignetteAmountPercent > 100) && (
                <p className="mt-3 text-xs text-amber-400">Use a value from 0 to 100.</p>
              )}
            </div>

            {cycleOverride && (
              <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                <p className="text-sm font-medium text-neutral-100 mb-1">Panel Duration</p>
                <p className="text-xs text-neutral-400 mb-3">Time each panel is shown (milliseconds). Minimum 500ms.</p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={500}
                    step={100}
                    value={cycleMsInput}
                    onChange={(e) => setCycleMsInput(e.target.value)}
                    className="w-32 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    placeholder="5000"
                  />
                  <span className="text-xs text-neutral-500">ms</span>
                  <button
                    onClick={handleCycleMsSave}
                    disabled={cycleMsSaving || !Number.isFinite(parsedMs) || parsedMs < 500}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                  >
                    {cycleMsSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                  </button>
                  {cycleMs !== parsedMs && parsedMs >= 500 && (
                    <span className="text-xs text-amber-400">Unsaved</span>
                  )}
                </div>
              </div>
            )}
          </div>
          )}

          {section === 'reader' && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">UI</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Shared reader controls for live stories and published playback.
            </p>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Story Text Lines</p>
              <p className="text-xs text-neutral-400 mb-3">
                Visible story text height before scrolling. Default: 7 lines.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={MIN_STORY_UI_TEXT_LINE_COUNT}
                  max={MAX_STORY_UI_TEXT_LINE_COUNT}
                  step={1}
                  value={storyUiTextLineCountInput}
                  onChange={(e) => setStoryUiTextLineCountInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="7"
                />
                <span className="text-xs text-neutral-500">lines</span>
                <button
                  onClick={handleStoryUiTextLineCountSave}
                  disabled={
                    storyUiTextLineCountSaving ||
                    !Number.isFinite(parsedStoryUiTextLineCount) ||
                    parsedStoryUiTextLineCount < MIN_STORY_UI_TEXT_LINE_COUNT ||
                    parsedStoryUiTextLineCount > MAX_STORY_UI_TEXT_LINE_COUNT
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {storyUiTextLineCountSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {storyUiTextLineCount !== parsedStoryUiTextLineCount && parsedStoryUiTextLineCount >= MIN_STORY_UI_TEXT_LINE_COUNT && parsedStoryUiTextLineCount <= MAX_STORY_UI_TEXT_LINE_COUNT && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
              {Number.isFinite(parsedStoryUiTextLineCount) && (parsedStoryUiTextLineCount < MIN_STORY_UI_TEXT_LINE_COUNT || parsedStoryUiTextLineCount > MAX_STORY_UI_TEXT_LINE_COUNT) && (
                <p className="mt-3 text-xs text-amber-400">
                  Use a value from {MIN_STORY_UI_TEXT_LINE_COUNT} to {MAX_STORY_UI_TEXT_LINE_COUNT}.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Overlay Words Per Line</p>
              <p className="text-xs text-neutral-400 mb-3">
                Words grouped per timed overlay line in story narration. Default: 7 words.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE}
                  max={MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE}
                  step={1}
                  value={storyTextOverlayWordsPerLineInput}
                  onChange={(e) => setStoryTextOverlayWordsPerLineInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="7"
                />
                <span className="text-xs text-neutral-500">words</span>
                <button
                  onClick={handleStoryTextOverlayWordsPerLineSave}
                  disabled={
                    storyTextOverlayWordsPerLineSaving ||
                    !Number.isFinite(parsedStoryTextOverlayWordsPerLine) ||
                    parsedStoryTextOverlayWordsPerLine < MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE ||
                    parsedStoryTextOverlayWordsPerLine > MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {storyTextOverlayWordsPerLineSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {storyTextOverlayWordsPerLine !== parsedStoryTextOverlayWordsPerLine
                  && parsedStoryTextOverlayWordsPerLine >= MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE
                  && parsedStoryTextOverlayWordsPerLine <= MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
              {Number.isFinite(parsedStoryTextOverlayWordsPerLine)
                && (
                  parsedStoryTextOverlayWordsPerLine < MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE
                  || parsedStoryTextOverlayWordsPerLine > MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE
                ) && (
                <p className="mt-3 text-xs text-amber-400">
                  Use a value from {MIN_STORY_TEXT_OVERLAY_WORDS_PER_LINE} to {MAX_STORY_TEXT_OVERLAY_WORDS_PER_LINE}.
                </p>
              )}
            </div>

            <ToggleRow
              label="Auto-scroll Story Button"
              description="Show the reader control that automatically scrolls long story text."
              checked={storyUiAutoScrollEnabled}
              toggling={storyUiAutoScrollToggling}
              onToggle={async () => {
                setStoryUiAutoScrollToggling(true);
                const next = !storyUiAutoScrollEnabled;
                try {
                  await setStoryUiAutoScroll(next);
                  setStoryUiAutoScrollEnabledState(next);
                } finally {
                  setStoryUiAutoScrollToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Client Story Persistence"
              description="Cache story manifests, progress, images, and narration on the current device for faster repeat playback and offline-ready reads."
              checked={clientStoryPersistenceEnabled}
              toggling={clientStoryPersistenceToggling}
              onToggle={async () => {
                setClientStoryPersistenceToggling(true);
                const next = !clientStoryPersistenceEnabled;
                try {
                  await setClientStoryPersistenceEnabled(next);
                  setClientStoryPersistenceEnabledState(next);
                } finally {
                  setClientStoryPersistenceToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Storyline Branch Choice Flash"
              description="Show the selected branch choice before the resulting beat plays in published storyline playback."
              checked={storylineChoiceFlashEnabled}
              toggling={storylineChoiceFlashToggling}
              onToggle={async () => {
                setStorylineChoiceFlashToggling(true);
                const next = !storylineChoiceFlashEnabled;
                try {
                  await setStorylineChoiceFlashEnabled(next);
                  setStorylineChoiceFlashEnabledState(next);
                } finally {
                  setStorylineChoiceFlashToggling(false);
                }
              }}
            />

            <div className={`rounded-xl border border-white/10 bg-neutral-900/60 p-4 ${storylineChoiceFlashEnabled ? '' : 'opacity-60'}`}>
              <p className="text-sm font-medium text-neutral-100 mb-1">Branch Choice Flash Duration</p>
              <p className="text-xs text-neutral-400 mb-3">
                Seconds to show the selected branch choice before the next beat starts. Default: 3s.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={storylineChoiceFlashInput}
                  disabled={!storylineChoiceFlashEnabled}
                  onChange={(e) => setStorylineChoiceFlashInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed"
                  placeholder="3"
                />
                <span className="text-xs text-neutral-500">s</span>
                <button
                  onClick={handleStorylineChoiceFlashSave}
                  disabled={
                    !storylineChoiceFlashEnabled ||
                    storylineChoiceFlashSaving ||
                    !Number.isFinite(parsedStorylineChoiceFlashSec) ||
                    parsedStorylineChoiceFlashSec < 0.5 ||
                    parsedStorylineChoiceFlashSec > 30
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {storylineChoiceFlashSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {storylineChoiceFlashMs !== parsedStorylineChoiceFlashMs && parsedStorylineChoiceFlashSec >= 0.5 && parsedStorylineChoiceFlashSec <= 30 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
              {Number.isFinite(parsedStorylineChoiceFlashSec) && (parsedStorylineChoiceFlashSec < 0.5 || parsedStorylineChoiceFlashSec > 30) && (
                <p className="mt-3 text-xs text-amber-400">Use a value from 0.5 to 30 seconds.</p>
              )}
            </div>
          </div>
          )}

          {section === 'narration' && narrationVoiceSettings && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
              <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Narration Voice Settings</h2>
              <p className="text-xs text-neutral-400 -mt-2">
                Curated voice controls for deterministic story narration. New stories use these settings when user-led selection is enabled.
              </p>

              <ToggleRow
                label="Enable user-led narration voice selection"
                description="When enabled, new stories use the selected voice and bypass legacy AI voice selection."
                checked={narrationVoiceSettings.userLedVoiceSelectionEnabled}
                toggling={narrationVoiceSaving}
                onToggle={async () => {
                  await saveNarrationVoiceSection(!narrationVoiceSettings.userLedVoiceSelectionEnabled);
                }}
              />

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                  <p className="text-sm font-medium text-neutral-100 mb-1">Male voice list</p>
                  <p className="text-xs text-neutral-400 mb-3">One voice ID per line. Configured voices remain selectable for new stories.</p>
                  <textarea
                    value={narrationMaleVoiceInput}
                    onChange={(event) => setNarrationMaleVoiceInput(event.target.value)}
                    rows={7}
                    className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <label className="mt-3 block text-xs text-neutral-400" htmlFor="default-male-voice">
                    Default male voice
                  </label>
                  <select
                    id="default-male-voice"
                    value={narrationDefaultMaleVoice}
                    onChange={(event) => setNarrationDefaultMaleVoice(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {parsedNarrationMaleVoices.map((voice) => (
                      <option key={voice} value={voice}>{voice}</option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                  <p className="text-sm font-medium text-neutral-100 mb-1">Female voice list</p>
                  <p className="text-xs text-neutral-400 mb-3">One voice ID per line. Configured voices remain selectable for new stories.</p>
                  <textarea
                    value={narrationFemaleVoiceInput}
                    onChange={(event) => setNarrationFemaleVoiceInput(event.target.value)}
                    rows={7}
                    className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <label className="mt-3 block text-xs text-neutral-400" htmlFor="default-female-voice">
                    Default female voice
                  </label>
                  <select
                    id="default-female-voice"
                    value={narrationDefaultFemaleVoice}
                    onChange={(event) => setNarrationDefaultFemaleVoice(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {parsedNarrationFemaleVoices.map((voice) => (
                      <option key={voice} value={voice}>{voice}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                  <p className="text-sm font-medium text-neutral-100 mb-1">English sample text</p>
                  <textarea
                    value={narrationSampleEnglish}
                    onChange={(event) => setNarrationSampleEnglish(event.target.value)}
                    rows={4}
                    className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                  <p className="text-sm font-medium text-neutral-100 mb-1">Hindi sample text</p>
                  <textarea
                    value={narrationSampleHindi}
                    onChange={(event) => setNarrationSampleHindi(event.target.value)}
                    rows={4}
                    className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => saveNarrationVoiceSection()}
                  disabled={narrationVoiceSaving || parsedNarrationMaleVoices.length === 0 || parsedNarrationFemaleVoices.length === 0}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {narrationVoiceSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save voice settings'}
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerateNarrationVoiceSamples(false)}
                  disabled={narrationVoiceGenerating || narrationVoiceSaving || parsedNarrationMaleVoices.length === 0 || parsedNarrationFemaleVoices.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/70 px-4 py-2 text-xs font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-50"
                >
                  {narrationVoiceGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
                  Generate Missing Samples
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerateNarrationVoiceSamples(true)}
                  disabled={narrationVoiceGenerating || narrationVoiceSaving || parsedNarrationMaleVoices.length === 0 || parsedNarrationFemaleVoices.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/15 disabled:opacity-50"
                >
                  {narrationVoiceGenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
                  Regenerate All
                </button>
              </div>

              {narrationVoiceWarnings.length > 0 && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                  {narrationVoiceWarnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}

              <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-neutral-100">Sample generation status</p>
                  <p className="text-xs text-neutral-500">{narrationVoiceSampleStatuses.length} voice-language items</p>
                </div>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {narrationVoiceSampleStatuses.map((sample) => (
                    <div key={`${sample.voiceId}-${sample.languageCode}`} className="rounded-lg border border-white/10 bg-neutral-950/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-neutral-100">{sample.voiceId}</p>
                          <p className="text-xs text-neutral-500">{sample.genderBucket} - {sample.languageCode}</p>
                        </div>
                        <span className={`rounded-full border px-2 py-1 text-[11px] ${sampleStatusClassName(sample.status)}`}>
                          {sample.status}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-neutral-500">Last generated: {formatSampleTimestamp(sample.lastGeneratedAt)}</p>
                      {sample.error && (
                        <p className="mt-2 text-xs text-rose-300">{sample.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === 'reader' && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Loader Screen</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Controls the modal shown while new story beats are being generated.
            </p>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Anticipation Time</p>
              <p className="text-xs text-neutral-400 mb-3">
                Minimum time to hold the anticipation copy before falling back to previous story text. Generated story text still appears immediately when it is ready. Default: 10s.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={loadingReaderAnticipationInput}
                  onChange={(e) => setLoadingReaderAnticipationInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="10"
                />
                <span className="text-xs text-neutral-500">s</span>
                <button
                  onClick={handleLoadingReaderAnticipationSave}
                  disabled={loadingReaderAnticipationSaving || !Number.isFinite(parsedLoadingReaderAnticipationSec) || parsedLoadingReaderAnticipationSec < 0}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {loadingReaderAnticipationSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {Math.round(loadingReaderAnticipationMs / 1000) !== parsedLoadingReaderAnticipationSec && parsedLoadingReaderAnticipationSec >= 0 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
            </div>

            <ToggleRow
              label="Show Story Text"
              description="Reveal the generated beat text in the loader as soon as it is ready. When off, the anticipation copy loops until the beat is ready."
              checked={loadingReaderStoryTextEnabled}
              toggling={loadingReaderStoryTextToggling}
              onToggle={async () => {
                setLoadingReaderStoryTextToggling(true);
                const next = !loadingReaderStoryTextEnabled;
                try {
                  await setStoryLoadingReaderStoryText(next);
                  setLoadingReaderStoryTextEnabledState(next);
                } finally {
                  setLoadingReaderStoryTextToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Show Branching Options"
              description="Show non-clickable generated branch previews after the story text has finished scrolling."
              checked={loadingReaderOptionsEnabled}
              toggling={loadingReaderOptionsToggling}
              onToggle={async () => {
                setLoadingReaderOptionsToggling(true);
                const next = !loadingReaderOptionsEnabled;
                try {
                  await setStoryLoadingReaderOptions(next);
                  setLoadingReaderOptionsEnabledState(next);
                } finally {
                  setLoadingReaderOptionsToggling(false);
                }
              }}
            />

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Story Text Scrolling Speed</p>
              <p className="text-xs text-neutral-400 mb-3">Auto-scroll speed for generated story text. Default: 24 px/s.</p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={loadingReaderScrollSpeedInput}
                  onChange={(e) => setLoadingReaderScrollSpeedInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="24"
                />
                <span className="text-xs text-neutral-500">px/s</span>
                <button
                  onClick={handleLoadingReaderScrollSpeedSave}
                  disabled={loadingReaderScrollSpeedSaving || !Number.isFinite(parsedLoadingReaderScrollSpeed) || parsedLoadingReaderScrollSpeed < 1}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {loadingReaderScrollSpeedSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {loadingReaderScrollSpeedPxPerSecond !== parsedLoadingReaderScrollSpeed && parsedLoadingReaderScrollSpeed >= 1 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
            </div>

            <ToggleRow
              label="Show Loading Step Labels"
              description="Show or hide the small labels under the loading progress nodes while a beat is being created."
              checked={loadingNodeLabelsEnabled}
              toggling={loadingNodeLabelsToggling}
              onToggle={async () => {
                setLoadingNodeLabelsToggling(true);
                const next = !loadingNodeLabelsEnabled;
                try {
                  await setStoryLoadingNodeLabels(next);
                  setLoadingNodeLabelsEnabledState(next);
                } finally {
                  setLoadingNodeLabelsToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Typewriter Loading Text"
              description="Animate the anticipation line with a typewriter reveal."
              checked={loadingHintTypewriterEnabled}
              toggling={loadingHintTypewriterToggling}
              onToggle={async () => {
                setLoadingHintTypewriterToggling(true);
                const next = !loadingHintTypewriterEnabled;
                try {
                  await setStoryLoadingHintTypewriter(next);
                  setLoadingHintTypewriterEnabledState(next);
                } finally {
                  setLoadingHintTypewriterToggling(false);
                }
              }}
            />
          </div>
          )}

          {section === 'characters' && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Character References</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Decide which plan tiers get richer character sheets instead of the default 0.5K single full-body portrait.
            </p>

            <ToggleRow
              label="Enable 0.5K Character Sheets for Free and Plus"
              description="When this is on, Free and Plus stories use a compact 0.5K character sheet with a close-up, front view, and 3/4 view. When this is off, they fall back to the faster 0.5K single portrait."
              checked={freePlusCharacterSheetsEnabled}
              toggling={freePlusCharacterSheetsToggling}
              onToggle={async () => {
                setFreePlusCharacterSheetsToggling(true);
                const next = !freePlusCharacterSheetsEnabled;
                try {
                  await setFreePlusCharacterSheets(next);
                  setFreePlusCharacterSheetsEnabledState(next);
                } finally {
                  setFreePlusCharacterSheetsToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Enable Character Sheets for Creators"
              description="When this is on, Studio stories default to a 0.5K character sheet and can turn on 1K sheets in Creator Settings during setup. When this is off, creators also fall back to the default 0.5K single portrait."
              checked={creatorCharacterSheetsEnabled}
              toggling={creatorCharacterSheetsToggling}
              onToggle={async () => {
                setCreatorCharacterSheetsToggling(true);
                const next = !creatorCharacterSheetsEnabled;
                try {
                  await setCreatorCharacterSheets(next);
                  setCreatorCharacterSheetsEnabledState(next);
                } finally {
                  setCreatorCharacterSheetsToggling(false);
                }
              }}
            />
          </div>
          )}

          {section === 'authoring' && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Authoring</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Shared limits and preview pricing for prompt-based and seeded story setup.
            </p>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Shared authoring word cap</p>
              <p className="text-xs text-neutral-400 mb-3">
                Applies to prompt mode prompts and seeded mode source text plus extra guidance. Titles are excluded.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={50}
                  step={25}
                  value={authoringWordCapInput}
                  onChange={(e) => setAuthoringWordCapInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="500"
                />
                <span className="text-xs text-neutral-500">words</span>
                <button
                  onClick={handleAuthoringWordCapSave}
                  disabled={authoringWordCapSaving || !Number.isFinite(parsedAuthoringWordCap) || parsedAuthoringWordCap < 50}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {authoringWordCapSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {authoringWordCap !== parsedAuthoringWordCap && parsedAuthoringWordCap >= 50 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Seed preview price</p>
              <p className="text-xs text-neutral-400 mb-3">
                Preview is text-only. Set 0 to keep it free, or charge any whole-coin amount.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={previewSeedPlanPriceCoinsInput}
                  onChange={(e) => setPreviewSeedPlanPriceCoinsInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="0"
                />
                <span className="text-xs text-neutral-500">coins</span>
                <button
                  onClick={handlePreviewSeedPlanPriceSave}
                  disabled={
                    previewSeedPlanPriceCoinsSaving ||
                    !Number.isFinite(parsedPreviewSeedPlanPriceCoins) ||
                    parsedPreviewSeedPlanPriceCoins < 0 ||
                    !Number.isInteger(parsedPreviewSeedPlanPriceCoins)
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {previewSeedPlanPriceCoinsSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {previewSeedPlanPriceCoins !== parsedPreviewSeedPlanPriceCoins && parsedPreviewSeedPlanPriceCoins >= 0 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
              {Number.isFinite(parsedPreviewSeedPlanPriceCoins) && !Number.isInteger(parsedPreviewSeedPlanPriceCoins) && (
                <p className="mt-3 text-xs text-amber-400">Use whole coins.</p>
              )}
            </div>

            <ToggleRow
              label="Enable Prompt-Only Story Mode"
              description="Show the advanced option that lets creators generate beats without AI images and copy the exact image prompts instead."
              checked={storyPromptOnlyModeEnabled}
              toggling={storyPromptOnlyModeToggling}
              onToggle={async () => {
                setStoryPromptOnlyModeToggling(true);
                const next = !storyPromptOnlyModeEnabled;
                try {
                  await setStoryPromptOnlyModeEnabled(next);
                  setStoryPromptOnlyModeEnabledState(next);
                } finally {
                  setStoryPromptOnlyModeToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Enable Vertical Stories setting for users"
              description="Show the advanced option for 9:16 portrait stories suitable for reels and shorts."
              checked={verticalStoriesSettingEnabled}
              toggling={verticalStoriesSettingToggling}
              onToggle={async () => {
                setVerticalStoriesSettingToggling(true);
                const next = !verticalStoriesSettingEnabled;
                try {
                  await setVerticalStoriesSettingEnabled(next);
                  setVerticalStoriesSettingEnabledState(next);
                } finally {
                  setVerticalStoriesSettingToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Allow Audio-Only Storyline Publish"
              description="Let incomplete prompt-only stories publish as audio stories even when some beat images are still missing."
              checked={audioStorylinePublishEnabled}
              toggling={audioStorylinePublishToggling}
              onToggle={async () => {
                setAudioStorylinePublishToggling(true);
                const next = !audioStorylinePublishEnabled;
                try {
                  await setAudioStorylinePublishEnabled(next);
                  setAudioStorylinePublishEnabledState(next);
                } finally {
                  setAudioStorylinePublishToggling(false);
                }
              }}
            />

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-1">Max images per prompt-only beat</p>
              <p className="text-xs text-neutral-400 mb-3">
                Each beat can hold up to this many uploaded 16:9 images. Users select one as active; the rest stay in the gallery for re-use.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  value={promptOnlyMaxImagesInput}
                  onChange={(e) => setPromptOnlyMaxImagesInput(e.target.value)}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder="3"
                />
                <span className="text-xs text-neutral-500">images</span>
                <button
                  onClick={handlePromptOnlyMaxImagesSave}
                  disabled={
                    promptOnlyMaxImagesSaving ||
                    !Number.isFinite(parsedPromptOnlyMaxImages) ||
                    parsedPromptOnlyMaxImages < 1 ||
                    parsedPromptOnlyMaxImages > 10
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {promptOnlyMaxImagesSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {promptOnlyMaxImagesPerBeat !== parsedPromptOnlyMaxImages && parsedPromptOnlyMaxImages >= 1 && parsedPromptOnlyMaxImages <= 10 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
            </div>

            <ToggleRow
              label="Auto-prune unused beat images"
              description="Nightly job removes prompt-only beat images that aren't currently active and were uploaded more than the configured number of days ago."
              checked={promptOnlyGalleryCleanupEnabled}
              toggling={promptOnlyGalleryCleanupToggling}
              onToggle={async () => {
                setPromptOnlyGalleryCleanupToggling(true);
                const next = !promptOnlyGalleryCleanupEnabled;
                try {
                  await setPromptOnlyImageGalleryCleanupEnabled(next);
                  setPromptOnlyGalleryCleanupEnabledState(next);
                } finally {
                  setPromptOnlyGalleryCleanupToggling(false);
                }
              }}
            />

            <div className={`rounded-xl border border-white/10 bg-neutral-900/60 p-4 transition-opacity ${promptOnlyGalleryCleanupEnabled ? '' : 'opacity-50'}`}>
              <p className="text-sm font-medium text-neutral-100 mb-1">Days before pruning unused images</p>
              <p className="text-xs text-neutral-400 mb-3">
                Inactive beat images older than this are deleted from storage during the nightly cleanup job. Users see this number in the upload dialog.
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={90}
                  step={1}
                  value={promptOnlyGalleryCleanupDaysInput}
                  onChange={(e) => setPromptOnlyGalleryCleanupDaysInput(e.target.value)}
                  disabled={!promptOnlyGalleryCleanupEnabled}
                  className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                  placeholder="7"
                />
                <span className="text-xs text-neutral-500">days</span>
                <button
                  onClick={handlePromptOnlyGalleryCleanupDaysSave}
                  disabled={
                    !promptOnlyGalleryCleanupEnabled ||
                    promptOnlyGalleryCleanupDaysSaving ||
                    !Number.isFinite(parsedPromptOnlyGalleryCleanupDays) ||
                    parsedPromptOnlyGalleryCleanupDays < 1 ||
                    parsedPromptOnlyGalleryCleanupDays > 90
                  }
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                >
                  {promptOnlyGalleryCleanupDaysSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
                {promptOnlyGalleryCleanupDays !== parsedPromptOnlyGalleryCleanupDays && parsedPromptOnlyGalleryCleanupDays >= 1 && parsedPromptOnlyGalleryCleanupDays <= 90 && (
                  <span className="text-xs text-amber-400">Unsaved</span>
                )}
              </div>
            </div>
          </div>
          )}

          {section === 'media' && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Media Storage</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Cloudflare R2 is gated by both these controls and staging environment variables. Secrets stay server-side.
            </p>

            <div className="grid gap-3 md:grid-cols-3">
              {(['hybrid', 'r2', 'supabase'] as const).map((provider) => (
                <button
                  key={provider}
                  onClick={() => updateMediaStorageDraft({ storageProvider: provider })}
                  className={`rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                    mediaStorageDraft.storageProvider === provider
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                      : 'border-white/10 bg-neutral-900/60 text-neutral-300 hover:border-white/20'
                  }`}
                >
                  <span className="font-medium capitalize">{provider}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {([
                ['r2Enabled', 'Enable R2'],
                ['r2UseForImages', 'Use R2 for images'],
                ['r2UseForCovers', 'Use R2 for covers'],
                ['r2UseForNarrationAudio', 'Use R2 for narration audio'],
                ['r2PublicDeliveryForPublishedStories', 'Public R2 delivery for published stories'],
                ['r2GenerateThumbnails', 'Generate R2 thumbnails'],
                ['r2FallbackToSupabase', 'Fallback to Supabase after R2 failure'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                  <span className="text-sm text-neutral-100">{label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(mediaStorageDraft[key])}
                    onChange={(event) => updateMediaStorageDraft({ [key]: event.target.checked })}
                    className="h-4 w-4 accent-emerald-500"
                  />
                </label>
              ))}
            </div>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-sm font-medium text-neutral-100 mb-2">Published asset cache duration</p>
              <input
                type="number"
                min={60}
                max={31536000}
                step={60}
                value={mediaStorageDraft.publishedAssetCacheDuration}
                onChange={(event) => updateMediaStorageDraft({ publishedAssetCacheDuration: Number(event.target.value) })}
                className="w-44 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4 text-xs text-neutral-400">
              <p className="mb-2 text-sm font-medium text-neutral-200">R2 environment</p>
              <div className="grid gap-2 md:grid-cols-2">
                {([
                  ['Account ID', mediaStorage.envStatus.accountIdPresent],
                  ['Access key', mediaStorage.envStatus.accessKeyPresent],
                  ['Secret key', mediaStorage.envStatus.secretKeyPresent],
                  ['Public bucket', mediaStorage.envStatus.bucketNamePresent],
                  ['Private bucket', mediaStorage.envStatus.privateBucketNamePresent],
                  ['Public base URL', mediaStorage.envStatus.publicBaseUrlPresent],
                  ['Endpoint', mediaStorage.envStatus.endpointPresent],
                  ['Effective R2', mediaStorage.envStatus.effectiveEnabled],
                ] as const).map(([label, ok]) => (
                  <span key={label} className={ok ? 'text-emerald-300' : 'text-amber-300'}>
                    {label}: {ok ? 'ready' : 'missing/off'}
                  </span>
                ))}
              </div>
              {mediaStorage.envStatus.missing.length > 0 && (
                <p className="mt-3 text-amber-300">Missing: {mediaStorage.envStatus.missing.join(', ')}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-xs leading-relaxed text-neutral-400">
                Private R2 media is persisted as r2:// references and resolved through server-side signed URLs.
              </p>
              <div className="flex items-center gap-3">
                {mediaStorageHasUnsavedChanges && <span className="text-xs text-amber-400">Unsaved</span>}
                <button
                  onClick={handleMediaStorageSettingsSave}
                  disabled={mediaStorageSaving || !mediaStorageHasUnsavedChanges}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mediaStorageSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
              </div>
            </div>

            {mediaStorageMessage && (
              <div className="rounded-xl border border-white/10 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-300">
                {mediaStorageMessage}
              </div>
            )}
          </div>
          )}

          {section === 'media' && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Image Upload Optimization</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Browser-side optimization runs before storage upload and can be disabled instantly if a device/browser issue appears.
            </p>

            <ToggleRow
              label="Enable client-side compression"
              description="Master rollback switch for all uploaded visual assets. Turning this off restores the old upload path as closely as possible."
              checked={imageUploadDraft.clientSideCompressionEnabled}
              toggling={false}
              onToggle={() => updateImageUploadDraft({ clientSideCompressionEnabled: !imageUploadDraft.clientSideCompressionEnabled })}
            />

            <div className="grid gap-3 md:grid-cols-2">
              {([
                ['compressBeatImages', 'Uploaded beat images'],
                ['compressStoryboardImages', 'Storyboard / beat images'],
                ['compressCoverImages', 'Story covers and thumbnails'],
                ['compressSocialCoverImages', 'Social share covers'],
                ['compressCharacterRefs', 'Character references'],
                ['showCompressionStatsToUser', 'Show optimization stats'],
                ['allowOriginalUploadIfCompressionFailsAndWithinLimit', 'Allow safe original fallback'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                  <span className="text-sm text-neutral-100">{label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(imageUploadDraft[key])}
                    onChange={(event) => updateImageUploadDraft({ [key]: event.target.checked })}
                    className="h-4 w-4 accent-emerald-500"
                  />
                </label>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {([
                ['defaultWebpQuality', 'Default WebP quality', 0.1, 1, 0.01],
                ['characterRefWebpQuality', 'Character reference quality', 0.1, 1, 0.01],
                ['rawSelectedFileLimitMB', 'Raw selected file limit', 1, 50, 1],
                ['finalUploadLimitMB', 'Final upload limit', 1, 20, 1],
                ['maxLandscapeWidth', 'Max landscape width', 320, 4096, 1],
                ['maxLandscapeHeight', 'Max landscape height', 320, 4096, 1],
                ['maxVerticalWidth', 'Max vertical width', 320, 4096, 1],
                ['maxVerticalHeight', 'Max vertical height', 320, 4096, 1],
                ['maxCharacterRefDimension', 'Max character ref dimension', 512, 4096, 1],
              ] as const).map(([key, label, min, max, step]) => (
                <div key={key} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                  <p className="text-sm font-medium text-neutral-100 mb-2">{label}</p>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={imageUploadDraft[key]}
                    onChange={(event) => updateImageUploadDraft({ [key]: Number(event.target.value) })}
                    className="w-32 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-xs leading-relaxed text-neutral-400">
                Output format is WebP. Character references use higher quality and are only resized when they exceed the configured dimension.
              </p>
              <div className="flex items-center gap-3">
                {imageUploadHasUnsavedChanges && <span className="text-xs text-amber-400">Unsaved</span>}
                <button
                  onClick={handleImageUploadSettingsSave}
                  disabled={imageUploadSaving || !imageUploadHasUnsavedChanges}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {imageUploadSaving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                </button>
              </div>
            </div>

            {imageUploadMessage && (
              <div className="rounded-xl border border-white/10 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-300">
                {imageUploadMessage}
              </div>
            )}
          </div>
          )}

          {section === 'video-export' && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Video Export</h2>
            <p className="text-xs text-neutral-400 -mt-2">
              Master toggle for storyline video download. When enabled, per-plan access is controlled via the Downloads toggle in Pricing Studio, and plan-specific watermark and vertical export presets are managed there too.
            </p>

            <ToggleRow
              label="Enable Video Download"
              description="Allow users to export published storylines as MP4 video files. Which plans can download is set in Pricing → Plans → Downloads, and export branding is configured per plan in Pricing Studio."
              checked={videoDownloadEnabled}
              toggling={videoDownloadToggling}
              onToggle={async () => {
                setVideoDownloadToggling(true);
                const next = !videoDownloadEnabled;
                try {
                  await setVideoDownload(next);
                  setVideoDownloadEnabledState(next);
                } finally {
                  setVideoDownloadToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Admin Bypass (your account only)"
              description="Skip the plan-level paywall for your admin account so you can test video export without needing a Plus/Studio subscription. Other users are unaffected."
              checked={videoDownloadAdminBypass}
              toggling={videoDownloadAdminBypassToggling}
              onToggle={async () => {
                setVideoDownloadAdminBypassToggling(true);
                const next = !videoDownloadAdminBypass;
                try {
                  await setVideoDownloadAdminBypass(next);
                  setVideoDownloadAdminBypassState(next);
                } finally {
                  setVideoDownloadAdminBypassToggling(false);
                }
              }}
            />
          </div>
          )}

          {section === 'generation' && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Generation Timeouts</h2>
            <p className="text-xs text-neutral-400 -mt-2">All values in seconds. Changes take effect on the next generation call.</p>

            <ToggleRow
              label="Optimized Mobile Saves"
              description="After successful save, use signed storage URLs locally so previous beat images are not re-uploaded."
              checked={storyAssetSignedUrlSwapEnabled}
              toggling={storyAssetSignedUrlSwapToggling}
              onToggle={async () => {
                setStoryAssetSignedUrlSwapToggling(true);
                const next = !storyAssetSignedUrlSwapEnabled;
                try {
                  await setStoryAssetSignedUrlSwap(next);
                  setStoryAssetSignedUrlSwapEnabledState(next);
                } finally {
                  setStoryAssetSignedUrlSwapToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Incremental Beat Asset Sync"
              description="Save beat media independently and upload generated beat images in the background."
              checked={storyIncrementalAssetSyncEnabled}
              toggling={storyIncrementalAssetSyncToggling}
              onToggle={async () => {
                setStoryIncrementalAssetSyncToggling(true);
                const next = !storyIncrementalAssetSyncEnabled;
                try {
                  await setStoryIncrementalAssetSync(next);
                  setStoryIncrementalAssetSyncEnabledState(next);
                } finally {
                  setStoryIncrementalAssetSyncToggling(false);
                }
              }}
            />

            <ToggleRow
              label="Pause Beat Uploads During Generation"
              description="Temporarily pause background beat image uploads while a new beat is generating."
              checked={storyAssetUploadPauseDuringGenerationEnabled}
              toggling={storyAssetUploadPauseDuringGenerationToggling}
              onToggle={async () => {
                setStoryAssetUploadPauseDuringGenerationToggling(true);
                const next = !storyAssetUploadPauseDuringGenerationEnabled;
                try {
                  await setStoryAssetUploadPauseDuringGeneration(next);
                  setStoryAssetUploadPauseDuringGenerationEnabledState(next);
                } finally {
                  setStoryAssetUploadPauseDuringGenerationToggling(false);
                }
              }}
            />

            {([
              { label: 'Text / Story', description: 'Max wait for a story beat (JSON) from Gemini.', value: textTimeoutMs, input: textTimeoutInput, setInput: setTextTimeoutInput, saving: textTimeoutSaving, setSaving: setTextTimeoutSaving, setter: setTextTimeout, setMs: setTextTimeoutMs, min: 5, defaultSec: 30 },
              { label: 'Image', description: 'Max wait for image generation from Gemini.', value: imageTimeoutMs, input: imageTimeoutInput, setInput: setImageTimeoutInput, saving: imageTimeoutSaving, setSaving: setImageTimeoutSaving, setter: setImageTimeout, setMs: setImageTimeoutMs, min: 10, defaultSec: 90 },
              { label: 'Audio / TTS', description: 'Max wait for text-to-speech narration from Gemini.', value: ttsTimeoutMs, input: ttsTimeoutInput, setInput: setTtsTimeoutInput, saving: ttsTimeoutSaving, setSaving: setTtsTimeoutSaving, setter: setTtsTimeout, setMs: setTtsTimeoutMs, min: 10, defaultSec: 120 },
              { label: 'Cloud Save Guard', description: 'Max wait before marking a slow save as retry queued.', value: cloudSaveTimeoutMs, input: cloudSaveTimeoutInput, setInput: setCloudSaveTimeoutInput, saving: cloudSaveTimeoutSaving, setSaving: setCloudSaveTimeoutSaving, setter: setCloudSaveTimeout, setMs: setCloudSaveTimeoutMs, min: 5, defaultSec: 20 },
              { label: 'Beat Asset Sync Warning', description: 'How long to wait before showing that beat media is still syncing in the background.', value: storyAssetSyncWarningTimeoutMs, input: storyAssetSyncWarningTimeoutInput, setInput: setStoryAssetSyncWarningTimeoutInput, saving: storyAssetSyncWarningTimeoutSaving, setSaving: setStoryAssetSyncWarningTimeoutSaving, setter: setStoryAssetSyncWarningTimeout, setMs: setStoryAssetSyncWarningTimeoutMs, min: 1, defaultSec: 15 },
            ] as const).map(({ label, description, value, input, setInput, saving, setSaving, setter, setMs, min, defaultSec }) => {
              const parsed = parseInt(input, 10);
              const currentSec = Math.round(value / 1000);
              return (
                <div key={label} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                  <p className="text-sm font-medium text-neutral-100 mb-1">{label}</p>
                  <p className="text-xs text-neutral-400 mb-3">{description} Default: {defaultSec}s.</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={min}
                      step={5}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      placeholder={String(defaultSec)}
                    />
                    <span className="text-xs text-neutral-500">s</span>
                    <button
                      onClick={() => handleTimeoutSave(input, min, setter, setMs, setSaving)}
                      disabled={saving || !Number.isFinite(parsed) || parsed < min}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                    </button>
                    {currentSec !== parsed && parsed >= min && (
                      <span className="text-xs text-amber-400">Unsaved</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </div>
      )}
    </div>
  );
}
