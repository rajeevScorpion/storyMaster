'use client';

import { useEffect, useState } from 'react';
import { Wind } from 'lucide-react';
import {
  listReelMoodsForAdminAction,
  publishReelMoodAction,
  saveReelMoodAction,
  setReelMoodStatusAction,
} from '@/app/actions/reel-moods';
import { slugifyMoodName } from '@/lib/reel/moods';
import type { ReelMoodRecord } from '@/lib/reel/moods';

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
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

export default function MoodStudioPage() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [promptDefiner, setPromptDefiner] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [moods, setMoods] = useState<ReelMoodRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const promptWords = wordCount(promptDefiner);
  const promptOverLimit = promptWords > 150;

  useEffect(() => {
    setIsLoading(true);
    listReelMoodsForAdminAction()
      .then(setMoods)
      .catch(() => setMoods([]))
      .finally(() => setIsLoading(false));
  }, []);

  const refreshMoods = async () => {
    const updated = await listReelMoodsForAdminAction().catch(() => moods);
    setMoods(updated);
  };

  const handleSave = async () => {
    if (!name.trim() || !promptDefiner.trim() || promptOverLimit || isSaving) return;
    setIsSaving(true);
    setSaveMessage(null);
    try {
      await saveReelMoodAction({ name: name.trim(), slug: slug.trim() || undefined, promptDefiner: promptDefiner.trim(), sortOrder });
      setSaveMessage('Saved as draft.');
      setName('');
      setSlug('');
      setPromptDefiner('');
      setSortOrder(0);
      await refreshMoods();
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Failed to save mood.');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async (id: string) => {
    setActionMessage(null);
    try {
      await publishReelMoodAction(id);
      await refreshMoods();
    } catch (err: unknown) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to publish mood.');
    }
  };

  const handleSetStatus = async (id: string, status: 'draft' | 'archived') => {
    setActionMessage(null);
    try {
      await setReelMoodStatusAction(id, status);
      await refreshMoods();
    } catch (err: unknown) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to update mood status.');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Wind className="h-6 w-6 text-indigo-400" />
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Mood Studio</h1>
          <p className="text-sm text-neutral-400">Create and publish image atmosphere moods (≤150 words each).</p>
        </div>
      </div>

      {/* Create form */}
      <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-5 space-y-4">
        <h2 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Create / Edit Mood</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs text-neutral-500 uppercase tracking-wider">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slug || slug === slugifyMoodName(name)) {
                  setSlug(slugifyMoodName(e.target.value));
                }
              }}
              placeholder="Golden Hour"
              className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:border-indigo-500/50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500 uppercase tracking-wider">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="golden_hour"
              className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-500 outline-none focus:border-indigo-500/50"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500 uppercase tracking-wider">Sort Order</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
            />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-neutral-500 uppercase tracking-wider">Prompt Definer</label>
            <span className={`text-xs ${promptOverLimit ? 'text-rose-400' : 'text-neutral-500'}`}>
              {promptWords} / 150 words
            </span>
          </div>
          <textarea
            value={promptDefiner}
            onChange={(e) => setPromptDefiner(e.target.value)}
            rows={5}
            placeholder="Describe the emotional atmosphere and lighting in plain text. This text is injected directly into the image prompt to set the mood. Example: warm golden-hour sunlight filtering through leaves, soft amber haze, dreamlike glow..."
            className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none transition-colors focus:border-indigo-500/50 resize-none"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!name.trim() || !promptDefiner.trim() || promptOverLimit || isSaving}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
            Save draft
          </button>
          {saveMessage && (
            <p className={`text-sm ${saveMessage.startsWith('Saved') ? 'text-emerald-400' : 'text-rose-400'}`}>
              {saveMessage}
            </p>
          )}
        </div>
      </div>

      {/* Existing moods table */}
      <div className="rounded-2xl border border-white/10 bg-neutral-900/60 p-5 space-y-4">
        <h2 className="text-sm font-medium text-neutral-300 uppercase tracking-wider">Existing Moods</h2>
        {actionMessage && <p className="text-sm text-rose-400">{actionMessage}</p>}
        {isLoading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : moods.length === 0 ? (
          <p className="text-sm text-neutral-500">No moods yet. Create your first mood above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-neutral-500">
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Slug</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Words</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {moods.map((mood) => (
                  <tr key={mood.id}>
                    <td className="py-3 pr-4 font-medium text-neutral-200">{mood.name}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-neutral-400">{mood.slug}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={mood.status} />
                    </td>
                    <td className="py-3 pr-4 text-neutral-400">{wordCount(mood.promptDefiner)}</td>
                    <td className="py-3">
                      <div className="flex gap-2">
                        {mood.status !== 'published' && (
                          <button
                            type="button"
                            onClick={() => void handlePublish(mood.id)}
                            className="rounded-lg bg-emerald-600/20 px-3 py-1 text-xs text-emerald-300 transition-colors hover:bg-emerald-600/30"
                          >
                            Publish
                          </button>
                        )}
                        {mood.status === 'published' && (
                          <button
                            type="button"
                            onClick={() => void handleSetStatus(mood.id, 'draft')}
                            className="rounded-lg bg-neutral-700/60 px-3 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-700"
                          >
                            Unpublish
                          </button>
                        )}
                        {mood.status !== 'archived' && (
                          <button
                            type="button"
                            onClick={() => void handleSetStatus(mood.id, 'archived')}
                            className="rounded-lg bg-red-500/10 px-3 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/20"
                          >
                            Archive
                          </button>
                        )}
                        {mood.status === 'archived' && (
                          <button
                            type="button"
                            onClick={() => void handleSetStatus(mood.id, 'draft')}
                            className="rounded-lg bg-neutral-700/60 px-3 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-700"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
