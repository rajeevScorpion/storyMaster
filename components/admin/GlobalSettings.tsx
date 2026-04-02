'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getGlobalSettings, setStoryboardMode } from '@/app/actions/admin';

export default function GlobalSettings() {
  const [loading, setLoading] = useState(true);
  const [storyboardEnabled, setStoryboardEnabled] = useState(false);
  const [storyboardToggling, setStoryboardToggling] = useState(false);

  useEffect(() => {
    getGlobalSettings().then(({ storyboardMode }) => {
      setStoryboardEnabled(storyboardMode);
      setLoading(false);
    });
  }, []);

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="mb-1 text-2xl text-neutral-100">Global Settings</h1>
      <p className="mb-8 text-sm text-neutral-400">Runtime feature flags that apply globally to all story generation. Premium-user scoping can be added later.</p>

      {loading ? (
        <div className="flex items-center gap-2 text-neutral-400"><Loader2 size={16} className="animate-spin" />Loading settings...</div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">Feature Flags</h2>
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-900/60 p-4">
            <div>
              <p className="text-sm font-medium text-neutral-100">Storyboard Mode</p>
              <p className="mt-0.5 text-xs text-neutral-400">Generate a 2×2 panel grid at 2K (16:9) per beat instead of a single 1K image. Panels cycle automatically in the story reader.</p>
            </div>
            <button
              onClick={async () => {
                setStoryboardToggling(true);
                const next = !storyboardEnabled;
                try {
                  await setStoryboardMode(next);
                  setStoryboardEnabled(next);
                } finally {
                  setStoryboardToggling(false);
                }
              }}
              disabled={storyboardToggling}
              className={`relative ml-6 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${storyboardEnabled ? 'bg-emerald-500' : 'bg-neutral-600'}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${storyboardEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
