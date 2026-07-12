'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';

import {
  getMediaPipelineAdminState,
  setBeatBundleEnabled,
  setMediaCanaryUserIds,
  setMediaProcessingMode,
} from '@/app/actions/admin-media-pipeline';
import type {
  MediaPipelineAdminState,
  MediaProcessingMode,
} from '@/lib/media/media-pipeline-settings';

const MODE_OPTIONS: { mode: MediaProcessingMode; label: string; description: string }[] = [
  {
    mode: 'client_legacy',
    label: 'Legacy client-side processing',
    description: 'Current production behavior: browser receives image data, compresses, and uploads via the existing cloud save path.',
  },
  {
    mode: 'server_pipeline',
    label: 'Server-side durable processing',
    description: 'New pipeline: durable job, background worker, private R2 original, server-side variants. Browser can close after starting generation.',
  },
  {
    mode: 'hybrid_canary',
    label: 'Hybrid canary rollout',
    description: 'Only the allowlisted user IDs below use server-side processing; everyone else stays on the legacy client flow.',
  },
];

const SERVER_MODE_WARNING =
  'Server-side durable processing is a new media pipeline. Existing stories will remain unchanged. '
  + 'This setting affects new generation jobs only. You can switch back to legacy client-side processing if needed.';

export default function MediaProcessingModeCard() {
  const [state, setState] = useState<MediaPipelineAdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingMode, setPendingMode] = useState<MediaProcessingMode | null>(null);
  const [canaryDraft, setCanaryDraft] = useState('');
  const [canarySaving, setCanarySaving] = useState(false);
  const [bundleSaving, setBundleSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMediaPipelineAdminState()
      .then((next) => {
        if (cancelled) return;
        setState(next);
        setCanaryDraft(next.canaryUserIds.join('\n'));
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Failed to load processing mode');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyMode = async (mode: MediaProcessingMode) => {
    setSaving(true);
    setMessage(null);
    try {
      const next = await setMediaProcessingMode(mode);
      setState(next);
      setPendingMode(null);
      setMessage(`Image processing mode set to ${mode}. New generation jobs use this mode immediately.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update processing mode');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectMode = (mode: MediaProcessingMode) => {
    if (!state || saving || mode === state.mode) return;
    if (mode !== 'client_legacy') {
      // Enabling server processing gets an explicit confirm step.
      setPendingMode(mode);
      setMessage(null);
      return;
    }
    void applyMode(mode);
  };

  const handleBundleToggle = async () => {
    if (!state || bundleSaving) return;
    setBundleSaving(true);
    setMessage(null);
    try {
      const next = await setBeatBundleEnabled(!state.beatBundleEnabled);
      setState(next);
      setMessage(next.beatBundleEnabled
        ? 'Beat bundle flow enabled. New beats from server_pipeline users use the two-call flow immediately.'
        : 'Beat bundle flow disabled. All beat generation is back on the legacy flow.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update beat bundle flag');
    } finally {
      setBundleSaving(false);
    }
  };

  const handleCanarySave = async () => {
    setCanarySaving(true);
    setMessage(null);
    try {
      const ids = canaryDraft.split(/[\n,]/).map((id) => id.trim()).filter(Boolean);
      const next = await setMediaCanaryUserIds(ids);
      setState(next);
      setCanaryDraft(next.canaryUserIds.join('\n'));
      setMessage(`Canary allowlist saved (${next.canaryUserIds.length} user${next.canaryUserIds.length === 1 ? '' : 's'}).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save canary allowlist');
    } finally {
      setCanarySaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 size={14} className="animate-spin" /> Loading image processing mode…
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-amber-300">
        {message ?? 'Failed to load image processing mode.'}
      </div>
    );
  }

  const serverDisabled = !state.serverPipelineAvailable;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Image Processing Mode</h2>
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
          Active: {state.mode}
        </span>
      </div>
      <p className="text-xs text-neutral-400 -mt-2">
        Controls how new image generation jobs are processed. Existing stories and media always render from the assets already saved for them.
      </p>

      <div className="grid gap-3">
        {MODE_OPTIONS.map((option) => {
          const disabled = saving || (option.mode !== 'client_legacy' && serverDisabled);
          const selected = state.mode === option.mode;
          return (
            <button
              key={option.mode}
              onClick={() => handleSelectMode(option.mode)}
              disabled={disabled}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                selected
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : 'border-white/10 bg-neutral-900/60 hover:border-white/20'
              } ${disabled && !selected ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <span className={`block text-sm font-medium ${selected ? 'text-emerald-200' : 'text-neutral-100'}`}>
                {option.label}
              </span>
              <span className="mt-1 block text-xs text-neutral-400">{option.description}</span>
            </button>
          );
        })}
      </div>

      {serverDisabled && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <span>
            Server-side modes are unavailable: {state.serverPipelineUnavailableReason ?? 'R2 is not configured'}.
            New jobs stay on the legacy client flow.
          </span>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-neutral-900/60 p-4">
        <div>
          <p className="text-sm font-medium text-neutral-100">Beat bundle flow (two-call generation)</p>
          <p className="mt-1 text-xs text-neutral-400">
            Collapses beat generation into two server calls (core text + visuals) with the image delivered by the
            job worker. Only applies to users whose effective processing mode is server_pipeline — everyone else
            stays on the legacy flow. Turning this off is the instant kill switch (no redeploy).
          </p>
          {state.beatBundleEnabled && state.mode === 'client_legacy' && (
            <p className="mt-2 text-xs text-amber-300">
              The active mode is client_legacy, so no user currently qualifies — the flag has no effect until a
              server-side mode is enabled above.
            </p>
          )}
        </div>
        <button
          onClick={() => void handleBundleToggle()}
          disabled={bundleSaving || (serverDisabled && !state.beatBundleEnabled)}
          className={`shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${
            state.beatBundleEnabled
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
              : 'border-white/10 bg-neutral-800 text-neutral-300 hover:border-white/20'
          } ${bundleSaving || (serverDisabled && !state.beatBundleEnabled) ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {bundleSaving
            ? <Loader2 size={12} className="animate-spin" />
            : state.beatBundleEnabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      {pendingMode && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-xs leading-relaxed text-amber-100">{SERVER_MODE_WARNING}</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void applyMode(pendingMode)}
              disabled={saving}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-medium text-neutral-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : `Enable ${pendingMode}`}
            </button>
            <button
              onClick={() => setPendingMode(null)}
              disabled={saving}
              className="rounded-lg border border-white/10 px-4 py-2 text-xs text-neutral-300 transition-colors hover:border-white/20"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.mode === 'hybrid_canary' && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <p className="text-sm font-medium text-neutral-100">Canary user IDs</p>
          <p className="text-xs text-neutral-400">
            One user UUID per line (or comma separated). Only these users are routed to server-side processing.
          </p>
          <textarea
            value={canaryDraft}
            onChange={(event) => setCanaryDraft(event.target.value)}
            rows={3}
            spellCheck={false}
            className="w-full rounded-lg border border-white/10 bg-neutral-800 px-3 py-2 font-mono text-xs text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            placeholder="00000000-0000-0000-0000-000000000000"
          />
          <button
            onClick={() => void handleCanarySave()}
            disabled={canarySaving}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {canarySaving ? <Loader2 size={12} className="animate-spin" /> : 'Save allowlist'}
          </button>
        </div>
      )}

      {message && !pendingMode && (
        <div className="rounded-xl border border-white/10 bg-neutral-900/60 px-4 py-3 text-sm text-neutral-300">
          {message}
        </div>
      )}
    </div>
  );
}
