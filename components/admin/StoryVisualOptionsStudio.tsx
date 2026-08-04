'use client';

import { useEffect, useMemo, useState } from 'react';
import { Archive, Loader2, Palette, Pencil, Plus, Save, Star, Trash2 } from 'lucide-react';
import {
  deleteStoryVisualOptionDraftAction,
  listStoryVisualOptionsForAdminAction,
  publishStoryVisualOptionAction,
  saveStoryVisualOptionAction,
  setDefaultStoryVisualOptionAction,
  setStoryVisualOptionStatusAction,
} from '@/app/actions/story-visual-options';
import {
  STORY_VISUAL_CATEGORIES,
  slugifyStoryVisualOption,
  type StoryVisualCategory,
  type StoryVisualOption,
} from '@/lib/ai/story-visual-options.shared';

const CATEGORY_LABELS: Record<StoryVisualCategory, string> = {
  style: 'Art styles',
  mood: 'Story moods',
  palette: 'Color & light',
  detail: 'Scene richness',
};

interface FormState {
  id?: string;
  category: StoryVisualCategory;
  key: string;
  label: string;
  description: string;
  visualPromptDefiner: string;
  narrativePromptDefiner: string;
  sortOrder: number;
}

const EMPTY_FORM: FormState = {
  category: 'style',
  key: '',
  label: '',
  description: '',
  visualPromptDefiner: '',
  narrativePromptDefiner: '',
  sortOrder: 0,
};

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function statusClassName(status: StoryVisualOption['status']): string {
  if (status === 'published') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'archived') return 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  return 'border-white/10 bg-neutral-800 text-neutral-400';
}

