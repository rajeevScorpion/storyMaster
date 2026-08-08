'use client';

import { useState } from 'react';

export default function BackfillPage() {
  const [coverStatus, setCoverStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [coverResult, setCoverResult] = useState<string>('');
  const [beatStatus, setBeatStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [beatResult, setBeatResult] = useState<string>('');
  const [introStatus, setIntroStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [introResult, setIntroResult] = useState<string>('');

  const runCoverBackfill = async () => {
    setCoverStatus('running');
    try {
      const res = await fetch('/api/admin/backfill-covers', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setCoverResult(JSON.stringify(data, null, 2));
      setCoverStatus('done');
    } catch (err: any) {
      setCoverResult(err.message);
      setCoverStatus('error');
    }
  };

  const runBeatImageRepair = async () => {
    setBeatStatus('running');
    try {
      const res = await fetch('/api/admin/backfill-beat-image-urls', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setBeatResult(JSON.stringify(data, null, 2));
      setBeatStatus('done');
    } catch (err: any) {
      setBeatResult(err.message);
      setBeatStatus('error');
    }
  };

  const runDiscoveryIntroBackfill = async () => {
    setIntroStatus('running');
    try {
      const res = await fetch('/api/admin/backfill-discovery', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setIntroResult(JSON.stringify(data, null, 2));
      setIntroStatus('done');
    } catch (err: any) {
      setIntroResult(err.message);
      setIntroStatus('error');
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-serif">Admin Backfills</h1>
          <p className="text-sm text-neutral-400">
            Run targeted repairs for persisted story assets and public cover images.
          </p>
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div>
            <h2 className="text-lg font-medium text-neutral-100">Repair Missing Beat Image URLs</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Repairs beats marked ready when the storage object exists but the durable `image_url` was not written.
            </p>
          </div>
          <button
            onClick={runBeatImageRepair}
            disabled={beatStatus === 'running'}
            className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/20 px-4 py-3 text-emerald-300 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {beatStatus === 'running' ? 'Repairing...' : 'Run Beat Image Repair'}
          </button>
          {beatResult && (
            <pre className={`rounded-xl p-4 text-sm whitespace-pre-wrap ${beatStatus === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-black/30 text-neutral-300'}`}>
              {beatResult}
            </pre>
          )}
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div>
            <h2 className="text-lg font-medium text-neutral-100">Repair Social Share Covers</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Processes existing beat/default images into dedicated 1200x630 public share covers for published storylines.
            </p>
          </div>
          <button
            onClick={runCoverBackfill}
            disabled={coverStatus === 'running'}
            className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/20 px-4 py-3 text-emerald-300 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {coverStatus === 'running' ? 'Running...' : 'Run Share Cover Repair'}
          </button>
          {coverResult && (
            <pre className={`rounded-xl p-4 text-sm whitespace-pre-wrap ${coverStatus === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-black/30 text-neutral-300'}`}>
              {coverResult}
            </pre>
          )}
        </div>

        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div>
            <h2 className="text-lg font-medium text-neutral-100">Generate Gallery Introductions</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Writes the short catalogue intro for up to 25 published storylines that have never been
              processed. Each row costs one model call; run it repeatedly to work through the backlog.
              Storylines without an intro still show a derived excerpt, so this is optional polish.
            </p>
          </div>
          <button
            onClick={runDiscoveryIntroBackfill}
            disabled={introStatus === 'running'}
            className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/20 px-4 py-3 text-emerald-300 transition-colors hover:bg-emerald-500/30 disabled:opacity-50"
          >
            {introStatus === 'running' ? 'Generating...' : 'Generate Introductions (25)'}
          </button>
          {introResult && (
            <pre className={`rounded-xl p-4 text-sm whitespace-pre-wrap ${introStatus === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-black/30 text-neutral-300'}`}>
              {introResult}
            </pre>
          )}
        </div>
      </section>
    </div>
  );
}
