'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCcw } from 'lucide-react';

import MediaProcessingModeCard from '@/components/admin/MediaProcessingModeCard';
import {
  forceCleanupExpiredOriginals,
  getMediaPipelineAdminState,
  getMediaPipelineMetrics,
  requeueImageJob,
  saveMediaPipelineSettings,
  type MediaPipelineMetrics,
} from '@/app/actions/admin-media-pipeline';
import type { MediaPipelineSettings } from '@/lib/media/media-pipeline-settings';

type NumberField = {
  key: keyof MediaPipelineSettings;
  label: string;
  min: number;
  max: number;
  suffix?: string;
};

const RETENTION_FIELDS: NumberField[] = [
  { key: 'freeRetentionHours', label: 'Free original retention', min: 0, max: 720, suffix: 'hours' },
  { key: 'plusRetentionDays', label: 'Plus original retention', min: 1, max: 365, suffix: 'days' },
  { key: 'studioRetentionDays', label: 'Studio original retention', min: 1, max: 365, suffix: 'days' },
];

const VARIANT_FIELDS: NumberField[] = [
  { key: 'displayMaxWidth', label: 'Display max width', min: 480, max: 4096, suffix: 'px' },
  { key: 'displayWebpQuality', label: 'Display WebP quality', min: 40, max: 100 },
  { key: 'thumbnailMaxWidth', label: 'Thumbnail max width', min: 96, max: 1024, suffix: 'px' },
  { key: 'thumbnailWebpQuality', label: 'Thumbnail WebP quality', min: 40, max: 100 },
  { key: 'shareLowMaxWidth', label: 'Share (standard) max width', min: 480, max: 4096, suffix: 'px' },
  { key: 'shareHighMaxWidth', label: 'Share (high) max width', min: 480, max: 8192, suffix: 'px' },
  { key: 'shareHighQuality', label: 'Share (high) quality', min: 40, max: 100 },
];

const OPERATIONAL_FIELDS: NumberField[] = [
  { key: 'maxAttempts', label: 'Max job attempts', min: 1, max: 10 },
  { key: 'signedUrlTtlSeconds', label: 'Signed URL expiry', min: 60, max: 3600, suffix: 'sec' },
  { key: 'cleanupBatchSize', label: 'Cleanup batch size', min: 1, max: 1000 },
];

const TOGGLE_FIELDS: Array<{ key: keyof MediaPipelineSettings; label: string; description: string }> = [
  { key: 'serverPersistInlineImages', label: 'Server-persist inline images', description: 'Start/continue beat images are saved server-side (original + variants) instead of relying on the browser upload. Requires server processing mode.' },
  { key: 'variantsForBulkJobs', label: 'Variants for bulk workers', description: 'Batch and stateful bulk jobs also produce originals + variants (falls back to legacy upload on any failure).' },
  { key: 'cleanupEnabled', label: 'Retention cleanup', description: 'Scheduled deletion of expired originals (display variants are never touched).' },
  { key: 'publicPublishingEnabled', label: 'Public publishing', description: 'Allow users to publish storylines to the public gallery.' },
  { key: 'unlistedSharingEnabled', label: 'Unlisted sharing', description: 'Allow tokenized unlisted share links.' },
  { key: 'moderationRequiredForPublic', label: 'Moderation before public listing', description: 'New public storylines wait for review before appearing in gallery listings.' },
  { key: 'allowPlusHighQuality', label: 'Plus high-quality access', description: 'Plus plan can download HQ originals and publish in high quality.' },
  { key: 'allowStudioHighQuality', label: 'Studio high-quality access', description: 'Studio plan can download HQ originals and publish in high quality.' },
];

const RETENTION_KEYS: Array<keyof MediaPipelineSettings> = [
  'freeRetentionHours',
  'plusRetentionDays',
  'studioRetentionDays',
];