export default function StoryVisualOptionsStudio() {
  const [options, setOptions] = useState<StoryVisualOption[]>([]);
  const [activeCategory, setActiveCategory] = useState<StoryVisualCategory>('style');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setOptions(await listStoryVisualOptionsForAdminAction());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load story visual options.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const visibleOptions = useMemo(
    () => options
      .filter((option) => option.category === activeCategory)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [activeCategory, options]
  );

  const resetForm = (category = activeCategory) => {
    setForm({ ...EMPTY_FORM, category });
  };

  const runOptionAction = async (id: string, action: () => Promise<unknown>, success: string) => {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The option could not be updated.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveStoryVisualOptionAction(form);
      setMessage(`Saved “${saved.label}” as a draft.`);
      resetForm(form.category);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The option could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const editOption = (option: StoryVisualOption) => {
    setActiveCategory(option.category);
    setForm({
      id: option.id,
      category: option.category,
      key: option.key,
      label: option.label,
      description: option.description,
      visualPromptDefiner: option.visualPromptDefiner,
      narrativePromptDefiner: option.narrativePromptDefiner || '',
      sortOrder: option.sortOrder,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const visualWords = countWords(form.visualPromptDefiner);
  const narrativeWords = countWords(form.narrativePromptDefiner);
  const canSave = Boolean(
    form.label.trim()
    && form.description.trim()
    && form.visualPromptDefiner.trim()
    && visualWords <= 150
    && (form.category !== 'mood' || (form.narrativePromptDefiner.trim() && narrativeWords <= 150))
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center gap-3">
        <Palette className="h-6 w-6 text-emerald-400" />
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Story Visual Options</h1>
          <p className="text-sm text-neutral-400">Manage the text-only art style, mood, color, and scene-richness choices used by story creation.</p>
        </div>
      </div>

      {(message || error) && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
          {error || message}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-400">{form.id ? 'Edit option' : 'Add option'}</h2>
            <p className="mt-1 text-xs text-neutral-500">Saving an edit creates a draft. Publish it when the internal direction is ready.</p>
          </div>
          {form.id && (
            <button type="button" onClick={() => resetForm()} className="text-xs text-neutral-400 hover:text-white">
              Cancel edit
            </button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-wider text-neutral-500">Category</span>
            <select
              value={form.category}
              disabled={Boolean(form.id)}
              onChange={(event) => {
                const category = event.target.value as StoryVisualCategory;
                setForm((current) => ({ ...current, category, narrativePromptDefiner: category === 'mood' ? current.narrativePromptDefiner : '' }));
              }}
              className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-white disabled:opacity-60"
            >
              {STORY_VISUAL_CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-wider text-neutral-500">Label</span>
            <input
              value={form.label}
              onChange={(event) => setForm((current) => ({
                ...current,
                label: event.target.value,
                key: current.key && current.key !== slugifyStoryVisualOption(current.label)
                  ? current.key
                  : slugifyStoryVisualOption(event.target.value),
              }))}
              placeholder="Paper Cutout"
              className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-600"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-wider text-neutral-500">Stable key</span>
            <input
              value={form.key}
              disabled={Boolean(form.id)}
              onChange={(event) => setForm((current) => ({ ...current, key: slugifyStoryVisualOption(event.target.value) }))}
              placeholder="paper_cutout"
              className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 font-mono text-sm text-white placeholder-neutral-600 disabled:opacity-60"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-wider text-neutral-500">Sort order</span>
            <input
              type="number"
              value={form.sortOrder}
              onChange={(event) => setForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))}
              className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>

        <label className="mt-4 block space-y-1">
          <span className="text-xs uppercase tracking-wider text-neutral-500">User description</span>
          <input
            value={form.description}
            maxLength={240}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="Layered paper shapes with tactile edges and gentle shadows."
            className="w-full rounded-xl border border-white/10 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-600"
          />
        </label>

        <div className={`mt-4 grid gap-4 ${form.category === 'mood' ? 'lg:grid-cols-2' : ''}`}>
          <label className="space-y-1">
            <span className="flex items-center justify-between text-xs uppercase tracking-wider text-neutral-500">
              <span>Visual prompt definer</span><span className={visualWords > 150 ? 'text-rose-400' : ''}>{visualWords}/150 words</span>
            </span>
            <textarea
              rows={5}
              value={form.visualPromptDefiner}
              onChange={(event) => setForm((current) => ({ ...current, visualPromptDefiner: event.target.value }))}
              placeholder="Describe only how story-grounded content should look. Avoid adding subjects, props, weather, era, or plot events."
              className="w-full resize-none rounded-xl border border-white/10 bg-neutral-800 px-3 py-2.5 text-sm text-white placeholder-neutral-600"
            />
          </label>
          {form.category === 'mood' && (
            <label className="space-y-1">
              <span className="flex items-center justify-between text-xs uppercase tracking-wider text-neutral-500">
                <span>Narrative mood definer</span><span className={narrativeWords > 150 ? 'text-rose-400' : ''}>{narrativeWords}/150 words</span>
              </span>
              <textarea
                rows={5}
                value={form.narrativePromptDefiner}
                onChange={(event) => setForm((current) => ({ ...current, narrativePromptDefiner: event.target.value }))}
                placeholder="Describe pacing and emotional treatment without telling the writer to repeat the mood label."
                className="w-full resize-none rounded-xl border border-white/10 bg-neutral-800 px-3 py-2.5 text-sm text-white placeholder-neutral-600"
              />
            </label>
          )}
        </div>

        <button
          type="button"
          disabled={!canSave || saving}
          onClick={() => void handleSave()}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : form.id ? <Save size={14} /> : <Plus size={14} />}
          {form.id ? 'Save as draft' : 'Add draft'}
        </button>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="mb-4 flex flex-wrap gap-2">
          {STORY_VISUAL_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => {
                setActiveCategory(category);
                if (!form.id) setForm((current) => ({ ...current, category }));
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${activeCategory === category ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' : 'border-white/10 bg-neutral-900 text-neutral-400 hover:text-white'}`}
            >
              {CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-neutral-500"><Loader2 size={15} className="animate-spin" />Loading options…</div>
        ) : visibleOptions.length === 0 ? (
          <p className="py-8 text-sm text-neutral-500">No database options yet. Apply migration 085, then add or seed the first option.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="border-b border-white/10 text-xs uppercase tracking-wider text-neutral-500">
                <tr><th className="pb-3 pr-4">Option</th><th className="pb-3 pr-4">Description</th><th className="pb-3 pr-4">Status</th><th className="pb-3 pr-4">Order</th><th className="pb-3">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visibleOptions.map((option) => (
                  <tr key={option.id}>
                    <td className="py-4 pr-4">
                      <div className="flex items-center gap-2 font-medium text-neutral-100">
                        {option.label}{option.isDefault && <Star size={13} className="fill-amber-300 text-amber-300" aria-label="Default" />}
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-neutral-600">{option.key}</p>
                    </td>
                    <td className="max-w-md py-4 pr-4 text-xs leading-relaxed text-neutral-400">{option.description}</td>
                    <td className="py-4 pr-4"><span className={`rounded-full border px-2 py-1 text-[11px] ${statusClassName(option.status)}`}>{option.status}</span></td>
                    <td className="py-4 pr-4 text-neutral-400">{option.sortOrder}</td>
                    <td className="py-4">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => editOption(option)} className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/10"><Pencil size={12} />Edit</button>
                        {option.status !== 'published' && <button type="button" disabled={busyId === option.id} onClick={() => void runOptionAction(option.id, () => publishStoryVisualOptionAction(option.id), `Published “${option.label}”.`)} className="rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50">Publish</button>}
                        {option.status === 'published' && !option.isDefault && <button type="button" disabled={busyId === option.id} onClick={() => void runOptionAction(option.id, () => setDefaultStoryVisualOptionAction(option.id), `Set “${option.label}” as the default.`)} className="inline-flex items-center gap-1 rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"><Star size={12} />Default</button>}
                        {option.status === 'published' && <button type="button" disabled={busyId === option.id || option.isDefault} title={option.isDefault ? 'Choose another default first' : undefined} onClick={() => void runOptionAction(option.id, () => setStoryVisualOptionStatusAction(option.id, 'archived'), `Archived “${option.label}”.`)} className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"><Archive size={12} />Archive</button>}
                        {option.status === 'archived' && <button type="button" disabled={busyId === option.id} onClick={() => void runOptionAction(option.id, () => setStoryVisualOptionStatusAction(option.id, 'draft'), `Restored “${option.label}” to drafts.`)} className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/10 disabled:opacity-50">Restore</button>}
                        {option.status === 'draft' && <button type="button" disabled={busyId === option.id} onClick={() => { if (window.confirm(`Permanently delete the draft “${option.label}”?`)) void runOptionAction(option.id, () => deleteStoryVisualOptionDraftAction(option.id), `Deleted draft “${option.label}”.`); }} className="inline-flex items-center gap-1 rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"><Trash2 size={12} />Delete</button>}
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
