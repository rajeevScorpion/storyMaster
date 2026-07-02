'use client';

import { useState } from 'react';
import { saveImageBatchScopeAdmin } from '@/app/actions/image-batch-admin';
import {
  IMAGE_BATCH_SCOPES,
  type ImageBatchScope,
  type ImageBatchScopeSettings,
} from '@/lib/ai/image-batch.shared';

const SCOPE_LABELS: Record<ImageBatchScope, { label: string; description: string }> = {
  path_to_completion: {
    label: 'Path to completion',
    description: 'Beats on complete root→ending path(s) that currently exist. Recommended default.',
  },
  all_existing: {
    label: 'All existing beats',
    description: 'Every beat currently in the story map.',
  },
  current_path: {
    label: 'Current path only',
    description: 'Only the linear path from the root to the current beat.',
  },
  expand_branches: {
    label: 'Expand branches',
    description: 'Existing beats plus eagerly generated unvisited branches. Cost grows quickly.',
  },
};

export default function ImageBatchScopeSettings({ initial }: { initial: ImageBatchScopeSettings }) {
  const [defaultScope, setDefaultScope] = useState<ImageBatchScope>(initial.defaultScope);
  const [allowExpandBranches, setAllowExpandBranches] = useState(initial.allowExpandBranches);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectableScopes = IMAGE_BATCH_SCOPES.filter(
    (scope) => scope !== 'expand_branches' || allowExpandBranches
  );

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveImageBatchScopeAdmin({ defaultScope, allowExpandBranches });
      setDefaultScope(saved.defaultScope);
      setAllowExpandBranches(saved.allowExpandBranches);
      setMessage('Saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-serif text-neutral-100">Batch visuals</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Default scope for background image generation (the &ldquo;Create visuals&rdquo; action).
        </p>
      </div>

      <div className="space-y-2">
        {selectableScopes.map((scope) => (
          <label
            key={scope}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
              defaultScope === scope
                ? 'border-emerald-400/50 bg-emerald-500/10'
                : 'border-white/10 bg-neutral-900/60 hover:bg-white/5'
            }`}
          >
            <input
              type="radio"
              name="defaultScope"
              checked={defaultScope === scope}
              onChange={() => setDefaultScope(scope)}
              className="mt-1 accent-emerald-500"
            />
            <span>
              <span className="block text-sm text-neutral-100">{SCOPE_LABELS[scope].label}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">{SCOPE_LABELS[scope].description}</span>
            </span>
          </label>
        ))}
      </div>

      <label className="flex items-center gap-3 text-sm text-neutral-200">
        <input
          type="checkbox"
          checked={allowExpandBranches}
          onChange={(e) => {
            const next = e.target.checked;
            setAllowExpandBranches(next);
            if (!next && defaultScope === 'expand_branches') setDefaultScope('path_to_completion');
          }}
          className="accent-emerald-500"
        />
        Allow the &ldquo;Expand branches&rdquo; scope (cost grows with tree depth)
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 transition-colors hover:bg-emerald-500/30 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message && <span className="text-xs text-neutral-400">{message}</span>}
      </div>
    </div>
  );
}
