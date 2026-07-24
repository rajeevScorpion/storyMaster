'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCcw } from 'lucide-react';
import {
  getPromptCompilerAdminState,
  setPromptCompilerMode,
} from '@/app/actions/admin-prompt-compiler';
import {
  IMAGE_PROMPT_COMPILER_MODES,
  IMAGE_PROMPT_COMPILER_MODE_LABELS,
  IMAGE_PROMPT_COMPILER_MODE_DESCRIPTIONS,
  promptReductionPct,
  type PromptCompilerAdminState,
  type PromptCompilerComparisonRow,
} from '@/lib/ai/prompt-compiler/admin-state.shared';
import type { ImagePromptCompilerMode } from '@/lib/ai/prompt-compiler/assemble.shared';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function ComparisonRow({ row }: { row: PromptCompilerComparisonRow }) {
  const [open, setOpen] = useState(false);
  const { meta } = row;
  const reduction = promptReductionPct(meta);
  return (
    <>
      <tr className="border-b border-white/5 align-top">
        <td className="px-3 py-2 text-xs text-neutral-400">{formatWhen(row.updatedAt)}</td>
        <td className="px-3 py-2 text-xs text-neutral-300">{row.beatNumber ?? '—'}</td>
        <td className="px-3 py-2">
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-neutral-200">
            {meta.engine}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-neutral-300">{meta.legacyChars.toLocaleString()}</td>
        <td className="px-3 py-2 text-xs text-neutral-300">{meta.compiledChars?.toLocaleString() ?? '—'}</td>
        <td className={`px-3 py-2 text-xs ${reduction > 0 ? 'text-emerald-300' : 'text-neutral-400'}`}>
          {meta.compiledChars ? `${reduction}%` : '—'}
        </td>
        <td className="px-3 py-2 text-xs text-neutral-300">{meta.compressionLevel ?? '—'}</td>
        <td className="px-3 py-2 text-xs text-amber-300">{(meta.warnings ?? []).length || ''}</td>
        <td className="px-3 py-2 text-right">
          {(meta.compiledPreview || meta.fallbackReason) && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-200 hover:bg-white/10"
            >
              {open ? 'Hide' : 'View'}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-white/5 bg-neutral-950/40">
          <td colSpan={9} className="px-3 py-3">
            {meta.fallbackReason && (
              <p className="mb-2 text-xs text-rose-300">Fallback reason: {meta.fallbackReason}</p>
            )}
            {(meta.warnings ?? []).length > 0 && (
              <p className="mb-2 text-xs text-amber-300">Warnings: {(meta.warnings ?? []).join(' · ')}</p>
            )}
            {meta.compiledPreview && (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-neutral-950 p-3 text-[11px] leading-relaxed text-neutral-300">
                {meta.compiledPreview}
              </pre>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function PromptCompilerSettingsPanel() {
  const [state, setState] = useState<PromptCompilerAdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState<ImagePromptCompilerMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await getPromptCompilerAdminState());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load prompt compiler settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const changeMode = async (mode: ImagePromptCompilerMode) => {
    setSavingMode(mode);
    setError(null);
    setMessage(null);
    try {
      const next = await setPromptCompilerMode(mode);
      setState(next);
      setMessage(`Mode set to "${IMAGE_PROMPT_COMPILER_MODE_LABELS[mode]}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update mode.');
    } finally {
      setSavingMode(null);
    }
  };

  const enabledModels = useMemo(() => (state?.models ?? []).filter((m) => m.enabled), [state]);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}
      {message && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</div>
      )}

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-serif text-neutral-100">Compiler mode</h2>
            <p className="mt-1 max-w-2xl text-sm text-neutral-400">
              Controls the image prompt compiler globally. Rollback = set to “Legacy only”. Applies to storyboard beats only.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>

        <div className="mt-4 grid gap-2">
          {IMAGE_PROMPT_COMPILER_MODES.map((mode) => {
            const active = state?.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => void changeMode(mode)}
                disabled={savingMode !== null || loading || active}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                  active
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-white/10 bg-neutral-900 hover:bg-white/5'
                } disabled:opacity-60`}
              >
                <span className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 rounded-full border ${active ? 'border-emerald-400 bg-emerald-400' : 'border-white/30'}`} />
                <span>
                  <span className="flex items-center gap-2 text-sm text-neutral-100">
                    {IMAGE_PROMPT_COMPILER_MODE_LABELS[mode]}
                    {savingMode === mode && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-300" />}
                  </span>
                  <span className="mt-0.5 block text-xs text-neutral-400">{IMAGE_PROMPT_COMPILER_MODE_DESCRIPTIONS[mode]}</span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-neutral-500">
          Per-model capability (enabled / budget / adapter) is edited in Admin → Image Models. The compiler runs only when the
          mode is non-legacy AND the model has the capability enabled.
          {state && (
            <> Currently enabled models: {enabledModels.length > 0 ? enabledModels.map((m) => m.displayName).join(', ') : 'none'}.</>
          )}
        </p>
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-lg font-serif text-neutral-100">Recent comparisons</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Most recent beats that recorded compiler diagnostics (legacy vs compiled prompt size, compression, warnings).
        </p>
        <div className="mt-4 overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-left text-neutral-500">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Beat</th>
                <th className="px-3 py-2 font-medium">Engine</th>
                <th className="px-3 py-2 font-medium">Legacy chars</th>
                <th className="px-3 py-2 font-medium">Compiled chars</th>
                <th className="px-3 py-2 font-medium">Reduction</th>
                <th className="px-3 py-2 font-medium">Compression</th>
                <th className="px-3 py-2 font-medium">Warnings</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(state?.comparisons ?? []).map((row) => (
                <ComparisonRow key={`${row.storyId}:${row.nodeId}:${row.updatedAt}`} row={row} />
              ))}
              {!loading && (state?.comparisons ?? []).length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-neutral-500">
                    No compiler diagnostics recorded yet. Set the mode to Shadow and generate a beat.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
