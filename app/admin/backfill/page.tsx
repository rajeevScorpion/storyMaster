'use client';

import { useState } from 'react';

export default function BackfillPage() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<string>('');

  const runBackfill = async () => {
    setStatus('running');
    try {
      const res = await fetch('/api/admin/backfill-covers', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setResult(JSON.stringify(data, null, 2));
      setStatus('done');
    } catch (err: any) {
      setResult(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-8">
      <div className="max-w-md w-full space-y-6">
        <h1 className="text-2xl font-serif">Backfill Missing Covers</h1>
        <p className="text-sm text-neutral-400">
          Copies beat images from story-assets to public-storylines for storylines and trees with missing thumbnails.
        </p>
        <button
          onClick={runBackfill}
          disabled={status === 'running'}
          className="w-full px-4 py-3 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-xl hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
        >
          {status === 'running' ? 'Running...' : 'Run Backfill'}
        </button>
        {result && (
          <pre className={`p-4 rounded-xl text-sm whitespace-pre-wrap ${status === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-white/5 text-neutral-300'}`}>
            {result}
          </pre>
        )}
      </div>
    </div>
  );
}