export default function MediaPipelineSettingsPanel() {
  const [settings, setSettings] = useState<MediaPipelineSettings | null>(null);
  const [draft, setDraft] = useState<MediaPipelineSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<MediaPipelineMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [requeueing, setRequeueing] = useState<string | null>(null);

  const refreshMetrics = () => {
    setMetricsLoading(true);
    getMediaPipelineMetrics()
      .then(setMetrics)
      .catch(() => setMetrics(null))
      .finally(() => setMetricsLoading(false));
  };

  useEffect(() => {
    getMediaPipelineAdminState()
      .then((state) => {
        setSettings(state.settings);
        setDraft(state.settings);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load settings'));
    refreshMetrics();
  }, []);

  const updateDraft = (partial: Partial<MediaPipelineSettings>) => {
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const hasChanges = Boolean(settings && draft && JSON.stringify(settings) !== JSON.stringify(draft));

  const handleSave = async () => {
    if (!draft || !settings) return;
    // Shrinking retention affects users' expected HQ access on FUTURE assets;
    // require an explicit confirmation (pack 10 safety rule).
    const retentionShrank = RETENTION_KEYS.some((key) => Number(draft[key]) < Number(settings[key]));
    if (retentionShrank) {
      const confirmed = window.confirm(
        'You are reducing an original-retention window. Existing assets keep their already-stamped expiry; new generations will retain originals for less time. Continue?'
      );
      if (!confirmed) return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const state = await saveMediaPipelineSettings(draft);
      setSettings(state.settings);
      setDraft(state.settings);
      setMessage('Media pipeline settings saved. Changes apply within ~60 seconds (no redeploy).');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleForceCleanup = async () => {
    setCleanupRunning(true);
    setMessage(null);
    try {
      const result = await forceCleanupExpiredOriginals();
      setMessage(`Cleanup done: ${result.deleted} original${result.deleted === 1 ? '' : 's'} deleted, ${result.failed} failed.`);
      refreshMetrics();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cleanup failed');
    } finally {
      setCleanupRunning(false);
    }
  };

  const handleRequeue = async (jobId: string) => {
    setRequeueing(jobId);
    try {
      const { requeued } = await requeueImageJob(jobId);
      setMessage(requeued ? 'Job requeued and worker kicked.' : 'Job could not be requeued (not in failed state).');
      refreshMetrics();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Requeue failed');
    } finally {
      setRequeueing(null);
    }
  };

  if (!draft) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-neutral-400">
        {message ?? (
          <span className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading media pipeline settings…
          </span>
        )}
      </div>
    );
  }

  const numberGroup = (title: string, fields: NumberField[]) => (
    <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
      <p className="mb-3 text-sm font-medium text-neutral-100">{title}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {fields.map((field) => (
          <label key={String(field.key)} className="flex items-center justify-between gap-3 text-sm text-neutral-300">
            <span>{field.label}</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                min={field.min}
                max={field.max}
                value={Number(draft[field.key])}
                onChange={(event) => updateDraft({ [field.key]: Number(event.target.value) } as Partial<MediaPipelineSettings>)}
                className="w-24 rounded-lg border border-white/10 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              {field.suffix && <span className="text-xs text-neutral-500">{field.suffix}</span>}
            </span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <MediaProcessingModeCard />

      <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Media Pipeline Settings</h2>
        <p className="-mt-2 text-xs text-neutral-400">
          Retention, variant, cleanup, and publishing controls for the server-side media pipeline. Values apply to new work only.
        </p>

        {numberGroup('Original retention', RETENTION_FIELDS)}
        {numberGroup('Variant output', VARIANT_FIELDS)}
        {numberGroup('Operational', OPERATIONAL_FIELDS)}

        <div className="grid gap-3 md:grid-cols-2">
          {TOGGLE_FIELDS.map((field) => (
            <label key={String(field.key)} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-neutral-900/60 p-4">
              <span>
                <span className="block text-sm text-neutral-100">{field.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-neutral-400">{field.description}</span>
              </span>
              <input
                type="checkbox"
                checked={Boolean(draft[field.key])}
                onChange={(event) => updateDraft({ [field.key]: event.target.checked } as Partial<MediaPipelineSettings>)}
                className="mt-1 h-4 w-4 shrink-0 accent-emerald-500"
              />
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {hasChanges && <span className="text-xs text-amber-400">Unsaved changes</span>}
          <button
            onClick={() => void handleSave()}
            disabled={saving || !hasChanges}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save settings'}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Pipeline Monitoring</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshMetrics}
              disabled={metricsLoading}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:border-white/20 disabled:opacity-50"
            >
              <RefreshCcw size={12} className={metricsLoading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              onClick={() => void handleForceCleanup()}
              disabled={cleanupRunning}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 transition-colors hover:border-amber-500/50 disabled:opacity-50"
            >
              {cleanupRunning ? <Loader2 size={12} className="animate-spin" /> : 'Force cleanup now'}
            </button>
          </div>
        </div>

        {metrics ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {([
                ['Jobs in flight', metrics.activeJobs],
                ['Failed (7d)', metrics.failedJobs7d],
                ['Ready (24h)', metrics.jobs24h.ready ?? 0],
                ['Ready (7d)', metrics.jobs7d.ready ?? 0],
                ['Originals expiring 24h', metrics.originalsExpiring24h],
                ['Originals expiring 7d', metrics.originalsExpiring7d],
                ['Originals stored', metrics.assetCountsByVariant.original ?? 0],
                ['Display variants', metrics.assetCountsByVariant.display ?? 0],
              ] as const).map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                  <p className="text-2xl font-semibold text-neutral-100">{value}</p>
                  <p className="mt-1 text-xs text-neutral-400">{label}</p>
                </div>
              ))}
            </div>

            {metrics.lastCleanup && (
              <p className="text-xs text-neutral-400">
                Last cleanup {new Date(metrics.lastCleanup.ranAt).toLocaleString()}: {metrics.lastCleanup.deleted} deleted, {metrics.lastCleanup.failed} failed.
              </p>
            )}

            {metrics.recentFailedJobs.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-neutral-900/60 p-4">
                <p className="mb-3 text-sm font-medium text-neutral-100">Recent failed jobs</p>
                <div className="space-y-2">
                  {metrics.recentFailedJobs.map((job) => (
                    <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-neutral-950/50 px-3 py-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-neutral-300" title={job.error ?? undefined}>
                        <span className="text-neutral-500">{new Date(job.updatedAt).toLocaleString()}</span>
                        {' · '}
                        {job.error ?? 'Unknown error'}
                        <span className="text-neutral-500"> · {job.attemptCount} attempt{job.attemptCount === 1 ? '' : 's'}</span>
                      </span>
                      <button
                        onClick={() => void handleRequeue(job.id)}
                        disabled={requeueing === job.id}
                        className="rounded-lg border border-white/10 px-2.5 py-1 text-neutral-200 transition-colors hover:border-emerald-400/50 hover:text-emerald-300 disabled:opacity-50"
                      >
                        {requeueing === job.id ? <Loader2 size={11} className="animate-spin" /> : 'Requeue'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-neutral-400">
            {metricsLoading ? 'Loading metrics…' : 'Metrics unavailable (are migrations 071/072 applied?).'}
          </p>
        )}
      </div>

      {message && (
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-300">
          {message}
        </div>
      )}
    </div>
  );
}
