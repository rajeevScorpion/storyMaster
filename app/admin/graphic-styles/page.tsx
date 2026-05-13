'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  ImageIcon,
  Loader2,
  Palette,
  RefreshCw,
  Save,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  extractGraphicStyleFromImageAction,
  generateGraphicStyleSampleAction,
  listReelVisualStylesForAdminAction,
  publishReelVisualStyleAction,
  saveReelVisualStyleFromPlaygroundAction,
  setReelVisualStyleStatusAction,
} from '@/app/actions/reel-styles';
import type { ReelVisualStyleRecord } from '@/lib/reel/styles';
import { compressImage } from '@/lib/utils/image';

type Tier = 'free' | 'paid';
type SampleMode = 'ai' | 'upload';

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    published: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    draft: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
    archived: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${colors[status] ?? colors.draft}`}>
      {status}
    </span>
  );
}

export default function GraphicStyleStudioPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sampleUploadRef = useRef<HTMLInputElement>(null);

  // Step 1 — reference image
  const [referenceDataUrl, setReferenceDataUrl] = useState<string | null>(null);
  const [referenceFileName, setReferenceFileName] = useState<string>('');

  // Step 2 — extracted prompt
  const [extractedPrompt, setExtractedPrompt] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);

  // Step 3 — sample image
  const [sampleMode, setSampleMode] = useState<SampleMode>('ai');
  const [sampleDataUrl, setSampleDataUrl] = useState<string | null>(null);
  const [sampleLatencyMs, setSampleLatencyMs] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Step 4 — save
  const [styleName, setStyleName] = useState('');
  const [styleSlug, setStyleSlug] = useState('');
  const [tier, setTier] = useState<Tier>('free');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Existing styles list
  const [existingStyles, setExistingStyles] = useState<ReelVisualStyleRecord[]>([]);
  const [isLoadingStyles, setIsLoadingStyles] = useState(true);

  // Error / info feedback
  const [error, setError] = useState<string | null>(null);

  const refreshStyles = useCallback(async () => {
    setIsLoadingStyles(true);
    try {
      setExistingStyles(await listReelVisualStylesForAdminAction());
    } finally {
      setIsLoadingStyles(false);
    }
  }, []);

  useEffect(() => {
    void refreshStyles();
  }, [refreshStyles]);

  // Auto-slug from name
  useEffect(() => {
    if (styleName && !styleSlug) {
      setStyleSlug(slugify(styleName));
    }
  }, [styleName, styleSlug]);

  const handleFileSelect = (file: File) => {
    setError(null);
    setReferenceFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      setReferenceDataUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDropZone = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFileSelect(file);
  };

  const handleSampleUpload = (file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const raw = e.target?.result as string;
      // Compress to max 1200×1200 at 0.92 quality so large uploads don't bloat R2
      try {
        const compressed = await compressImage(raw, 1200, 1200, 0.92);
        setSampleDataUrl(compressed);
      } catch {
        setSampleDataUrl(raw);
      }
      setSampleLatencyMs(null);
    };
    reader.readAsDataURL(file);
  };

  const handleExtract = async () => {
    if (!referenceDataUrl) return;
    setIsExtracting(true);
    setError(null);
    try {
      const { promptText } = await extractGraphicStyleFromImageAction({
        referenceImageDataUrl: referenceDataUrl,
      });
      setExtractedPrompt(promptText);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Style extraction failed');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleGenerateSample = async () => {
    if (!extractedPrompt.trim()) return;
    setIsGenerating(true);
    setSampleDataUrl(null);
    setSampleLatencyMs(null);
    setError(null);
    const t0 = Date.now();
    try {
      const { imageDataUrl } = await generateGraphicStyleSampleAction({
        styleName,
        promptDefiner: extractedPrompt,
      });
      setSampleDataUrl(imageDataUrl);
      setSampleLatencyMs(Date.now() - t0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sample generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!sampleDataUrl || !styleName.trim() || !extractedPrompt.trim()) return;
    setIsSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      const thumbnailDataUrl = await compressImage(sampleDataUrl, 256, 256, 0.85);
      const saved = await saveReelVisualStyleFromPlaygroundAction({
        name: styleName.trim(),
        slug: styleSlug.trim() || slugify(styleName),
        minPlan: tier === 'paid' ? 'plus' : 'free',
        promptDefiner: extractedPrompt.trim(),
        sampleImageDataUrl: sampleDataUrl,
        thumbnailDataUrl,
        noFaceDefault: true,
      });
      setSaveMessage(`Saved "${saved.name}" as draft.`);
      setStyleName('');
      setStyleSlug('');
      await refreshStyles();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async (id: string) => {
    setError(null);
    setSaveMessage(null);
    try {
      const style = await publishReelVisualStyleAction(id);
      setSaveMessage(`Published "${style.name}".`);
      await refreshStyles();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    }
  };

  const handleSetStatus = async (id: string, status: 'draft' | 'archived') => {
    setError(null);
    setSaveMessage(null);
    try {
      const style = await setReelVisualStyleStatusAction(id, status);
      setSaveMessage(`Moved "${style.name}" to ${status}.`);
      await refreshStyles();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const words = wordCount(extractedPrompt);
  const hasSample = Boolean(sampleDataUrl);
  const canGenerate = Boolean(extractedPrompt.trim()) && !isGenerating;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Palette size={22} className="text-emerald-400" />
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Graphic Style Studio</h1>
          <p className="mt-0.5 text-sm text-neutral-400">Create, refine, and publish visual style cards for reels.</p>
        </div>
      </div>

      {/* Global feedback */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-400" />
            <p className="text-sm text-red-300">{error}</p>
          </motion.div>
        )}
        {saveMessage && !error && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
            <CheckCircle size={15} className="mt-0.5 shrink-0 text-emerald-400" />
            <p className="text-sm text-emerald-200">{saveMessage}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Left column — authoring steps */}
        <div className="space-y-4">

          {/* Step 1 — Reference image */}
          <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-semibold text-emerald-300">1</span>
              <h2 className="text-sm font-medium text-neutral-100">Reference image</h2>
              <span className="text-xs text-neutral-600">optional — skip if you already have a style in mind</span>
            </div>

            <div
              onDrop={handleDropZone}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-neutral-900/40 py-8 transition-colors hover:border-white/25 hover:bg-neutral-800/30"
            >
              {referenceDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={referenceDataUrl} alt="" className="h-24 w-24 rounded-lg object-cover" />
              ) : (
                <Upload size={20} className="text-neutral-500" />
              )}
              <p className="text-xs text-neutral-500">
                {referenceFileName || 'Click or drag an inspiration image here'}
              </p>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />

            <button
              onClick={() => void handleExtract()}
              disabled={!referenceDataUrl || isExtracting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isExtracting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {isExtracting ? 'Extracting style…' : 'Extract style from image'}
            </button>
          </div>

          {/* Step 2 — Style prompt */}
          <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-semibold text-emerald-300">2</span>
                <h2 className="text-sm font-medium text-neutral-100">Style prompt</h2>
              </div>
              <span className={`text-xs ${words > 150 ? 'text-red-400' : 'text-neutral-500'}`}>
                {words}/150 words
              </span>
            </div>
            <p className="text-xs text-neutral-500">Edit the extracted prompt or write one from scratch. This becomes the visual style definer saved to users.</p>
            <textarea
              value={extractedPrompt}
              onChange={(e) => setExtractedPrompt(e.target.value)}
              rows={7}
              placeholder="e.g. Risograph print aesthetic — grainy ink texture, limited two-tone palette of teal and coral, bold geometric silhouettes, flat color fills with halftone grain overlays, expressive negative space, warm matte surface with subtle paper tooth..."
              className="w-full resize-none rounded-xl border border-white/10 bg-neutral-800 px-3 py-2.5 text-sm text-neutral-100 placeholder-neutral-600 focus:border-emerald-500/40 focus:outline-none"
            />
          </div>

          {/* Step 3 — Sample image */}
          <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-semibold text-emerald-300">3</span>
              <h2 className="text-sm font-medium text-neutral-100">Sample image</h2>
            </div>

            {/* Mode toggle */}
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 bg-neutral-800 text-sm">
              <button
                type="button"
                onClick={() => setSampleMode('ai')}
                className={`flex items-center justify-center gap-2 px-4 py-2 transition-colors ${sampleMode === 'ai' ? 'bg-indigo-500/25 text-white' : 'text-neutral-400 hover:bg-neutral-700/60'}`}
              >
                <Sparkles size={13} />
                AI generate
              </button>
              <button
                type="button"
                onClick={() => setSampleMode('upload')}
                className={`flex items-center justify-center gap-2 px-4 py-2 transition-colors ${sampleMode === 'upload' ? 'bg-indigo-500/25 text-white' : 'text-neutral-400 hover:bg-neutral-700/60'}`}
              >
                <Upload size={13} />
                Upload manually
              </button>
            </div>

            {sampleMode === 'ai' ? (
              <>
                <p className="text-xs text-neutral-500">Kissago generates a sample image using the style prompt above.</p>
                <button
                  onClick={() => void handleGenerateSample()}
                  disabled={!canGenerate}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />}
                  {isGenerating ? 'Generating sample…' : 'Generate sample'}
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-neutral-500">Generate an image externally using the style prompt above, then upload it here.</p>
                <div
                  onClick={() => sampleUploadRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-neutral-900/40 py-6 transition-colors hover:border-white/25 hover:bg-neutral-800/30"
                >
                  <Upload size={18} className="text-neutral-500" />
                  <p className="text-xs text-neutral-500">Click to upload sample image</p>
                </div>
                <input ref={sampleUploadRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSampleUpload(f); }} />
              </>
            )}

            {/* Sample preview — shown in both modes once an image is ready */}
            <AnimatePresence>
              {(hasSample || isGenerating) && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                  {hasSample && sampleDataUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={sampleDataUrl} alt="Style sample" className="w-full rounded-xl object-cover" />
                      <div className="flex items-center justify-between">
                        {sampleLatencyMs !== null ? (
                          <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                            <Clock size={12} />
                            {(sampleLatencyMs / 1000).toFixed(1)}s
                          </span>
                        ) : <span />}
                        {sampleMode === 'ai' && (
                          <button
                            onClick={() => void handleGenerateSample()}
                            disabled={isGenerating}
                            className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-50"
                          >
                            <RefreshCw size={12} />
                            Regenerate
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex h-48 items-center justify-center">
                      <Loader2 size={20} className="animate-spin text-neutral-500" />
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Step 4 — Save */}
          <AnimatePresence>
            {hasSample && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-semibold text-emerald-300">4</span>
                  <h2 className="text-sm font-medium text-neutral-100">Save &amp; publish</h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-500">Style name</label>
                    <input
                      value={styleName}
                      onChange={(e) => setStyleName(e.target.value)}
                      placeholder="e.g. Risograph Print"
                      className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-500/40 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-neutral-500">Slug (auto-fills)</label>
                    <input
                      value={styleSlug}
                      onChange={(e) => setStyleSlug(e.target.value)}
                      placeholder="risograph-print"
                      className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-emerald-500/40 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-neutral-500">Tier</label>
                  <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/10 bg-neutral-800 text-sm">
                    <button
                      type="button"
                      onClick={() => setTier('free')}
                      className={`px-4 py-2 transition-colors ${tier === 'free' ? 'bg-emerald-500/25 text-white' : 'text-neutral-400 hover:bg-neutral-700/60'}`}
                    >
                      Free
                    </button>
                    <button
                      type="button"
                      onClick={() => setTier('paid')}
                      className={`px-4 py-2 transition-colors ${tier === 'paid' ? 'bg-emerald-500/25 text-white' : 'text-neutral-400 hover:bg-neutral-700/60'}`}
                    >
                      Paid (Plus+)
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => void handleSaveDraft()}
                  disabled={isSaving || !styleName.trim() || !extractedPrompt.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {isSaving ? 'Saving…' : 'Save draft'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right column — existing styles */}
        <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-neutral-100">Existing styles</h2>
            <button
              onClick={() => void refreshStyles()}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5"
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>

          {isLoadingStyles ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 size={18} className="animate-spin text-neutral-500" />
            </div>
          ) : existingStyles.length === 0 ? (
            <p className="text-sm text-neutral-500">No saved styles yet. Create your first one on the left.</p>
          ) : (
            <div className="space-y-3">
              {existingStyles.map((style) => (
                <div key={style.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex gap-3">
                    {(style.thumbnailUrl ?? style.sampleImageUrl) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={style.thumbnailUrl ?? style.sampleImageUrl ?? ''}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="truncate text-sm font-medium text-neutral-100">{style.name}</p>
                        <StatusBadge status={style.status} />
                        <span className="text-xs text-neutral-600">{style.minPlan}</span>
                      </div>
                      <p className="text-xs text-neutral-600">/{style.slug}</p>
                      <p className="line-clamp-2 text-xs text-neutral-400">{style.promptDefiner}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {style.status !== 'published' && (
                      <button
                        onClick={() => void handlePublish(style.id)}
                        className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
                      >
                        Publish
                      </button>
                    )}
                    {style.status === 'published' && (
                      <button
                        onClick={() => void handleSetStatus(style.id, 'draft')}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10"
                      >
                        Move to draft
                      </button>
                    )}
                    {style.status !== 'archived' && (
                      <button
                        onClick={() => void handleSetStatus(style.id, 'archived')}
                        className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                      >
                        Archive
                      </button>
                    )}
                    {style.status === 'archived' && (
                      <button
                        onClick={() => void handleSetStatus(style.id, 'draft')}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10"
                      >
                        Restore to draft
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
